-- Rollback for 20270114000000_billing_adjustments.sql: back to billing with the proration option (20270113000000).
-- WARNING: deletes one-time discounts (bills already made keep their amounts; their discount lines lose the link).
-- Credits given (payments of method 'credit') must be voided first, or this fails on the method check.
DROP FUNCTION IF EXISTS public.billing_adjustment_add(uuid, jsonb);
DROP FUNCTION IF EXISTS public.billing_adjustment_void(uuid, text);
DROP INDEX IF EXISTS public.billing_bill_lines_adjustment_once;
ALTER TABLE public.billing_bill_lines DROP COLUMN IF EXISTS adjustment_id;
DROP TABLE IF EXISTS public.billing_adjustments;
ALTER TABLE public.billing_receipts DROP CONSTRAINT IF EXISTS billing_receipts_method_check;
ALTER TABLE public.billing_receipts ADD CONSTRAINT billing_receipts_method_check CHECK (method IN ('credit_card', 'debit_card', 'check', 'cash', 'other'));
ALTER TABLE public.billing_payments DROP CONSTRAINT IF EXISTS billing_payments_method_check;
ALTER TABLE public.billing_payments ADD CONSTRAINT billing_payments_method_check CHECK (method IN ('ach', 'credit_card', 'debit_card', 'check', 'cash', 'other'));
-- (the 'adjustment' bill-line frequency stays allowed: existing discount lines keep it)

-- billing_receive_payment / billing_child_account as in 20270112000000
CREATE OR REPLACE FUNCTION public.billing_receive_payment(p_child_id uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_center uuid; v_payer child_payment_payers%ROWTYPE; v_today date; v_id uuid; v_left numeric; v_c record; v_part numeric;
  v_n int := 0;
  v_amt numeric := NULLIF(btrim(COALESCE(p ->> 'amount', '')), '')::numeric;
  v_method text := NULLIF(p ->> 'method', '');
  v_brand text := NULLIF(btrim(COALESCE(p ->> 'card_brand', '')), '');
  v_last4 text := NULLIF(btrim(COALESCE(p ->> 'last4', '')), '');
  v_ref text := NULLIF(btrim(COALESCE(p ->> 'reference', '')), '');
  v_on date := NULLIF(p ->> 'received_on', '')::date;
  v_note text := NULLIF(btrim(COALESCE(p ->> 'note', '')), '');
BEGIN
  SELECT center_id INTO v_center FROM children WHERE id = p_child_id;
  IF v_center IS NULL THEN RAISE EXCEPTION 'Child not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_center);
  v_today := public.roster_today(v_center);

  SELECT * INTO v_payer FROM child_payment_payers WHERE id = NULLIF(p ->> 'payer_id', '')::uuid AND child_id = p_child_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pick who is paying' USING ERRCODE = '22023'; END IF;
  IF v_method IS NULL OR v_method NOT IN ('credit_card', 'debit_card', 'check', 'cash', 'other') THEN
    RAISE EXCEPTION 'Pick how it was paid' USING ERRCODE = '22023';
  END IF;
  IF v_amt IS NULL OR v_amt <= 0 OR v_amt <> round(v_amt, 2) THEN RAISE EXCEPTION 'Enter the amount paid' USING ERRCODE = '22023'; END IF;
  IF v_amt > 100000 THEN RAISE EXCEPTION 'That amount is too large for one payment' USING ERRCODE = '22023'; END IF;
  IF v_method NOT IN ('credit_card', 'debit_card') THEN v_brand := NULL; v_last4 := NULL; END IF;
  IF v_last4 IS NOT NULL AND v_last4 !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Enter only the last 4 digits of the card' USING ERRCODE = '22023'; END IF;
  IF v_brand IS NOT NULL AND char_length(v_brand) > 20 THEN RAISE EXCEPTION 'Card type is too long' USING ERRCODE = '22023'; END IF;
  IF v_ref IS NOT NULL AND char_length(v_ref) > 60 THEN RAISE EXCEPTION 'Keep the reference to 60 characters' USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN RAISE EXCEPTION 'Keep the note to 300 characters' USING ERRCODE = '22023'; END IF;
  v_on := COALESCE(v_on, v_today);
  IF v_on > v_today THEN RAISE EXCEPTION 'The payment date can''t be in the future' USING ERRCODE = '22023'; END IF;

  INSERT INTO billing_receipts (center_id, child_id, payer_id, payer_name, amount, method, card_brand, last4, reference, received_on, note, recorded_by)
  VALUES (v_center, p_child_id, v_payer.id, v_payer.payer_name, v_amt, v_method, v_brand, v_last4, v_ref, v_on, v_note, auth.uid())
  RETURNING id INTO v_id;

  -- Oldest due first: this payer's charges with money still due that can still be paid here
  v_left := v_amt;
  FOR v_c IN
    SELECT c.id, c.amount - c.paid_amount AS due FROM billing_charges c
    JOIN billing_bills b ON b.id = c.bill_id
    LEFT JOIN billing_ach_batches ab ON ab.id = c.ach_batch_id
    WHERE c.payer_id = v_payer.id AND NOT b.voided AND c.amount > c.paid_amount
      AND (c.status IN ('open', 'partial', 'returned') OR (c.status = 'ach_scheduled' AND ab.status IN ('scheduled', 'exported')))
    ORDER BY b.period_start, c.created_at
    FOR UPDATE OF c
  LOOP
    EXIT WHEN v_left <= 0;
    v_part := LEAST(v_left, v_c.due);
    PERFORM public.billing_apply(v_id, v_c.id, v_part, 'payment', v_on);
    v_left := v_left - v_part; v_n := v_n + 1;
  END LOOP;

  PERFORM public.billing_log(v_center, p_child_id, 'billing_receipts', v_id, 'insert',
    'Payment received: ' || public.tuition_money(v_amt) || ' by ' || CASE v_method WHEN 'credit_card' THEN 'credit card' WHEN 'debit_card' THEN 'debit card' ELSE v_method END
    || COALESCE(' ····' || v_last4, '') || COALESCE(' #' || v_ref, '') || ' from ' || v_payer.payer_name
    || CASE WHEN v_left > 0 THEN ' (' || public.tuition_money(v_left) || ' kept as credit)' ELSE '' END);

  RETURN jsonb_build_object('receipt_id', v_id, 'applied', v_amt - v_left, 'credit', v_left, 'charges', v_n,
    'credit_total', public.billing_payer_credit(v_payer.id));
END $$;


CREATE OR REPLACE FUNCTION public.billing_child_account(p_child_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_center uuid; v_today date; v_payers jsonb;
BEGIN
  SELECT center_id INTO v_center FROM children WHERE id = p_child_id;
  IF v_center IS NULL OR NOT public.tuition_can_manage(v_center) THEN
    RAISE EXCEPTION 'You do not have access to this child''s billing' USING ERRCODE = '42501';
  END IF;
  v_today := public.roster_today(v_center);
  SELECT COALESCE(jsonb_agg(x ORDER BY (x ->> 'active')::boolean DESC, (x ->> 'sort_order')::int), '[]') INTO v_payers FROM (
    SELECT jsonb_build_object('payer_id', pp.id, 'payer_name', pp.payer_name, 'method', pp.method, 'last4', pp.last4,
      'card_brand', pp.card_brand, 'sort_order', pp.sort_order,
      'active', pp.effective_from <= v_today AND (pp.effective_to IS NULL OR pp.effective_to >= v_today),
      'due', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c WHERE c.payer_id = pp.id AND c.status <> 'void'), 0),
      'credit', public.billing_payer_credit(pp.id),
      'charges', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'label', public.billing_window_label(b.frequency, b.period_start),
            'period_start', b.period_start, 'amount', c.amount, 'paid', c.paid_amount, 'balance', c.amount - c.paid_amount, 'status', c.status)
            ORDER BY b.period_start, c.created_at)
          FROM billing_charges c JOIN billing_bills b ON b.id = c.bill_id
          WHERE c.payer_id = pp.id AND c.status <> 'void' AND c.amount > c.paid_amount), '[]')) AS x
    FROM child_payment_payers pp
    WHERE pp.child_id = p_child_id
      AND ((pp.effective_from <= v_today AND (pp.effective_to IS NULL OR pp.effective_to >= v_today))
           OR EXISTS (SELECT 1 FROM billing_charges c WHERE c.payer_id = pp.id AND c.status <> 'void' AND c.amount > c.paid_amount)
           OR public.billing_payer_credit(pp.id) > 0)
  ) s;

  RETURN jsonb_build_object(
    'today', v_today,
    'payers', v_payers,
    'total_due', COALESCE((SELECT sum((e ->> 'due')::numeric) FROM jsonb_array_elements(v_payers) e), 0),
    'total_credit', COALESCE((SELECT sum((e ->> 'credit')::numeric) FROM jsonb_array_elements(v_payers) e), 0),
    'unassigned_due', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c
                                WHERE c.child_id = p_child_id AND c.payer_id IS NULL AND c.status <> 'void'), 0),
    'receipts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'payer_name', r.payer_name, 'amount', r.amount,
        'method', r.method, 'card_brand', r.card_brand, 'last4', r.last4, 'reference', r.reference, 'received_on', r.received_on,
        'note', r.note, 'credit_left', public.billing_receipt_left(r.id),
        'applied', CASE WHEN r.voided THEN 0 ELSE r.amount - public.billing_receipt_left(r.id) END,
        'voided', r.voided, 'void_reason', r.void_reason, 'recorded_by', public.center_bank_who(r.recorded_by), 'created_at', r.created_at)
        ORDER BY r.received_on DESC, r.created_at DESC)
      FROM (SELECT * FROM billing_receipts WHERE child_id = p_child_id ORDER BY received_on DESC, created_at DESC LIMIT 25) r), '[]'));
END $$;


-- Proration as in 20270113000000 (also drops the 3-argument billing functions this migration made)
ALTER TABLE public.billing_bill_lines ADD COLUMN IF NOT EXISTS prorate_days integer CHECK (prorate_days IS NULL OR prorate_days >= 0);
ALTER TABLE public.billing_bill_lines ADD COLUMN IF NOT EXISTS prorate_of integer CHECK (prorate_of IS NULL OR prorate_of > 0);

-- School days (Mon–Fri) from a to b, both included
CREATE OR REPLACE FUNCTION public.billing_weekdays(a date, b date)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN b < a THEN 0 ELSE (SELECT count(*)::int FROM generate_series(a, b, interval '1 day') d WHERE extract(isodow FROM d) < 6) END
$$;

-- A tuition line (as tuition_lines returns it, in JSON) charged only for its school days in the period
CREATE OR REPLACE FUNCTION public.billing_prorate_line(e jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_of int := public.billing_weekdays((e ->> 'period_start')::date, (e ->> 'period_end')::date);
  v_days int := public.billing_weekdays(GREATEST((e ->> 'start_date')::date, (e ->> 'period_start')::date),
                                        LEAST((e ->> 'period_end')::date, COALESCE((e ->> 'end_date')::date, (e ->> 'period_end')::date)));
  v_list numeric; v_disc numeric; v_over numeric; v_net numeric;
BEGIN
  IF v_of = 0 OR v_days >= v_of THEN RETURN e; END IF;
  v_list := round((e ->> 'list_amount')::numeric * v_days / v_of, 2);
  v_disc := round(COALESCE((e ->> 'discount_amount')::numeric, 0) * v_days / v_of, 2);
  v_over := round((e ->> 'override_amount')::numeric * v_days / v_of, 2);
  v_net := COALESCE(v_over, GREATEST(COALESCE(v_list, 0) - v_disc, 0));
  RETURN e || jsonb_build_object('list_amount', v_list, 'discount_amount', v_disc, 'override_amount', v_over,
    'net_amount', v_net, 'prorate_days', v_days, 'prorate_of', v_of);
END $$;

DROP FUNCTION IF EXISTS public.billing_preview(uuid, text, date);
DROP FUNCTION IF EXISTS public.billing_run_submit(uuid, text, date, numeric, date, text);
DROP FUNCTION IF EXISTS public.billing_compute(uuid, text, date);

-- Same as 20270111000000 (billing_compute, billing_run_submit) and 20270112000000 (billing_preview), plus p_prorate

CREATE OR REPLACE FUNCTION public.billing_compute(p_center_id uuid, p_frequency text, p_day date, p_prorate uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ps date; v_pe date; v_c record; v_f text; v_freqs text[]; v_eval date; v_l record; v_s jsonb; v_p jsonb;
  v_lines jsonb; v_alloc jsonb; v_skipped jsonb; v_warn jsonb; v_charges jsonb; v_children jsonb := '[]';
  v_block jsonb; v_bstart date; v_day date; v_billed uuid; v_amt numeric; v_key text; v_payer child_payment_payers%ROWTYPE;
  v_target uuid; v_list numeric; v_disc numeric; v_total numeric; v_problem text;
  t_children int := 0; t_billable int := 0; t_list numeric := 0; t_disc numeric := 0; t_total numeric := 0;
  t_ach numeric := 0; t_ach_n int := 0; t_manual numeric := 0; t_unassigned numeric := 0;
  t_w numeric := 0; t_b numeric := 0; t_m numeric := 0; t_o numeric := 0;
  v_balloc jsonb; v_ratio numeric; v_full numeric; v_newtot numeric; v_first date; v_bend date; v_given numeric; v_firstkey text; v_k text;
  v_can boolean; v_did boolean; v_pro_days int; v_pro_of int;
BEGIN
  SELECT w.period_start, w.period_end INTO v_ps, v_pe FROM public.billing_window(p_frequency, p_day) w;
  v_freqs := CASE WHEN p_frequency = 'weekly' THEN ARRAY['weekly', 'biweekly'] ELSE ARRAY['monthly'] END;

  FOR v_c IN
    SELECT ch.id, ch.first_name, ch.last_name, ch.status, ch.enrolled_on, ch.withdrawn_on, wa.name AS room
    FROM children ch LEFT JOIN work_areas wa ON wa.id = ch.classroom_id
    WHERE ch.center_id = p_center_id AND ch.enrolled_on <= v_pe AND (ch.withdrawn_on IS NULL OR ch.withdrawn_on >= v_ps)
    ORDER BY lower(ch.last_name), lower(ch.first_name), ch.id
  LOOP
    v_lines := '[]'; v_alloc := '{}'; v_skipped := '[]'; v_warn := '[]'; v_charges := '[]';
    v_can := false; v_did := false; v_pro_days := NULL; v_pro_of := NULL;
    t_children := t_children + 1;

    -- Recurring fees, one frequency at a time; each frequency's lines for the period are billed (and split) together
    FOREACH v_f IN ARRAY v_freqs LOOP
      v_eval := CASE WHEN v_f = 'biweekly' THEN v_pe ELSE v_ps END;
      SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.fee_name), '[]'), min(l.period_start), GREATEST(min(l.period_start), min(l.start_date))
        INTO v_block, v_bstart, v_day
      FROM public.tuition_lines(v_c.id, v_eval) l
      WHERE l.frequency = v_f AND (v_f <> 'biweekly' OR l.period_start >= v_ps);
      IF jsonb_array_length(v_block) = 0 THEN CONTINUE; END IF;

      SELECT b.run_id INTO v_billed FROM billing_bill_lines bl JOIN billing_bills b ON b.id = bl.bill_id
      WHERE bl.child_id = v_c.id AND bl.frequency = v_f AND bl.fee_period_start = v_bstart AND NOT bl.voided LIMIT 1;
      IF v_billed IS NOT NULL THEN
        v_skipped := v_skipped || jsonb_build_object('frequency', v_f, 'run_id', v_billed, 'reason', 'Already billed');
        CONTINUE;
      END IF;

      -- New starter: every fee of this frequency starts after the window's first day. Optionally prorated by school
      -- days (Mon–Fri) from the start date, when the child is in p_prorate. Weekly and monthly fees only.
      v_ratio := 1;
      SELECT min((e ->> 'start_date')::date), max((e ->> 'period_end')::date) INTO v_first, v_bend FROM jsonb_array_elements(v_block) e;
      IF v_f IN ('weekly', 'monthly') AND v_first > v_bstart THEN
        v_can := true;
        v_pro_of := public.billing_weekdays(v_bstart, v_bend);
        v_pro_days := public.billing_weekdays(v_first, v_bend);
        IF v_c.id = ANY(COALESCE(p_prorate, '{}')) AND v_pro_of > 0 AND v_pro_days < v_pro_of THEN
          v_did := true;
          SELECT COALESCE(sum((e ->> 'net_amount')::numeric), 0) INTO v_full FROM jsonb_array_elements(v_block) e;
          SELECT jsonb_agg(public.billing_prorate_line(e) ORDER BY e ->> 'fee_name') INTO v_block FROM jsonb_array_elements(v_block) e;
          SELECT COALESCE(sum((e ->> 'net_amount')::numeric), 0) INTO v_newtot FROM jsonb_array_elements(v_block) e;
          v_ratio := CASE WHEN v_full > 0 THEN v_newtot / v_full ELSE 1 END;
        END IF;
      END IF;

      SELECT e INTO v_s FROM jsonb_array_elements(public.tuition_split(v_c.id, v_day)) e WHERE e ->> 'frequency' = v_f;
      v_balloc := '{}'; v_firstkey := NULL;
      FOR v_p IN SELECT * FROM jsonb_array_elements(COALESCE(v_s -> 'payers', '[]')) LOOP
        v_amt := (v_p ->> 'amount')::numeric;
        IF v_amt > 0 THEN
          v_key := v_p ->> 'payer_id';
          v_firstkey := COALESCE(v_firstkey, v_key);
          v_balloc := jsonb_set(v_balloc, ARRAY[v_key], to_jsonb(COALESCE((v_balloc ->> v_key)::numeric, 0) + v_amt));
        END IF;
      END LOOP;
      v_amt := COALESCE((v_s ->> 'unassigned')::numeric, 0);
      IF v_amt > 0 THEN
        v_firstkey := COALESCE(v_firstkey, 'unassigned');
        v_balloc := jsonb_set(v_balloc, '{unassigned}', to_jsonb(COALESCE((v_balloc ->> 'unassigned')::numeric, 0) + v_amt));
      END IF;
      -- Prorated: every payer's share shrinks by the same ratio (cents down); the cents left go to the first payer
      IF v_ratio <> 1 THEN
        v_given := 0;
        FOR v_k IN SELECT jsonb_object_keys(v_balloc) LOOP
          v_amt := floor((v_balloc ->> v_k)::numeric * v_ratio * 100) / 100;
          v_balloc := jsonb_set(v_balloc, ARRAY[v_k], to_jsonb(v_amt));
          v_given := v_given + v_amt;
        END LOOP;
        IF v_firstkey IS NOT NULL AND v_newtot - v_given <> 0 THEN
          v_balloc := jsonb_set(v_balloc, ARRAY[v_firstkey], to_jsonb((v_balloc ->> v_firstkey)::numeric + v_newtot - v_given));
        END IF;
      END IF;
      FOR v_k IN SELECT jsonb_object_keys(v_balloc) LOOP
        v_amt := (v_balloc ->> v_k)::numeric;
        IF v_amt > 0 THEN
          v_alloc := jsonb_set(v_alloc, ARRAY[v_k], to_jsonb(COALESCE((v_alloc ->> v_k)::numeric, 0) + v_amt));
        END IF;
      END LOOP;
      IF COALESCE((v_s ->> 'over')::numeric, 0) > 0 THEN
        v_warn := v_warn || to_jsonb('Fixed payer amounts are more than the ' || v_f || ' total; they were cut down to the total.');
      END IF;
      v_lines := v_lines || v_block;
    END LOOP;

    -- One-time fees dated in the window and not billed yet
    FOR v_l IN
      SELECT l.* FROM child_tuition ct
      JOIN tuition_fees f ON f.id = ct.fee_id AND f.frequency = 'one_time'
      CROSS JOIN LATERAL public.tuition_lines(v_c.id, ct.start_date) l
      WHERE ct.child_id = v_c.id AND ct.start_date BETWEEN v_ps AND v_pe AND l.child_tuition_id = ct.id
        AND NOT EXISTS (SELECT 1 FROM billing_bill_lines bl WHERE bl.child_tuition_id = ct.id AND NOT bl.voided)
      ORDER BY ct.start_date, l.fee_name
    LOOP
      v_lines := v_lines || to_jsonb(v_l);
      IF COALESCE(v_l.net_amount, 0) > 0 THEN
        SELECT id INTO v_target FROM child_payment_payers
        WHERE child_id = v_c.id AND effective_from <= v_l.start_date AND (effective_to IS NULL OR effective_to >= v_l.start_date)
        ORDER BY array_position(ARRAY['remainder', 'percent', 'fixed'], share_type), sort_order, created_at LIMIT 1;
        v_key := COALESCE(v_target::text, 'unassigned');
        v_alloc := jsonb_set(v_alloc, ARRAY[v_key], to_jsonb(COALESCE((v_alloc ->> v_key)::numeric, 0) + v_l.net_amount));
      END IF;
    END LOOP;

    -- Charges: payers in their own order, then what no payer covers
    FOR v_payer IN
      SELECT pp.* FROM child_payment_payers pp WHERE pp.child_id = v_c.id AND v_alloc ? pp.id::text
      ORDER BY pp.sort_order, pp.created_at
    LOOP
      v_amt := round((v_alloc ->> v_payer.id::text)::numeric, 2);
      v_problem := public.billing_ach_problem(v_payer);
      v_charges := v_charges || jsonb_build_object('payer_id', v_payer.id, 'payer_name', v_payer.payer_name,
        'payer_kind', v_payer.payer_kind, 'method', v_payer.method, 'account_type', v_payer.account_type, 'last4', v_payer.last4,
        'card_brand', v_payer.card_brand, 'amount', v_amt, 'ach_ready', v_payer.method = 'ach' AND v_problem IS NULL, 'problem', v_problem);
      IF v_payer.method = 'ach' AND v_problem IS NULL THEN t_ach := t_ach + v_amt; t_ach_n := t_ach_n + 1;
      ELSE t_manual := t_manual + v_amt; END IF;
      IF v_problem IS NOT NULL THEN v_warn := v_warn || to_jsonb(v_payer.payer_name || ': ' || v_problem); END IF;
    END LOOP;
    IF v_alloc ? 'unassigned' THEN
      v_amt := round((v_alloc ->> 'unassigned')::numeric, 2);
      v_charges := v_charges || jsonb_build_object('payer_id', NULL, 'payer_name', 'No payer set', 'payer_kind', NULL,
        'method', 'unassigned', 'amount', v_amt, 'ach_ready', false,
        'problem', 'No payer covers this amount. Set who pays on the child''s Fee & Payment tab, or collect it by hand.');
      v_warn := v_warn || to_jsonb(public.tuition_money(v_amt) || ' isn''t covered by any payer.');
      t_manual := t_manual + v_amt; t_unassigned := t_unassigned + v_amt;
    END IF;

    SELECT COALESCE(sum((e ->> 'list_amount')::numeric), 0), COALESCE(sum((e ->> 'discount_amount')::numeric), 0),
           COALESCE(sum((e ->> 'net_amount')::numeric), 0)
      INTO v_list, v_disc, v_total FROM jsonb_array_elements(v_lines) e;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) e WHERE e -> 'list_amount' = 'null'::jsonb AND e -> 'override_amount' = 'null'::jsonb) THEN
      v_warn := v_warn || to_jsonb('A fee has no price on the rate card for this period, so it bills $0.00.'::text);
    END IF;
    IF jsonb_array_length(v_lines) = 0 AND jsonb_array_length(v_skipped) = 0 THEN
      v_warn := v_warn || to_jsonb(CASE WHEN p_frequency = 'weekly' THEN 'No weekly fees for this week.' ELSE 'No monthly fees for this month.' END
        || ' Fees are set on the child''s Fee & Payment tab.');
    END IF;

    t_list := t_list + v_list; t_disc := t_disc + v_disc; t_total := t_total + v_total;
    SELECT t_w + COALESCE(sum((e ->> 'net_amount')::numeric) FILTER (WHERE e ->> 'frequency' = 'weekly'), 0),
           t_b + COALESCE(sum((e ->> 'net_amount')::numeric) FILTER (WHERE e ->> 'frequency' = 'biweekly'), 0),
           t_m + COALESCE(sum((e ->> 'net_amount')::numeric) FILTER (WHERE e ->> 'frequency' = 'monthly'), 0),
           t_o + COALESCE(sum((e ->> 'net_amount')::numeric) FILTER (WHERE e ->> 'frequency' = 'one_time'), 0)
      INTO t_w, t_b, t_m, t_o FROM jsonb_array_elements(v_lines) e;
    IF jsonb_array_length(v_lines) > 0 THEN t_billable := t_billable + 1; END IF;

    v_children := v_children || jsonb_build_object(
      'child_id', v_c.id, 'name', btrim(v_c.first_name || ' ' || v_c.last_name), 'classroom', v_c.room,
      'status', v_c.status, 'enrolled_on', v_c.enrolled_on, 'withdrawn_on', v_c.withdrawn_on,
      'billable', jsonb_array_length(v_lines) > 0,
      'can_prorate', v_can, 'prorated', v_did, 'prorate_days', v_pro_days, 'prorate_of', v_pro_of,
      'list', v_list, 'discount', v_disc, 'total', v_total,
      'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'child_tuition_id', e -> 'child_tuition_id', 'fee_id', e -> 'fee_id', 'fee_name', e -> 'fee_name',
                  'frequency', e -> 'frequency', 'period_start', e -> 'period_start', 'period_end', e -> 'period_end',
                  'list', e -> 'list_amount', 'discount', e -> 'discount_amount', 'net', e -> 'net_amount',
                  'prorate_days', e -> 'prorate_days', 'prorate_of', e -> 'prorate_of',
                  'discount_label', NULLIF(concat_ws(' · ',
                    CASE WHEN e ->> 'discount_type' IS NULL AND e ->> 'override_amount' IS NULL THEN NULL
                      ELSE public.tuition_discount_label(e ->> 'discount_type', (e ->> 'discount_value')::numeric,
                             e ->> 'discount_reason', (e ->> 'override_amount')::numeric) END,
                    CASE WHEN e ? 'prorate_days' THEN 'Prorated ' || (e ->> 'prorate_days') || ' of ' || (e ->> 'prorate_of') || ' days' END), ''))), '[]')
                FROM jsonb_array_elements(v_lines) e),
      'charges', v_charges, 'skipped', v_skipped, 'warnings', v_warn);
  END LOOP;

  RETURN jsonb_build_object(
    'frequency', p_frequency, 'period_start', v_ps, 'period_end', v_pe, 'label', public.billing_window_label(p_frequency, v_ps),
    'children', v_children,
    'totals', jsonb_build_object('children', t_children, 'billable', t_billable, 'list', t_list, 'discount', t_disc,
      'total', t_total, 'ach_total', t_ach, 'ach_count', t_ach_n, 'manual_total', t_manual, 'unassigned_total', t_unassigned,
      'by_frequency', jsonb_build_object('weekly', t_w, 'biweekly', t_b, 'monthly', t_m, 'one_time', t_o)));
END $$;


CREATE OR REPLACE FUNCTION public.billing_preview(p_center_id uuid, p_frequency text, p_day date, p_prorate uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_today date;
BEGIN
  PERFORM public.tuition_require(p_center_id);
  v := public.billing_compute(p_center_id, p_frequency, COALESCE(p_day, public.roster_today(p_center_id)), p_prorate);
  v_today := public.roster_today(p_center_id);
  RETURN v || jsonb_build_object(
    'today', v_today,
    'is_owner', public.tuition_is_owner(p_center_id),
    'default_draft_date', GREATEST(v_today, (v ->> 'period_start')::date),
    'credits', COALESCE((SELECT jsonb_object_agg(pp.id, public.billing_payer_credit(pp.id)) FROM child_payment_payers pp
                         WHERE pp.center_id = p_center_id AND EXISTS (SELECT 1 FROM billing_receipts r WHERE r.payer_id = pp.id AND NOT r.voided)
                           AND public.billing_payer_credit(pp.id) > 0), '{}'),
    'center_bank', EXISTS (SELECT 1 FROM center_bank_accounts WHERE center_id = p_center_id AND status = 'active'),
    'runs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'total', r.total,
                        'child_count', r.child_count, 'submitted_at', r.submitted_at) ORDER BY r.submitted_at)
                      FROM billing_runs r WHERE r.center_id = p_center_id AND r.frequency = p_frequency
                        AND r.period_start = (v ->> 'period_start')::date), '[]'));
END $$;


CREATE OR REPLACE FUNCTION public.billing_run_submit(p_center_id uuid, p_frequency text, p_day date,
  p_expected_total numeric, p_draft_date date DEFAULT NULL, p_note text DEFAULT NULL, p_prorate uuid[] DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb; v_c jsonb; v_l jsonb; v_ch jsonb; v_run uuid; v_batch uuid; v_bill uuid; v_charge uuid; v_today date;
  v_ps date; v_pe date; v_draft date; v_label text; v_n int := 0; v_ach_n int; v_ord bigint;
BEGIN
  PERFORM public.tuition_require(p_center_id);
  IF p_frequency NOT IN ('weekly', 'monthly') THEN RAISE EXCEPTION 'Pick weekly or monthly billing' USING ERRCODE = '22023'; END IF;
  IF p_day IS NULL THEN RAISE EXCEPTION 'Pick the week or month to bill' USING ERRCODE = '22023'; END IF;
  SELECT w.period_start, w.period_end INTO v_ps, v_pe FROM public.billing_window(p_frequency, p_day) w;
  -- One run at a time for a center's window, so two admins pressing Submit together can't bill twice
  PERFORM pg_advisory_xact_lock(hashtextextended('billing:' || p_center_id::text || ':' || p_frequency || ':' || v_ps::text, 0));

  v := public.billing_compute(p_center_id, p_frequency, v_ps, p_prorate);
  IF p_expected_total IS NULL OR round(p_expected_total, 2) <> round((v -> 'totals' ->> 'total')::numeric, 2) THEN
    RAISE EXCEPTION 'The amounts changed since you looked (now %). Review the run again before submitting',
      public.tuition_money((v -> 'totals' ->> 'total')::numeric) USING ERRCODE = '40001';
  END IF;
  IF (v -> 'totals' ->> 'billable')::int = 0 THEN
    RAISE EXCEPTION 'Nothing to bill for the %', v ->> 'label' USING ERRCODE = '22023';
  END IF;

  v_today := public.roster_today(p_center_id);
  v_ach_n := (v -> 'totals' ->> 'ach_count')::int;
  IF v_ach_n > 0 THEN
    v_draft := COALESCE(p_draft_date, GREATEST(v_today, v_ps));
    IF v_draft < v_today THEN RAISE EXCEPTION 'The ACH draft date can''t be before today' USING ERRCODE = '22023'; END IF;
    IF v_draft > v_pe + 31 THEN RAISE EXCEPTION 'The ACH draft date is too far after the billing period' USING ERRCODE = '22023'; END IF;
  END IF;
  v_label := v ->> 'label';

  INSERT INTO billing_runs (center_id, frequency, period_start, period_end, draft_date, child_count, list_total, discount_total,
    total, ach_total, manual_total, note, submitted_by)
  VALUES (p_center_id, p_frequency, v_ps, v_pe, v_draft, (v -> 'totals' ->> 'billable')::int,
    (v -> 'totals' ->> 'list')::numeric, (v -> 'totals' ->> 'discount')::numeric, (v -> 'totals' ->> 'total')::numeric,
    (v -> 'totals' ->> 'ach_total')::numeric, (v -> 'totals' ->> 'manual_total')::numeric,
    NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid())
  RETURNING id INTO v_run;

  IF v_ach_n > 0 THEN
    INSERT INTO billing_ach_batches (center_id, run_id, draft_date) VALUES (p_center_id, v_run, v_draft) RETURNING id INTO v_batch;
  END IF;

  FOR v_c IN SELECT * FROM jsonb_array_elements(v -> 'children') e WHERE (e ->> 'billable')::boolean LOOP
    INSERT INTO billing_bills (center_id, run_id, child_id, child_name, classroom_name, frequency, period_start, period_end,
      list_amount, discount_amount, total)
    VALUES (p_center_id, v_run, (v_c ->> 'child_id')::uuid, v_c ->> 'name', v_c ->> 'classroom', p_frequency, v_ps, v_pe,
      (v_c ->> 'list')::numeric, (v_c ->> 'discount')::numeric, (v_c ->> 'total')::numeric)
    RETURNING id INTO v_bill;

    FOR v_l IN SELECT * FROM jsonb_array_elements(v_c -> 'lines') LOOP
      INSERT INTO billing_bill_lines (center_id, bill_id, child_id, child_tuition_id, fee_id, fee_name, frequency,
        fee_period_start, fee_period_end, list_amount, discount_amount, net_amount, discount_label, prorate_days, prorate_of)
      VALUES (p_center_id, v_bill, (v_c ->> 'child_id')::uuid, (v_l ->> 'child_tuition_id')::uuid, (v_l ->> 'fee_id')::uuid,
        v_l ->> 'fee_name', v_l ->> 'frequency', (v_l ->> 'period_start')::date, (v_l ->> 'period_end')::date,
        (v_l ->> 'list')::numeric, COALESCE((v_l ->> 'discount')::numeric, 0), COALESCE((v_l ->> 'net')::numeric, 0), v_l ->> 'discount_label',
        (v_l ->> 'prorate_days')::int, (v_l ->> 'prorate_of')::int);
    END LOOP;

    FOR v_ch, v_ord IN SELECT e, o FROM jsonb_array_elements(v_c -> 'charges') WITH ORDINALITY x(e, o) WHERE (e ->> 'amount')::numeric > 0 LOOP
      INSERT INTO billing_charges (center_id, run_id, bill_id, child_id, payer_id, payer_name, payer_kind, method, account_type,
        last4, amount, status, ach_batch_id, note, sort_order)
      VALUES (p_center_id, v_run, v_bill, (v_c ->> 'child_id')::uuid, (v_ch ->> 'payer_id')::uuid, v_ch ->> 'payer_name',
        v_ch ->> 'payer_kind', v_ch ->> 'method', v_ch ->> 'account_type', v_ch ->> 'last4', (v_ch ->> 'amount')::numeric,
        CASE WHEN (v_ch ->> 'ach_ready')::boolean THEN 'ach_scheduled' ELSE 'open' END,
        CASE WHEN (v_ch ->> 'ach_ready')::boolean THEN v_batch END,
        left(v_ch ->> 'problem', 300), v_ord)
      RETURNING id INTO v_charge;
    END LOOP;

    PERFORM public.billing_log(p_center_id, (v_c ->> 'child_id')::uuid, 'billing_bills', v_bill, 'insert',
      'Billed ' || v_label || CASE WHEN (v_c ->> 'prorated')::boolean THEN ' (prorated ' || (v_c ->> 'prorate_days') || ' of ' || (v_c ->> 'prorate_of') || ' days)' ELSE '' END || ': ' || public.tuition_money((v_c ->> 'list')::numeric)
      || CASE WHEN (v_c ->> 'discount')::numeric > 0 THEN ' − ' || public.tuition_money((v_c ->> 'discount')::numeric) || ' discount' ELSE '' END
      || ' = ' || public.tuition_money((v_c ->> 'total')::numeric));
    v_n := v_n + 1;
  END LOOP;

  RETURN v_run;
END $$;


REVOKE ALL ON FUNCTION public.billing_compute(uuid, text, date, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_preview(uuid, text, date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_preview(uuid, text, date, uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.billing_run_submit(uuid, text, date, numeric, date, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_run_submit(uuid, text, date, numeric, date, text, uuid[]) TO authenticated, service_role;

-- ============================================================
-- Run Billing: optional proration for mid-week (or mid-month) starters.
--
--  - Billing is prepay: admins bill next week, and a child who starts any day that week is in it. By default the
--    child is billed the full week (tuition decision 1). The admin can tick "Prorate" for a new starter in the preview:
--    the fees are then charged for the school days (Mon–Fri) from the start date, e.g. starts Wednesday = 3 of 5 days.
--    Monthly: school days left in the month / school days in the month.
--  - A "new starter" for a frequency = every fee of that frequency starts after the window's first day.
--  - Prorating scales the billing amount, discount and locked-in price by days/of (to the cent); each payer's share
--    shrinks by the same ratio, the leftover cent going to the first payer.
--  - billing_preview and billing_run_submit take p_prorate (child ids). The submit re-computes with the same list, so
--    the total check still guards against changes. Bill lines keep prorate_days / prorate_of, and their label says
--    "Prorated 3 of 5 days".
-- Needs: 20270112000000_billing_receipts.sql
-- Rollback: supabase/rollbacks/20270113000000_billing_proration.down.sql
-- ============================================================

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

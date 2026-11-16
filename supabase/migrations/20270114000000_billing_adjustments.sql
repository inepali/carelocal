-- ============================================================
-- Billing: one-time discounts and credits for week-by-week adjustments; the proration option is removed.
--
--  - Proration (20270113000000) is taken out: billing_compute / billing_preview / billing_run_submit go back to their
--    signatures without p_prorate, and its helpers and bill-line columns are dropped. A mid-week starter is billed the
--    full week; any adjustment is made with a one-time discount instead.
--  - One-time discount (billing_adjustments): an amount and a reason for one child and one week (or month) that
--    isn't billed yet, e.g. "Thanksgiving closure, −$57, week of Nov 23". The billing run for that window shows it as
--    a "One-time discount" line: billing amount unchanged, discount up, total down. It comes off the chosen payer's
--    share (default: the payer of "the rest", else the first payer), then the others. Removed only while unbilled;
--    voiding the run frees it for the next run of that window.
--  - Credit to account: for an adjustment on a week already billed, or a goodwill credit. It is a payment of method
--    'credit' (billing_receive_payment, reason required): pays the payer's oldest due first, the rest is credit for
--    the next bill. Voided like any payment.
-- Needs: 20270113000000_billing_proration.sql
-- Rollback: supabase/rollbacks/20270114000000_billing_adjustments.down.sql
-- ============================================================

-- 1. Proration out ------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.billing_preview(uuid, text, date, uuid[]);
DROP FUNCTION IF EXISTS public.billing_run_submit(uuid, text, date, numeric, date, text, uuid[]);
DROP FUNCTION IF EXISTS public.billing_compute(uuid, text, date, uuid[]);
DROP FUNCTION IF EXISTS public.billing_prorate_line(jsonb);
DROP FUNCTION IF EXISTS public.billing_weekdays(date, date);
ALTER TABLE public.billing_bill_lines DROP COLUMN IF EXISTS prorate_days;
ALTER TABLE public.billing_bill_lines DROP COLUMN IF EXISTS prorate_of;

-- 2. One-time discounts -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_adjustments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id     uuid NOT NULL,
  child_id      uuid NOT NULL,
  payer_id      uuid REFERENCES public.child_payment_payers(id) ON DELETE SET NULL,   -- NULL = the default payer
  amount        numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 100000),
  reason        text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 120),
  frequency     text NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  period_start  date NOT NULL,                                 -- the window it comes off (Monday / 1st)
  voided        boolean NOT NULL DEFAULT false,
  void_reason   text CHECK (void_reason IS NULL OR char_length(void_reason) <= 300),
  voided_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at     timestamptz,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, center_id),
  FOREIGN KEY (child_id, center_id) REFERENCES public.children (id, center_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS billing_adjustments_child_idx ON public.billing_adjustments (child_id, frequency, period_start) WHERE NOT voided;
ALTER TABLE public.billing_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.billing_adjustments TO authenticated;
GRANT ALL ON public.billing_adjustments TO service_role;
DROP POLICY IF EXISTS "Owners and admins read billing_adjustments" ON public.billing_adjustments;
CREATE POLICY "Owners and admins read billing_adjustments" ON public.billing_adjustments FOR SELECT TO authenticated
  USING (public.can_view_confidential(center_id));

ALTER TABLE public.billing_bill_lines ADD COLUMN IF NOT EXISTS adjustment_id uuid REFERENCES public.billing_adjustments(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS billing_bill_lines_adjustment_once ON public.billing_bill_lines (adjustment_id) WHERE NOT voided AND adjustment_id IS NOT NULL;
ALTER TABLE public.billing_bill_lines DROP CONSTRAINT IF EXISTS billing_bill_lines_frequency_check;
ALTER TABLE public.billing_bill_lines ADD CONSTRAINT billing_bill_lines_frequency_check
  CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'one_time', 'adjustment'));

-- Credits are payments of method 'credit'
ALTER TABLE public.billing_receipts DROP CONSTRAINT IF EXISTS billing_receipts_method_check;
ALTER TABLE public.billing_receipts ADD CONSTRAINT billing_receipts_method_check CHECK (method IN ('credit_card', 'debit_card', 'check', 'cash', 'other', 'credit'));
ALTER TABLE public.billing_payments DROP CONSTRAINT IF EXISTS billing_payments_method_check;
ALTER TABLE public.billing_payments ADD CONSTRAINT billing_payments_method_check CHECK (method IN ('ach', 'credit_card', 'debit_card', 'check', 'cash', 'other', 'credit'));

-- Add a one-time discount. p: {amount, reason, frequency, day (any day in the window), payer_id}
CREATE OR REPLACE FUNCTION public.billing_adjustment_add(p_child_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_center uuid; v_id uuid; v_ps date; v_pe date; v_today date; v_payer uuid; v_name text;
  v_amt numeric := NULLIF(btrim(COALESCE(p ->> 'amount', '')), '')::numeric;
  v_reason text := NULLIF(btrim(COALESCE(p ->> 'reason', '')), '');
  v_freq text := COALESCE(NULLIF(p ->> 'frequency', ''), 'weekly');
BEGIN
  SELECT center_id INTO v_center FROM children WHERE id = p_child_id;
  IF v_center IS NULL THEN RAISE EXCEPTION 'Child not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_center);
  v_today := public.roster_today(v_center);
  IF v_amt IS NULL OR v_amt <= 0 OR v_amt <> round(v_amt, 2) THEN RAISE EXCEPTION 'Enter the discount amount' USING ERRCODE = '22023'; END IF;
  IF v_amt > 100000 THEN RAISE EXCEPTION 'That amount is too large' USING ERRCODE = '22023'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Give a reason (it shows on the bill)' USING ERRCODE = '22023'; END IF;
  IF char_length(v_reason) > 120 THEN RAISE EXCEPTION 'Keep the reason to 120 characters' USING ERRCODE = '22023'; END IF;
  IF v_freq NOT IN ('weekly', 'monthly') THEN RAISE EXCEPTION 'Pick a week or a month' USING ERRCODE = '22023'; END IF;
  SELECT w.period_start, w.period_end INTO v_ps, v_pe FROM public.billing_window(v_freq, COALESCE(NULLIF(p ->> 'day', '')::date, v_today)) w;
  IF v_pe < v_today THEN RAISE EXCEPTION 'That % is over. Give a credit instead', CASE WHEN v_freq = 'weekly' THEN 'week' ELSE 'month' END USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM billing_bill_lines bl JOIN billing_bills b ON b.id = bl.bill_id
             WHERE b.child_id = p_child_id AND NOT bl.voided AND b.frequency = v_freq AND b.period_start = v_ps
               AND bl.frequency IN ('weekly', 'biweekly', 'monthly')) THEN
    RAISE EXCEPTION 'The % is already billed. Give a credit instead: it comes off what is due', public.billing_window_label(v_freq, v_ps) USING ERRCODE = '22023';
  END IF;
  IF NULLIF(p ->> 'payer_id', '') IS NOT NULL THEN
    SELECT id, payer_name INTO v_payer, v_name FROM child_payment_payers WHERE id = (p ->> 'payer_id')::uuid AND child_id = p_child_id;
    IF v_payer IS NULL THEN RAISE EXCEPTION 'Pick one of this child''s payers' USING ERRCODE = '22023'; END IF;
  END IF;

  INSERT INTO billing_adjustments (center_id, child_id, payer_id, amount, reason, frequency, period_start, created_by)
  VALUES (v_center, p_child_id, v_payer, v_amt, v_reason, v_freq, v_ps, auth.uid()) RETURNING id INTO v_id;
  PERFORM public.billing_log(v_center, p_child_id, 'billing_adjustments', v_id, 'insert',
    'One-time discount added: −' || public.tuition_money(v_amt) || ' for the ' || public.billing_window_label(v_freq, v_ps)
    || COALESCE(' (' || v_name || ')', '') || ': ' || v_reason);
  RETURN v_id;
END $$;

-- Remove a one-time discount that isn't on a bill yet
CREATE OR REPLACE FUNCTION public.billing_adjustment_void(p_adjustment_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a billing_adjustments%ROWTYPE;
BEGIN
  SELECT * INTO v_a FROM billing_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Discount not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_a.center_id);
  IF v_a.voided THEN RAISE EXCEPTION 'This discount was already removed' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM billing_bill_lines WHERE adjustment_id = v_a.id AND NOT voided) THEN
    RAISE EXCEPTION 'This discount is already on a bill. Void that billing run, or give a charge-back another way' USING ERRCODE = '22023';
  END IF;
  UPDATE billing_adjustments SET voided = true, void_reason = left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 300),
    voided_by = auth.uid(), voided_at = now() WHERE id = v_a.id;
  PERFORM public.billing_log(v_a.center_id, v_a.child_id, 'billing_adjustments', v_a.id, 'update',
    'One-time discount removed: −' || public.tuition_money(v_a.amount) || ' for the ' || public.billing_window_label(v_a.frequency, v_a.period_start));
END $$;

-- 3. Billing functions: as in 20270111000000 / 20270112000000, plus one-time discounts and 'credit' payments -----

CREATE OR REPLACE FUNCTION public.billing_compute(p_center_id uuid, p_frequency text, p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ps date; v_pe date; v_c record; v_f text; v_freqs text[]; v_eval date; v_l record; v_s jsonb; v_p jsonb;
  v_lines jsonb; v_alloc jsonb; v_skipped jsonb; v_warn jsonb; v_charges jsonb; v_children jsonb := '[]';
  v_block jsonb; v_bstart date; v_day date; v_billed uuid; v_amt numeric; v_key text; v_payer child_payment_payers%ROWTYPE;
  v_target uuid; v_list numeric; v_disc numeric; v_total numeric; v_problem text;
  t_children int := 0; t_billable int := 0; t_list numeric := 0; t_disc numeric := 0; t_total numeric := 0;
  t_ach numeric := 0; t_ach_n int := 0; t_manual numeric := 0; t_unassigned numeric := 0;
  t_w numeric := 0; t_b numeric := 0; t_m numeric := 0; t_o numeric := 0;
  v_a record; v_rem numeric; v_take numeric; v_keys text[]; v_k text; v_line jsonb; t_adj numeric := 0;
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

      SELECT e INTO v_s FROM jsonb_array_elements(public.tuition_split(v_c.id, v_day)) e WHERE e ->> 'frequency' = v_f;
      FOR v_p IN SELECT * FROM jsonb_array_elements(COALESCE(v_s -> 'payers', '[]')) LOOP
        v_amt := (v_p ->> 'amount')::numeric;
        IF v_amt > 0 THEN
          v_key := v_p ->> 'payer_id';
          v_alloc := jsonb_set(v_alloc, ARRAY[v_key], to_jsonb(COALESCE((v_alloc ->> v_key)::numeric, 0) + v_amt));
        END IF;
      END LOOP;
      v_amt := COALESCE((v_s ->> 'unassigned')::numeric, 0);
      IF v_amt > 0 THEN
        v_alloc := jsonb_set(v_alloc, '{unassigned}', to_jsonb(COALESCE((v_alloc ->> 'unassigned')::numeric, 0) + v_amt));
      END IF;
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

    -- One-time discounts for this window (Payment card → Adjust). Only on a bill that has fees in this run.
    -- It comes off its payer's share (default: the payer of "the rest", else the first payer), then the other payers.
    IF jsonb_array_length(v_lines) > 0 THEN
      FOR v_a IN
        SELECT a.* FROM billing_adjustments a
        WHERE a.child_id = v_c.id AND NOT a.voided AND a.frequency = p_frequency AND a.period_start = v_ps
          AND NOT EXISTS (SELECT 1 FROM billing_bill_lines bl WHERE bl.adjustment_id = a.id AND NOT bl.voided)
        ORDER BY a.created_at
      LOOP
        SELECT array_agg(k ORDER BY o) INTO v_keys FROM (
          SELECT v_a.payer_id::text AS k, 0 AS o WHERE v_a.payer_id IS NOT NULL AND v_alloc ? v_a.payer_id::text
          UNION ALL
          SELECT pp.id::text, 1 + row_number() OVER (ORDER BY array_position(ARRAY['remainder', 'percent', 'fixed'], pp.share_type), pp.sort_order, pp.created_at)
          FROM child_payment_payers pp WHERE pp.child_id = v_c.id AND v_alloc ? pp.id::text AND pp.id IS DISTINCT FROM v_a.payer_id
          UNION ALL
          SELECT 'unassigned', 100000 WHERE v_alloc ? 'unassigned'
        ) x;
        v_rem := v_a.amount;
        FOREACH v_k IN ARRAY COALESCE(v_keys, '{}') LOOP
          EXIT WHEN v_rem <= 0;
          v_take := LEAST(v_rem, GREATEST((v_alloc ->> v_k)::numeric, 0));
          IF v_take > 0 THEN
            v_alloc := jsonb_set(v_alloc, ARRAY[v_k], to_jsonb((v_alloc ->> v_k)::numeric - v_take));
            v_rem := v_rem - v_take;
          END IF;
        END LOOP;
        v_take := v_a.amount - v_rem;
        IF v_rem > 0 THEN
          v_warn := v_warn || to_jsonb('Only ' || public.tuition_money(v_take) || ' of the ' || public.tuition_money(v_a.amount)
            || ' one-time discount fits this bill. Give the rest as a credit.');
        END IF;
        v_lines := v_lines || jsonb_build_object('child_tuition_id', NULL, 'fee_id', NULL, 'fee_name', 'One-time discount',
          'frequency', 'adjustment', 'period_start', v_ps, 'period_end', v_pe, 'start_date', v_ps, 'list_amount', 0,
          'discount_type', NULL, 'override_amount', NULL, 'discount_amount', v_take, 'net_amount', -v_take,
          'adjustment_id', v_a.id, 'reason', v_a.reason);
        t_adj := t_adj + v_take;
      END LOOP;
    END IF;

    -- Charges: payers in their own order, then what no payer covers
    FOR v_payer IN
      SELECT pp.* FROM child_payment_payers pp WHERE pp.child_id = v_c.id AND v_alloc ? pp.id::text AND (v_alloc ->> pp.id::text)::numeric > 0
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
    IF v_alloc ? 'unassigned' AND (v_alloc ->> 'unassigned')::numeric > 0 THEN
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
      'list', v_list, 'discount', v_disc, 'total', v_total,
      'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'child_tuition_id', e -> 'child_tuition_id', 'fee_id', e -> 'fee_id', 'fee_name', e -> 'fee_name',
                  'frequency', e -> 'frequency', 'period_start', e -> 'period_start', 'period_end', e -> 'period_end',
                  'list', e -> 'list_amount', 'discount', e -> 'discount_amount', 'net', e -> 'net_amount',
                  'adjustment_id', e -> 'adjustment_id',
                  'discount_label', CASE WHEN e ? 'adjustment_id' THEN e ->> 'reason'
                    WHEN e ->> 'discount_type' IS NULL AND e ->> 'override_amount' IS NULL THEN NULL
                    ELSE public.tuition_discount_label(e ->> 'discount_type', (e ->> 'discount_value')::numeric,
                           e ->> 'discount_reason', (e ->> 'override_amount')::numeric) END)), '[]')
                FROM jsonb_array_elements(v_lines) e),
      'charges', v_charges, 'skipped', v_skipped, 'warnings', v_warn);
  END LOOP;

  RETURN jsonb_build_object(
    'frequency', p_frequency, 'period_start', v_ps, 'period_end', v_pe, 'label', public.billing_window_label(p_frequency, v_ps),
    'children', v_children,
    'totals', jsonb_build_object('children', t_children, 'billable', t_billable, 'list', t_list, 'discount', t_disc,
      'total', t_total, 'ach_total', t_ach, 'ach_count', t_ach_n, 'manual_total', t_manual, 'unassigned_total', t_unassigned,
      'by_frequency', jsonb_build_object('weekly', t_w, 'biweekly', t_b, 'monthly', t_m, 'one_time', t_o), 'adjustments', t_adj));
END $$;


CREATE OR REPLACE FUNCTION public.billing_preview(p_center_id uuid, p_frequency text, p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_today date;
BEGIN
  PERFORM public.tuition_require(p_center_id);
  v := public.billing_compute(p_center_id, p_frequency, COALESCE(p_day, public.roster_today(p_center_id)));
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
  p_expected_total numeric, p_draft_date date DEFAULT NULL, p_note text DEFAULT NULL)
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

  v := public.billing_compute(p_center_id, p_frequency, v_ps);
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
        fee_period_start, fee_period_end, list_amount, discount_amount, net_amount, discount_label, adjustment_id)
      VALUES (p_center_id, v_bill, (v_c ->> 'child_id')::uuid, (v_l ->> 'child_tuition_id')::uuid, (v_l ->> 'fee_id')::uuid,
        v_l ->> 'fee_name', v_l ->> 'frequency', (v_l ->> 'period_start')::date, (v_l ->> 'period_end')::date,
        (v_l ->> 'list')::numeric, COALESCE((v_l ->> 'discount')::numeric, 0), COALESCE((v_l ->> 'net')::numeric, 0), v_l ->> 'discount_label',
        (v_l ->> 'adjustment_id')::uuid);
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
      'Billed ' || v_label || ': ' || public.tuition_money((v_c ->> 'list')::numeric)
      || CASE WHEN (v_c ->> 'discount')::numeric > 0 THEN ' − ' || public.tuition_money((v_c ->> 'discount')::numeric) || ' discount' ELSE '' END
      || ' = ' || public.tuition_money((v_c ->> 'total')::numeric));
    v_n := v_n + 1;
  END LOOP;

  RETURN v_run;
END $$;


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
  IF v_method IS NULL OR v_method NOT IN ('credit_card', 'debit_card', 'check', 'cash', 'other', 'credit') THEN
    RAISE EXCEPTION 'Pick how it was paid' USING ERRCODE = '22023';
  END IF;
  IF v_method = 'credit' AND v_note IS NULL THEN RAISE EXCEPTION 'Give a reason for the credit' USING ERRCODE = '22023'; END IF;
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
    CASE WHEN v_method = 'credit' THEN 'Credit given: ' || public.tuition_money(v_amt) || ' (' || v_note || ')'
    ELSE 'Payment received: ' || public.tuition_money(v_amt) || ' by ' || CASE v_method WHEN 'credit_card' THEN 'credit card' WHEN 'debit_card' THEN 'debit card' ELSE v_method END END
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
    'adjustments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount, 'reason', a.reason,
        'frequency', a.frequency, 'period_start', a.period_start, 'label', public.billing_window_label(a.frequency, a.period_start),
        'payer_id', a.payer_id, 'payer_name', (SELECT payer_name FROM child_payment_payers WHERE id = a.payer_id),
        'created_by', public.center_bank_who(a.created_by), 'created_at', a.created_at) ORDER BY a.period_start, a.created_at)
      FROM billing_adjustments a WHERE a.child_id = p_child_id AND NOT a.voided
        AND NOT EXISTS (SELECT 1 FROM billing_bill_lines bl WHERE bl.adjustment_id = a.id AND NOT bl.voided)), '[]'),
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


REVOKE ALL ON FUNCTION public.billing_compute(uuid, text, date) FROM PUBLIC, anon, authenticated;
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['billing_preview(uuid, text, date)', 'billing_run_submit(uuid, text, date, numeric, date, text)',
    'billing_adjustment_add(uuid, jsonb)', 'billing_adjustment_void(uuid, text)', 'billing_receive_payment(uuid, jsonb)', 'billing_child_account(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

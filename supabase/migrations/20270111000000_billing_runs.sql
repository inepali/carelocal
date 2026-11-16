-- ============================================================
-- Run Billing (tuition phase 2): weekly or monthly billing runs, a bill per child, a charge per payer, ACH drafts
-- queued for the bank, payments recorded by hand, and each child's billing history with year-to-date totals.
--
--  - Rides on Tuition (centers.tuition_enabled): the center's owner and admins run billing. Prices and payer shares
--    come from the tuition functions (tuition_lines, tuition_split), so the money math lives in one place.
--  - A weekly run bills weekly fees for that Monday-to-Sunday week, plus every-2-weeks fees whose period starts that
--    week. A monthly run bills monthly fees for that month. One-time fees dated inside the window are billed by the
--    first run that covers them. A fee period is never billed twice (unique index on bill lines).
--  - The run covers children enrolled at any point in the window (enrolled_on <= end, not withdrawn before start).
--  - Running a period again bills only what is still unbilled (children added since, one-time fees added since).
--    A child's weekly (or monthly) fees for a period are billed together; fee changes after billing are not re-billed.
--  - Each child's bill is split into one charge per payer line (tuition_split). One-time fees go to the payer who pays
--    "the rest" (else the first percent payer, else the first payer). Money no payer covers is an "unassigned" charge.
--  - ACH: a charge to an ACH payer with routing number, encrypted account number and a signed authorization on file is
--    queued as a draft in the run's ACH batch. Moov is not connected yet, so the owner downloads the batch as a Nacha
--    file (or CSV) for the center's bank, then marks it sent and later cleared. Returns re-open the balance.
--  - Card, check, cash and other payers: the charge stays open until someone records a payment (partial allowed).
--  - Nobody writes these tables directly. Owners and admins read them (RLS) and change them only through the
--    functions below. Voiding a run, downloading the ACH file (it carries full account numbers) are owner only.
-- Needs: 20270109000000_tuition_fees.sql, 20270109100000_tuition_bank_details.sql, 20270110000000_center_bank_account.sql
-- Rollback: supabase/rollbacks/20270111000000_billing_runs.down.sql
-- ============================================================

-- 1. Tables ----------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.billing_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id       uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  frequency       text NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  draft_date      date,                                  -- when ACH drafts are to be taken (Nacha effective entry date)
  status          text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'void')),
  child_count     integer NOT NULL DEFAULT 0,
  list_total      numeric(12,2) NOT NULL DEFAULT 0,      -- billing amount before discounts
  discount_total  numeric(12,2) NOT NULL DEFAULT 0,
  total           numeric(12,2) NOT NULL DEFAULT 0,
  ach_total       numeric(12,2) NOT NULL DEFAULT 0,      -- queued as ACH drafts
  manual_total    numeric(12,2) NOT NULL DEFAULT 0,      -- to be paid by card, check, cash or other (incl. unassigned)
  note            text CHECK (note IS NULL OR char_length(note) <= 300),
  submitted_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  voided_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at       timestamptz,
  void_reason     text CHECK (void_reason IS NULL OR char_length(void_reason) <= 300),
  UNIQUE (id, center_id),
  CONSTRAINT billing_runs_dates CHECK (period_end >= period_start),
  CONSTRAINT billing_runs_void CHECK ((status = 'void') = (voided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS billing_runs_center_idx ON public.billing_runs (center_id, period_start DESC, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_ach_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id     uuid NOT NULL,
  run_id        uuid NOT NULL,
  draft_date    date NOT NULL,
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'exported', 'sent', 'settled', 'void')),
  file_stale    boolean NOT NULL DEFAULT false,          -- a draft changed after the file was downloaded
  export_count  integer NOT NULL DEFAULT 0,
  exported_at   timestamptz,
  exported_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at       timestamptz,
  sent_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  settled_at    timestamptz,
  settled_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, center_id),
  FOREIGN KEY (run_id, center_id) REFERENCES public.billing_runs (id, center_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_ach_batches_run_unique ON public.billing_ach_batches (run_id);

CREATE TABLE IF NOT EXISTS public.billing_bills (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id        uuid NOT NULL,
  run_id           uuid NOT NULL,
  child_id         uuid NOT NULL,
  child_name       text NOT NULL,                        -- as it was when billed
  classroom_name   text,
  frequency        text NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  list_amount      numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount  numeric(12,2) NOT NULL DEFAULT 0,
  total            numeric(12,2) NOT NULL DEFAULT 0,
  voided           boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, center_id),
  FOREIGN KEY (run_id, center_id) REFERENCES public.billing_runs (id, center_id) ON DELETE CASCADE,
  FOREIGN KEY (child_id, center_id) REFERENCES public.children (id, center_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS billing_bills_run_idx ON public.billing_bills (run_id);
CREATE INDEX IF NOT EXISTS billing_bills_child_idx ON public.billing_bills (child_id, period_start DESC);

CREATE TABLE IF NOT EXISTS public.billing_bill_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id         uuid NOT NULL,
  bill_id           uuid NOT NULL,
  child_id          uuid NOT NULL,
  child_tuition_id  uuid REFERENCES public.child_tuition(id) ON DELETE SET NULL,
  fee_id            uuid,
  fee_name          text NOT NULL,
  frequency         text NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'one_time')),
  fee_period_start  date NOT NULL,
  fee_period_end    date NOT NULL,
  list_amount       numeric(12,2),                       -- NULL = the fee had no price that day
  discount_amount   numeric(12,2) NOT NULL DEFAULT 0,
  net_amount        numeric(12,2) NOT NULL DEFAULT 0,
  discount_label    text,
  voided            boolean NOT NULL DEFAULT false,
  FOREIGN KEY (bill_id, center_id) REFERENCES public.billing_bills (id, center_id) ON DELETE CASCADE
);
-- A fee's period is billed once (a voided run frees it to be billed again)
CREATE UNIQUE INDEX IF NOT EXISTS billing_bill_lines_once
  ON public.billing_bill_lines (child_tuition_id, fee_period_start) WHERE NOT voided AND child_tuition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_bill_lines_child_idx ON public.billing_bill_lines (child_id, frequency, fee_period_start) WHERE NOT voided;
CREATE INDEX IF NOT EXISTS billing_bill_lines_bill_idx ON public.billing_bill_lines (bill_id);

CREATE TABLE IF NOT EXISTS public.billing_charges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id        uuid NOT NULL,
  run_id           uuid NOT NULL,
  bill_id          uuid NOT NULL,
  child_id         uuid NOT NULL,
  payer_id         uuid REFERENCES public.child_payment_payers(id) ON DELETE SET NULL,
  payer_name       text NOT NULL,
  payer_kind       text,
  method           text NOT NULL CHECK (method IN ('ach', 'credit_card', 'check', 'other', 'unassigned')),
  account_type     text CHECK (account_type IN ('checking', 'savings')),
  last4            text CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  paid_amount      numeric(12,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'partial', 'paid', 'ach_scheduled', 'ach_sent', 'returned', 'void')),
  ach_batch_id     uuid REFERENCES public.billing_ach_batches(id) ON DELETE SET NULL,
  ach_return_code  text CHECK (ach_return_code IS NULL OR ach_return_code ~ '^R[0-9]{2}$'),
  note             text CHECK (note IS NULL OR char_length(note) <= 300),   -- e.g. why it isn't drafted by ACH
  sort_order       integer NOT NULL DEFAULT 0,          -- the payer's order on the bill
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, center_id),
  FOREIGN KEY (bill_id, center_id) REFERENCES public.billing_bills (id, center_id) ON DELETE CASCADE,
  CONSTRAINT billing_charges_ach_batch CHECK (status NOT IN ('ach_scheduled', 'ach_sent') OR ach_batch_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS billing_charges_bill_idx ON public.billing_charges (bill_id);
CREATE INDEX IF NOT EXISTS billing_charges_batch_idx ON public.billing_charges (ach_batch_id) WHERE ach_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_charges_child_idx ON public.billing_charges (child_id);

CREATE TABLE IF NOT EXISTS public.billing_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id    uuid NOT NULL,
  charge_id    uuid NOT NULL,
  bill_id      uuid NOT NULL,
  child_id     uuid NOT NULL,
  kind         text NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'ach', 'ach_return')),
  amount       numeric(12,2) NOT NULL CHECK (amount <> 0),   -- an ACH return is negative
  method       text NOT NULL CHECK (method IN ('ach', 'credit_card', 'check', 'cash', 'other')),
  reference    text CHECK (reference IS NULL OR char_length(reference) <= 60),   -- check number, card receipt
  received_on  date NOT NULL,
  note         text CHECK (note IS NULL OR char_length(note) <= 300),
  voided       boolean NOT NULL DEFAULT false,
  void_reason  text CHECK (void_reason IS NULL OR char_length(void_reason) <= 300),
  voided_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at    timestamptz,
  recorded_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (charge_id, center_id) REFERENCES public.billing_charges (id, center_id) ON DELETE CASCADE,
  CONSTRAINT billing_payments_sign CHECK ((kind = 'ach_return') = (amount < 0))
);
CREATE INDEX IF NOT EXISTS billing_payments_charge_idx ON public.billing_payments (charge_id);
CREATE INDEX IF NOT EXISTS billing_payments_child_idx ON public.billing_payments (child_id, received_on);

-- 2. Row-level security: read by the center's owner and admins; written only through the functions -------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_runs', 'billing_ach_batches', 'billing_bills', 'billing_bill_lines', 'billing_charges', 'billing_payments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Owners and admins read ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_view_confidential(center_id))', 'Owners and admins read ' || t, t);
  END LOOP;
END $$;

-- 3. Helpers ---------------------------------------------------------------------------------------------------

-- The billing window of a frequency that holds a day: Monday to Sunday, or the 1st to the end of the month
CREATE OR REPLACE FUNCTION public.billing_window(p_frequency text, p_day date, OUT period_start date, OUT period_end date)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p_frequency = 'weekly' THEN
    period_start := date_trunc('week', p_day)::date; period_end := period_start + 6;
  ELSIF p_frequency = 'monthly' THEN
    period_start := date_trunc('month', p_day)::date; period_end := (date_trunc('month', p_day) + interval '1 month - 1 day')::date;
  ELSE
    RAISE EXCEPTION 'Pick weekly or monthly billing' USING ERRCODE = '22023';
  END IF;
END $$;

-- "week of Nov 16, 2026" / "November 2026"
CREATE OR REPLACE FUNCTION public.billing_window_label(p_frequency text, p_start date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p_frequency = 'weekly' THEN 'week of ' || to_char(p_start, 'Mon FMDD, YYYY') ELSE to_char(p_start, 'FMMonth YYYY') END
$$;

CREATE OR REPLACE FUNCTION public.billing_log(p_center_id uuid, p_child_id uuid, p_table text, p_row uuid, p_action text, p_summary text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO child_audit_log (center_id, child_id, table_name, row_id, action, changed_by, summary)
  VALUES (p_center_id, p_child_id, p_table, p_row, p_action, auth.uid(), left(p_summary, 300));
$$;
REVOKE ALL ON FUNCTION public.billing_log(uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Why an ACH payer can't be drafted yet (NULL = ready)
CREATE OR REPLACE FUNCTION public.billing_ach_problem(p public.child_payment_payers)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p.method <> 'ach' THEN NULL
    WHEN p.routing_number IS NULL OR p.account_number_enc IS NULL THEN 'No bank account on file, so it can''t be drafted. Collect it by hand or add the bank details.'
    WHEN NOT p.authorization_on_file THEN 'No signed ACH authorization on file, so it can''t be drafted. Collect it by hand or add the authorization.'
    ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.billing_ach_problem(public.child_payment_payers) FROM PUBLIC, anon, authenticated;

-- Recompute a charge's paid amount and status from its payments
CREATE OR REPLACE FUNCTION public.billing_charge_refresh(p_charge_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_paid numeric;
BEGIN
  SELECT COALESCE(sum(amount), 0) INTO v_paid FROM billing_payments WHERE charge_id = p_charge_id AND NOT voided;
  UPDATE billing_charges SET paid_amount = v_paid, updated_at = now(),
    status = CASE
      WHEN status = 'void' THEN 'void'
      WHEN status IN ('ach_scheduled', 'ach_sent') AND v_paid = 0 THEN status
      WHEN v_paid >= amount THEN 'paid'
      WHEN v_paid > 0 THEN 'partial'
      WHEN status = 'returned' THEN 'returned'
      ELSE 'open' END
  WHERE id = p_charge_id;
END $$;
REVOKE ALL ON FUNCTION public.billing_charge_refresh(uuid) FROM PUBLIC, anon, authenticated;

-- 4. What a run bills: the one place the run is worked out (preview and submit both use it) ---------------------
-- { frequency, period_start, period_end, label,
--   children: [{child_id, name, classroom, status, billable, list, discount, total,
--               lines: [{child_tuition_id, fee_id, fee_name, frequency, period_start, period_end, list, discount, net, discount_label}],
--               charges: [{payer_id, payer_name, payer_kind, method, account_type, last4, amount, ach_ready, problem}],
--               skipped: [{frequency, run_id, reason}], warnings: [text]}],
--   totals: {children, billable, list, discount, total, ach_total, ach_count, manual_total, unassigned_total,
--            by_frequency: {weekly, biweekly, monthly, one_time}} }
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
      'list', v_list, 'discount', v_disc, 'total', v_total,
      'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'child_tuition_id', e -> 'child_tuition_id', 'fee_id', e -> 'fee_id', 'fee_name', e -> 'fee_name',
                  'frequency', e -> 'frequency', 'period_start', e -> 'period_start', 'period_end', e -> 'period_end',
                  'list', e -> 'list_amount', 'discount', e -> 'discount_amount', 'net', e -> 'net_amount',
                  'discount_label', CASE WHEN e ->> 'discount_type' IS NULL AND e ->> 'override_amount' IS NULL THEN NULL
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
      'by_frequency', jsonb_build_object('weekly', t_w, 'biweekly', t_b, 'monthly', t_m, 'one_time', t_o)));
END $$;
REVOKE ALL ON FUNCTION public.billing_compute(uuid, text, date) FROM PUBLIC, anon, authenticated;

-- 5. Preview and submit ----------------------------------------------------------------------------------------

-- What a run for the window holding p_day would bill, plus the runs already made for that window
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
    'center_bank', EXISTS (SELECT 1 FROM center_bank_accounts WHERE center_id = p_center_id AND status = 'active'),
    'runs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'total', r.total,
                        'child_count', r.child_count, 'submitted_at', r.submitted_at) ORDER BY r.submitted_at)
                      FROM billing_runs r WHERE r.center_id = p_center_id AND r.frequency = p_frequency
                        AND r.period_start = (v ->> 'period_start')::date), '[]'));
END $$;

-- Bill everything the preview shows. p_expected_total is the total the admin looked at: if anything changed since,
-- the run is refused so they look again. ACH-ready charges are queued in the run's ACH batch for p_draft_date.
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
        fee_period_start, fee_period_end, list_amount, discount_amount, net_amount, discount_label)
      VALUES (p_center_id, v_bill, (v_c ->> 'child_id')::uuid, (v_l ->> 'child_tuition_id')::uuid, (v_l ->> 'fee_id')::uuid,
        v_l ->> 'fee_name', v_l ->> 'frequency', (v_l ->> 'period_start')::date, (v_l ->> 'period_end')::date,
        (v_l ->> 'list')::numeric, COALESCE((v_l ->> 'discount')::numeric, 0), COALESCE((v_l ->> 'net')::numeric, 0), v_l ->> 'discount_label');
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

-- 6. Payments --------------------------------------------------------------------------------------------------

-- Record a card, check, cash or other payment on a charge. p: {amount, method, reference, received_on, note}
-- A charge still waiting in an unsent ACH batch is taken out of the batch (the family paid another way).
CREATE OR REPLACE FUNCTION public.billing_payment_record(p_charge_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c billing_charges%ROWTYPE; v_b billing_ach_batches%ROWTYPE; v_id uuid; v_today date;
  v_amt numeric := NULLIF(p ->> 'amount', '')::numeric;
  v_method text := NULLIF(p ->> 'method', '');
  v_ref text := NULLIF(btrim(COALESCE(p ->> 'reference', '')), '');
  v_on date := NULLIF(p ->> 'received_on', '')::date;
  v_note text := NULLIF(btrim(COALESCE(p ->> 'note', '')), '');
BEGIN
  SELECT * INTO v_c FROM billing_charges WHERE id = p_charge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Charge not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_c.center_id);
  v_today := public.roster_today(v_c.center_id);
  IF v_c.status = 'void' THEN RAISE EXCEPTION 'This charge was voided' USING ERRCODE = '22023'; END IF;
  IF v_c.status = 'ach_sent' THEN
    RAISE EXCEPTION 'This ACH draft was already sent to the bank. If it was returned, mark it returned first' USING ERRCODE = '22023';
  END IF;
  IF v_method IS NULL OR v_method NOT IN ('credit_card', 'check', 'cash', 'other') THEN
    RAISE EXCEPTION 'Pick how it was paid: card, check, cash or other' USING ERRCODE = '22023';
  END IF;
  IF v_amt IS NULL OR v_amt <= 0 OR v_amt <> round(v_amt, 2) THEN RAISE EXCEPTION 'Give the amount paid' USING ERRCODE = '22023'; END IF;
  IF v_amt > v_c.amount - v_c.paid_amount THEN
    RAISE EXCEPTION 'That is more than the % still due', public.tuition_money(v_c.amount - v_c.paid_amount) USING ERRCODE = '22023';
  END IF;
  v_on := COALESCE(v_on, v_today);
  IF v_on > v_today THEN RAISE EXCEPTION 'The payment date can''t be in the future' USING ERRCODE = '22023'; END IF;
  IF v_ref IS NOT NULL AND char_length(v_ref) > 60 THEN RAISE EXCEPTION 'Keep the reference to 60 characters' USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN RAISE EXCEPTION 'Keep the note to 300 characters' USING ERRCODE = '22023'; END IF;

  IF v_c.status = 'ach_scheduled' THEN
    SELECT * INTO v_b FROM billing_ach_batches WHERE id = v_c.ach_batch_id FOR UPDATE;
    IF v_b.status NOT IN ('scheduled', 'exported') THEN
      RAISE EXCEPTION 'This ACH draft was already sent to the bank' USING ERRCODE = '22023';
    END IF;
    UPDATE billing_charges SET status = 'open', ach_batch_id = NULL, note = 'Paid another way; taken out of the ACH draft'
    WHERE id = p_charge_id;
    IF v_b.status = 'exported' THEN UPDATE billing_ach_batches SET file_stale = true WHERE id = v_b.id; END IF;
  END IF;

  INSERT INTO billing_payments (center_id, charge_id, bill_id, child_id, kind, amount, method, reference, received_on, note, recorded_by)
  VALUES (v_c.center_id, v_c.id, v_c.bill_id, v_c.child_id, 'payment', v_amt, v_method, v_ref, v_on, v_note, auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.billing_charge_refresh(v_c.id);
  PERFORM public.billing_log(v_c.center_id, v_c.child_id, 'billing_payments', v_id, 'insert',
    'Payment recorded: ' || public.tuition_money(v_amt) || ' by ' || replace(v_method, 'credit_card', 'card')
    || COALESCE(' #' || v_ref, '') || ' from ' || v_c.payer_name || ' on ' || to_char(v_on, 'Mon FMDD, YYYY'));
  RETURN v_id;
END $$;

-- Undo a payment recorded by mistake (not ACH ones: use the batch and returns for those)
CREATE OR REPLACE FUNCTION public.billing_payment_void(p_payment_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p billing_payments%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM billing_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_p.center_id);
  IF v_p.voided THEN RAISE EXCEPTION 'This payment was already voided' USING ERRCODE = '22023'; END IF;
  IF v_p.kind <> 'payment' THEN RAISE EXCEPTION 'ACH payments change through the ACH batch (mark returned)' USING ERRCODE = '22023'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'Give a reason for voiding the payment' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM billing_charges WHERE id = v_p.charge_id FOR UPDATE;
  UPDATE billing_payments SET voided = true, void_reason = left(btrim(p_reason), 300), voided_by = auth.uid(), voided_at = now()
  WHERE id = p_payment_id;
  PERFORM public.billing_charge_refresh(v_p.charge_id);
  PERFORM public.billing_log(v_p.center_id, v_p.child_id, 'billing_payments', v_p.id, 'update',
    'Payment voided: ' || public.tuition_money(v_p.amount) || ' (' || btrim(p_reason) || ')');
END $$;

-- 7. ACH batch -------------------------------------------------------------------------------------------------

-- Owner: everything needed to write the bank file. Logged in each child's Activity and the center bank events,
-- because it carries full (encrypted) account numbers. The server decrypts; the plain numbers never reach the DB.
CREATE OR REPLACE FUNCTION public.billing_ach_export(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_b billing_ach_batches%ROWTYPE; v_bank center_bank_accounts%ROWTYPE; v_items jsonb; v_r record;
BEGIN
  SELECT * INTO v_b FROM billing_ach_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACH batch not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_b.center_id);
  IF NOT public.tuition_is_owner(v_b.center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner can download the ACH file (it has full bank account numbers)' USING ERRCODE = '42501';
  END IF;
  IF v_b.status NOT IN ('scheduled', 'exported') THEN
    RAISE EXCEPTION 'This batch was already sent to the bank' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_bank FROM center_bank_accounts WHERE center_id = v_b.center_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Add the center''s bank account first (About → Center Profile → Bank account for payments)' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('charge_id', c.id, 'payer_name', c.payer_name, 'child_name', b.child_name,
           'routing_number', pp.routing_number, 'account_type', COALESCE(pp.account_type, 'checking'),
           'account_number_enc', pp.account_number_enc, 'last4', pp.last4, 'amount', c.amount) ORDER BY b.child_name, c.payer_name), '[]')
    INTO v_items
  FROM billing_charges c JOIN billing_bills b ON b.id = c.bill_id JOIN child_payment_payers pp ON pp.id = c.payer_id
  WHERE c.ach_batch_id = p_batch_id AND c.status = 'ach_scheduled' AND pp.account_number_enc IS NOT NULL AND pp.routing_number IS NOT NULL;
  IF jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'No drafts left in this batch' USING ERRCODE = '22023'; END IF;
  -- Every queued draft must be in the file, or marking the batch sent would mark a draft the bank never got
  SELECT c.payer_name INTO v_r FROM billing_charges c LEFT JOIN child_payment_payers pp ON pp.id = c.payer_id
  WHERE c.ach_batch_id = p_batch_id AND c.status = 'ach_scheduled' AND (pp.id IS NULL OR pp.account_number_enc IS NULL OR pp.routing_number IS NULL)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'The bank details for % are no longer on file. Record that payment by hand (it comes out of the batch), then download again', v_r.payer_name
      USING ERRCODE = '22023';
  END IF;

  UPDATE billing_ach_batches SET status = 'exported', file_stale = false, export_count = export_count + 1,
    exported_at = now(), exported_by = auth.uid() WHERE id = p_batch_id;
  FOR v_r IN SELECT DISTINCT c.child_id, c.payer_name, c.last4, c.id FROM billing_charges c
             WHERE c.ach_batch_id = p_batch_id AND c.status = 'ach_scheduled' LOOP
    PERFORM public.billing_log(v_b.center_id, v_r.child_id, 'billing_charges', v_r.id, 'update',
      'ACH file downloaded with ' || v_r.payer_name || '''s account ····' || COALESCE(v_r.last4, ''));
  END LOOP;
  INSERT INTO center_bank_account_events (center_id, bank_account_id, action, user_id, summary)
  VALUES (v_b.center_id, v_bank.id, 'viewed', auth.uid(), 'ACH draft file downloaded (' || jsonb_array_length(v_items) || ' drafts)');

  RETURN jsonb_build_object(
    'batch_id', v_b.id, 'draft_date', v_b.draft_date,
    'center_name', (SELECT name FROM centers WHERE id = v_b.center_id),
    'bank', jsonb_build_object('account_holder_name', v_bank.account_holder_name, 'bank_name', v_bank.bank_name, 'routing_number', v_bank.routing_number,
      'account_type', v_bank.account_type, 'account_number_enc', v_bank.account_number_enc, 'last4', v_bank.last4),
    'items', v_items);
END $$;

-- Mark the batch sent to the bank ('sent') or cleared ('settled'). Clearing records an ACH payment on every draft
-- in the batch that wasn't returned.
CREATE OR REPLACE FUNCTION public.billing_ach_batch_mark(p_batch_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_b billing_ach_batches%ROWTYPE; v_c billing_charges%ROWTYPE; v_today date; v_pid uuid;
BEGIN
  SELECT * INTO v_b FROM billing_ach_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACH batch not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_b.center_id);
  v_today := public.roster_today(v_b.center_id);

  IF p_status = 'sent' THEN
    IF v_b.status <> 'exported' THEN RAISE EXCEPTION 'Download the ACH file before marking it sent' USING ERRCODE = '22023'; END IF;
    IF v_b.file_stale THEN RAISE EXCEPTION 'A draft changed after the file was downloaded. Download a new file first' USING ERRCODE = '22023'; END IF;
    UPDATE billing_ach_batches SET status = 'sent', sent_at = now(), sent_by = auth.uid() WHERE id = p_batch_id;
    UPDATE billing_charges SET status = 'ach_sent', updated_at = now() WHERE ach_batch_id = p_batch_id AND status = 'ach_scheduled';
  ELSIF p_status = 'settled' THEN
    IF v_b.status <> 'sent' THEN RAISE EXCEPTION 'Mark the batch sent first' USING ERRCODE = '22023'; END IF;
    UPDATE billing_ach_batches SET status = 'settled', settled_at = now(), settled_by = auth.uid() WHERE id = p_batch_id;
    FOR v_c IN SELECT * FROM billing_charges WHERE ach_batch_id = p_batch_id AND status = 'ach_sent' FOR UPDATE LOOP
      INSERT INTO billing_payments (center_id, charge_id, bill_id, child_id, kind, amount, method, received_on, note, recorded_by)
      VALUES (v_c.center_id, v_c.id, v_c.bill_id, v_c.child_id, 'ach', v_c.amount - v_c.paid_amount, 'ach', v_today,
        'ACH draft cleared', auth.uid())
      RETURNING id INTO v_pid;
      PERFORM public.billing_charge_refresh(v_c.id);
      PERFORM public.billing_log(v_c.center_id, v_c.child_id, 'billing_payments', v_pid, 'insert',
        'ACH draft cleared: ' || public.tuition_money(v_c.amount - v_c.paid_amount) || ' from ' || v_c.payer_name);
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unknown batch status' USING ERRCODE = '22023';
  END IF;
END $$;

-- A draft came back (insufficient funds, closed account...). p_code is the Nacha return code (R01, R02, ...).
-- Before clearing: the draft is marked returned. After clearing: the ACH payment is reversed. Either way the balance
-- is due again and can be collected by hand.
CREATE OR REPLACE FUNCTION public.billing_charge_ach_return(p_charge_id uuid, p_code text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c billing_charges%ROWTYPE; v_ach numeric; v_pid uuid; v_code text := upper(btrim(COALESCE(p_code, '')));
BEGIN
  SELECT * INTO v_c FROM billing_charges WHERE id = p_charge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Charge not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_c.center_id);
  IF v_code !~ '^R[0-9]{2}$' THEN RAISE EXCEPTION 'Give the bank''s return code, like R01' USING ERRCODE = '22023'; END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_ach FROM billing_payments WHERE charge_id = p_charge_id AND kind IN ('ach', 'ach_return') AND NOT voided;

  IF v_c.status = 'ach_sent' THEN
    UPDATE billing_charges SET status = 'returned', ach_return_code = v_code, note = left(NULLIF(btrim(COALESCE(p_note, '')), ''), 300), updated_at = now()
    WHERE id = p_charge_id;
  ELSIF v_ach > 0 THEN
    INSERT INTO billing_payments (center_id, charge_id, bill_id, child_id, kind, amount, method, received_on, note, recorded_by)
    VALUES (v_c.center_id, v_c.id, v_c.bill_id, v_c.child_id, 'ach_return', -v_ach, 'ach', public.roster_today(v_c.center_id),
      left('ACH return ' || v_code || COALESCE(': ' || NULLIF(btrim(p_note), ''), ''), 300), auth.uid())
    RETURNING id INTO v_pid;
    UPDATE billing_charges SET status = 'returned', ach_return_code = v_code, updated_at = now() WHERE id = p_charge_id;
    PERFORM public.billing_charge_refresh(v_c.id);
  ELSE
    RAISE EXCEPTION 'Only an ACH draft that was sent can be returned' USING ERRCODE = '22023';
  END IF;
  PERFORM public.billing_log(v_c.center_id, v_c.child_id, 'billing_charges', v_c.id, 'update',
    'ACH draft returned (' || v_code || '): ' || public.tuition_money(v_c.amount) || ' from ' || v_c.payer_name);
END $$;

-- 8. Void a run ------------------------------------------------------------------------------------------------
-- Owner only, with a reason, before any money came in and before the ACH file went to the bank. The bills stay on
-- file as voided, and their fee periods can be billed again.
CREATE OR REPLACE FUNCTION public.billing_run_void(p_run_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r billing_runs%ROWTYPE; v_b record;
BEGIN
  SELECT * INTO v_r FROM billing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing run not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_r.center_id);
  IF NOT public.tuition_is_owner(v_r.center_id) THEN RAISE EXCEPTION 'Only the center''s owner can void a billing run' USING ERRCODE = '42501'; END IF;
  IF v_r.status = 'void' THEN RAISE EXCEPTION 'This run was already voided' USING ERRCODE = '22023'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'Give a reason for voiding the run' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM billing_ach_batches WHERE run_id = p_run_id AND status IN ('sent', 'settled')) THEN
    RAISE EXCEPTION 'The ACH file for this run was already sent to the bank, so it can''t be voided' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM billing_payments p JOIN billing_charges c ON c.id = p.charge_id WHERE c.run_id = p_run_id AND NOT p.voided) THEN
    RAISE EXCEPTION 'Payments were recorded on this run. Void those payments first' USING ERRCODE = '22023';
  END IF;

  UPDATE billing_runs SET status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = left(btrim(p_reason), 300) WHERE id = p_run_id;
  UPDATE billing_ach_batches SET status = 'void' WHERE run_id = p_run_id;
  UPDATE billing_charges SET status = 'void', updated_at = now() WHERE run_id = p_run_id;
  UPDATE billing_bill_lines SET voided = true WHERE bill_id IN (SELECT id FROM billing_bills WHERE run_id = p_run_id);
  UPDATE billing_bills SET voided = true WHERE run_id = p_run_id;
  FOR v_b IN SELECT id, child_id, total FROM billing_bills WHERE run_id = p_run_id LOOP
    PERFORM public.billing_log(v_r.center_id, v_b.child_id, 'billing_bills', v_b.id, 'update',
      'Bill voided: ' || public.billing_window_label(v_r.frequency, v_r.period_start) || ', ' || public.tuition_money(v_b.total)
      || ' (' || btrim(p_reason) || ')');
  END LOOP;
END $$;

-- 9. Reading runs and history -----------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.billing_charge_json(c public.billing_charges)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', c.id, 'bill_id', c.bill_id, 'payer_id', c.payer_id, 'payer_name', c.payer_name,
    'payer_kind', c.payer_kind, 'method', c.method, 'account_type', c.account_type, 'last4', c.last4,
    'amount', c.amount, 'paid', c.paid_amount, 'balance', CASE WHEN c.status = 'void' THEN 0 ELSE c.amount - c.paid_amount END,
    'status', c.status, 'ach_batch_id', c.ach_batch_id, 'ach_return_code', c.ach_return_code, 'note', c.note,
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'amount', p.amount, 'method', p.method,
        'reference', p.reference, 'received_on', p.received_on, 'note', p.note, 'voided', p.voided, 'void_reason', p.void_reason,
        'recorded_by', public.center_bank_who(p.recorded_by), 'created_at', p.created_at) ORDER BY p.created_at)
      FROM billing_payments p WHERE p.charge_id = c.id), '[]'))
$$;
REVOKE ALL ON FUNCTION public.billing_charge_json(public.billing_charges) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.billing_run_summary(r public.billing_runs)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', r.id, 'frequency', r.frequency, 'period_start', r.period_start, 'period_end', r.period_end,
    'label', public.billing_window_label(r.frequency, r.period_start), 'draft_date', r.draft_date, 'status', r.status,
    'child_count', r.child_count, 'list_total', r.list_total, 'discount_total', r.discount_total, 'total', r.total,
    'ach_total', r.ach_total, 'manual_total', r.manual_total, 'note', r.note,
    'paid', COALESCE((SELECT sum(c.paid_amount) FROM billing_charges c WHERE c.run_id = r.id AND c.status <> 'void'), 0),
    'balance', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c WHERE c.run_id = r.id AND c.status <> 'void'), 0),
    'submitted_at', r.submitted_at, 'submitted_by', public.center_bank_who(r.submitted_by),
    'voided_at', r.voided_at, 'voided_by', public.center_bank_who(r.voided_by), 'void_reason', r.void_reason,
    'ach', (SELECT jsonb_build_object('id', b.id, 'status', b.status, 'draft_date', b.draft_date, 'file_stale', b.file_stale,
              'export_count', b.export_count, 'exported_at', b.exported_at, 'sent_at', b.sent_at, 'settled_at', b.settled_at,
              'count', (SELECT count(*) FROM billing_charges c WHERE c.ach_batch_id = b.id AND c.status IN ('ach_scheduled', 'ach_sent', 'paid', 'returned', 'partial')),
              'pending_total', COALESCE((SELECT sum(c.amount) FROM billing_charges c WHERE c.ach_batch_id = b.id AND c.status IN ('ach_scheduled', 'ach_sent')), 0))
            FROM billing_ach_batches b WHERE b.run_id = r.id))
$$;
REVOKE ALL ON FUNCTION public.billing_run_summary(public.billing_runs) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.billing_runs_list(p_center_id uuid, p_limit integer DEFAULT 52)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.tuition_require(p_center_id);
  RETURN COALESCE((SELECT jsonb_agg(public.billing_run_summary(r) ORDER BY r.period_start DESC, r.submitted_at DESC)
    FROM (SELECT * FROM billing_runs WHERE center_id = p_center_id ORDER BY period_start DESC, submitted_at DESC
          LIMIT LEAST(GREATEST(COALESCE(p_limit, 52), 1), 200)) r), '[]');
END $$;

-- { run, is_owner, today, bills: [{id, child_id, child_name, classroom_name, list, discount, total, paid, balance, voided,
--   lines: [...], charges: [...]}] }
CREATE OR REPLACE FUNCTION public.billing_run_get(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r billing_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM billing_runs WHERE id = p_run_id;
  IF NOT FOUND OR NOT public.tuition_can_manage(v_r.center_id) THEN
    RAISE EXCEPTION 'Billing run not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'run', public.billing_run_summary(v_r),
    'is_owner', public.tuition_is_owner(v_r.center_id),
    'today', public.roster_today(v_r.center_id),
    'bills', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'child_id', b.child_id, 'child_name', b.child_name,
        'classroom_name', b.classroom_name, 'list', b.list_amount, 'discount', b.discount_amount, 'total', b.total, 'voided', b.voided,
        'paid', COALESCE((SELECT sum(c.paid_amount) FROM billing_charges c WHERE c.bill_id = b.id AND c.status <> 'void'), 0),
        'balance', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c WHERE c.bill_id = b.id AND c.status <> 'void'), 0),
        'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('fee_name', l.fee_name, 'frequency', l.frequency,
            'period_start', l.fee_period_start, 'period_end', l.fee_period_end, 'list', l.list_amount, 'discount', l.discount_amount,
            'net', l.net_amount, 'discount_label', l.discount_label) ORDER BY l.frequency, l.fee_name)
          FROM billing_bill_lines l WHERE l.bill_id = b.id), '[]'),
        'charges', COALESCE((SELECT jsonb_agg(public.billing_charge_json(c) ORDER BY c.sort_order, c.created_at)
          FROM billing_charges c WHERE c.bill_id = b.id), '[]')
      ) ORDER BY lower(b.child_name)) FROM billing_bills b WHERE b.run_id = p_run_id), '[]'));
END $$;

-- A child's billing history for a calendar year (by period start), with year-to-date totals.
-- { year, years: [...], ytd: {list, discount, total, paid, balance, bills}, bills: [{... run label, lines, charges}] }
CREATE OR REPLACE FUNCTION public.billing_child_history(p_child_id uuid, p_year integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_center uuid; v_year int;
BEGIN
  SELECT center_id INTO v_center FROM children WHERE id = p_child_id;
  IF v_center IS NULL OR NOT public.tuition_can_manage(v_center) THEN
    RAISE EXCEPTION 'You do not have access to this child''s billing' USING ERRCODE = '42501';
  END IF;
  v_year := COALESCE(p_year, extract(year FROM public.roster_today(v_center))::int);
  RETURN jsonb_build_object(
    'year', v_year,
    'today', public.roster_today(v_center),
    'years', COALESCE((SELECT jsonb_agg(DISTINCT extract(year FROM b.period_start)::int) FROM billing_bills b WHERE b.child_id = p_child_id), '[]'),
    'ytd', (SELECT jsonb_build_object('bills', count(*), 'list', COALESCE(sum(b.list_amount), 0),
              'discount', COALESCE(sum(b.discount_amount), 0), 'total', COALESCE(sum(b.total), 0),
              'paid', COALESCE((SELECT sum(c.paid_amount) FROM billing_charges c JOIN billing_bills b2 ON b2.id = c.bill_id
                                WHERE b2.child_id = p_child_id AND NOT b2.voided AND c.status <> 'void'
                                  AND extract(year FROM b2.period_start) = v_year), 0),
              'balance', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c JOIN billing_bills b2 ON b2.id = c.bill_id
                                WHERE b2.child_id = p_child_id AND NOT b2.voided AND c.status <> 'void'
                                  AND extract(year FROM b2.period_start) = v_year), 0))
            FROM billing_bills b WHERE b.child_id = p_child_id AND NOT b.voided AND extract(year FROM b.period_start) = v_year),
    'balance_all', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c
                             WHERE c.child_id = p_child_id AND c.status <> 'void'), 0),
    'bills', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'run_id', b.run_id, 'frequency', b.frequency,
        'period_start', b.period_start, 'period_end', b.period_end, 'label', public.billing_window_label(b.frequency, b.period_start),
        'list', b.list_amount, 'discount', b.discount_amount, 'total', b.total, 'voided', b.voided, 'billed_at', b.created_at,
        'paid', COALESCE((SELECT sum(c.paid_amount) FROM billing_charges c WHERE c.bill_id = b.id AND c.status <> 'void'), 0),
        'balance', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c WHERE c.bill_id = b.id AND c.status <> 'void'), 0),
        'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('fee_name', l.fee_name, 'frequency', l.frequency,
            'period_start', l.fee_period_start, 'period_end', l.fee_period_end, 'list', l.list_amount, 'discount', l.discount_amount,
            'net', l.net_amount, 'discount_label', l.discount_label) ORDER BY l.frequency, l.fee_name)
          FROM billing_bill_lines l WHERE l.bill_id = b.id), '[]'),
        'charges', COALESCE((SELECT jsonb_agg(public.billing_charge_json(c) ORDER BY c.sort_order, c.created_at)
          FROM billing_charges c WHERE c.bill_id = b.id), '[]')
      ) ORDER BY b.period_start DESC, b.created_at DESC)
      FROM billing_bills b WHERE b.child_id = p_child_id AND extract(year FROM b.period_start) = v_year), '[]'));
END $$;

-- 10. Grants ---------------------------------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'billing_preview(uuid, text, date)',
    'billing_run_submit(uuid, text, date, numeric, date, text)',
    'billing_payment_record(uuid, jsonb)',
    'billing_payment_void(uuid, text)',
    'billing_ach_export(uuid)',
    'billing_ach_batch_mark(uuid, text)',
    'billing_charge_ach_return(uuid, text, text)',
    'billing_run_void(uuid, text)',
    'billing_runs_list(uuid, integer)',
    'billing_run_get(uuid)',
    'billing_child_history(uuid, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- ============================================================
-- Tuition fees and payment (phase 1): a dated rate card per program, fees on each child, and who pays how
--
--  - centers.tuition_enabled (off by default) is the module switch. Only a super admin changes it (guard_tuition_flag).
--  - tuition_fees is the rate card: one row per fee ("Toddler · Full-time (5 days)", weekly), grouped by program.
--  - tuition_fee_rates holds each fee's dated prices. Two rates of one fee never overlap. A price change is a new
--    rate from a date (tuition_rate_set), so earlier periods keep the price they had.
--  - child_tuition is the fees on a child, each dated, with an optional % / $ discount or a locked-in price.
--  - child_payment_payers is who pays: one or more payer lines per child (a guardian or an outside payer such as a
--    subsidy agency), each with a share (fixed, percent or "the rest") and a method (ACH, card, check, other).
--  - Which price applies: the whole week / two weeks / month uses the rate in force on the first day of that period
--    (or on the child's start day if later). No proration.
--  - Changes dated before today (center time) need the center's owner and a reason. Everything is logged in the
--    child's Activity (child_audit_log) or, for the rate card, kept as dated rows.
--  - Never stored: full bank account, routing or card numbers. Only the last 4 digits and the bank or card brand.
--  - Nobody writes these tables directly. Owners and admins read them (RLS) and change them only through the
--    functions below, with the module switched on.
--  - Withdrawing a child ends their fees and payer lines on the withdrawal day.
-- Needs: child files (children, child_guardians, child_files, child_audit_log), center programs, roster_today().
-- Rollback: supabase/rollbacks/20270109000000_tuition_fees.down.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Module switch ---------------------------------------------------------------------------------------------
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS tuition_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_tuition_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tuition_enabled IS NOT DISTINCT FROM OLD.tuition_enabled THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.tuition_enabled := OLD.tuition_enabled;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_tuition_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_tuition_flag ON public.centers;
CREATE TRIGGER trg_guard_tuition_flag BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_tuition_flag();

-- 2. Rate card -------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tuition_fees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  program_id  uuid REFERENCES public.center_programs(id) ON DELETE RESTRICT,   -- NULL = any program (Registration, ...)
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  kind        text NOT NULL DEFAULT 'tuition'
                CHECK (kind IN ('tuition', 'registration', 'annual', 'activity', 'late_pickup', 'other')),
  frequency   text NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'one_time')),
  is_active   boolean NOT NULL DEFAULT true,       -- inactive = can't be added to a child; children who have it keep it
  sort_order  integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, center_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS tuition_fees_name_unique
  ON public.tuition_fees (center_id, program_id, lower(btrim(name))) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS tuition_fees_center_idx ON public.tuition_fees (center_id, sort_order);

CREATE TABLE IF NOT EXISTS public.tuition_fee_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id       uuid NOT NULL,
  fee_id          uuid NOT NULL,
  amount          numeric(10,2) NOT NULL CHECK (amount >= 0 AND amount <= 100000),
  effective_from  date NOT NULL,
  effective_to    date,                                   -- NULL = until changed
  note            text CHECK (note IS NULL OR char_length(note) <= 300),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (fee_id, center_id) REFERENCES public.tuition_fees (id, center_id) ON DELETE CASCADE,
  CONSTRAINT tuition_fee_rates_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT tuition_fee_rates_no_overlap EXCLUDE USING gist
    (fee_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
);
CREATE INDEX IF NOT EXISTS tuition_fee_rates_fee_idx ON public.tuition_fee_rates (fee_id, effective_from);

-- 3. Fees on a child -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.child_tuition (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id        uuid NOT NULL,
  child_id         uuid NOT NULL,
  fee_id           uuid NOT NULL,
  start_date       date NOT NULL,
  end_date         date,                                 -- NULL = until changed; a one-time fee ends on its start day
  discount_type    text CHECK (discount_type IN ('percent', 'amount')),
  discount_value   numeric(10,2) CHECK (discount_value IS NULL OR discount_value >= 0),
  discount_reason  text CHECK (discount_reason IS NULL OR char_length(discount_reason) <= 120),
  override_amount  numeric(10,2) CHECK (override_amount IS NULL OR (override_amount >= 0 AND override_amount <= 100000)),
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (child_id, center_id) REFERENCES public.children (id, center_id) ON DELETE CASCADE,
  FOREIGN KEY (fee_id, center_id) REFERENCES public.tuition_fees (id, center_id) ON DELETE RESTRICT,
  CONSTRAINT child_tuition_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT child_tuition_discount_pair CHECK ((discount_type IS NULL) = (discount_value IS NULL)),
  CONSTRAINT child_tuition_discount_or_override CHECK (discount_type IS NULL OR override_amount IS NULL),
  CONSTRAINT child_tuition_percent_max CHECK (discount_type IS DISTINCT FROM 'percent' OR discount_value <= 100),
  CONSTRAINT child_tuition_no_overlap EXCLUDE USING gist
    (child_id WITH =, fee_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);
CREATE INDEX IF NOT EXISTS child_tuition_child_idx ON public.child_tuition (child_id, start_date);
CREATE INDEX IF NOT EXISTS child_tuition_fee_idx ON public.child_tuition (fee_id);

-- 4. Who pays --------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.child_payment_payers (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id                  uuid NOT NULL,
  child_id                   uuid NOT NULL,
  payer_guardian_id          uuid REFERENCES public.child_guardians(id) ON DELETE SET NULL,
  payer_name                 text NOT NULL CHECK (char_length(btrim(payer_name)) BETWEEN 1 AND 120), -- kept even if the guardian row goes
  payer_kind                 text NOT NULL DEFAULT 'family' CHECK (payer_kind IN ('family', 'subsidy', 'employer', 'other')),
  share_type                 text NOT NULL CHECK (share_type IN ('percent', 'fixed', 'remainder')),
  share_value                numeric(10,2) CHECK (share_value IS NULL OR share_value >= 0),
  fixed_frequency            text CHECK (fixed_frequency IN ('weekly', 'biweekly', 'monthly')),  -- the total a fixed amount comes off
  method                     text NOT NULL CHECK (method IN ('ach', 'credit_card', 'check', 'other')),
  bank_name                  text CHECK (bank_name IS NULL OR char_length(bank_name) <= 80),
  account_type               text CHECK (account_type IN ('checking', 'savings')),
  last4                      text CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
  card_brand                 text CHECK (card_brand IS NULL OR char_length(card_brand) <= 20),
  other_details              text CHECK (other_details IS NULL OR char_length(other_details) <= 300),
  draft_day                  text CHECK (draft_day IS NULL OR char_length(draft_day) <= 20),
  authorization_on_file      boolean NOT NULL DEFAULT false,
  authorization_signed_on    date,
  authorization_file_id      uuid REFERENCES public.child_files(id) ON DELETE SET NULL,
  sort_order                 integer NOT NULL DEFAULT 0,
  effective_from             date NOT NULL,
  effective_to               date,
  created_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (child_id, center_id) REFERENCES public.children (id, center_id) ON DELETE CASCADE,
  CONSTRAINT child_payment_payers_share CHECK (
    (share_type = 'remainder' AND share_value IS NULL AND fixed_frequency IS NULL)
    OR (share_type = 'percent' AND share_value > 0 AND share_value <= 100 AND fixed_frequency IS NULL)
    OR (share_type = 'fixed' AND share_value > 0 AND fixed_frequency IS NOT NULL)
  ),
  CONSTRAINT child_payment_payers_card_or_bank CHECK (method IN ('ach', 'credit_card') OR (last4 IS NULL AND account_type IS NULL)),
  CONSTRAINT child_payment_payers_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS child_payment_payers_child_idx ON public.child_payment_payers (child_id, effective_from);

-- 5. Row-level security: read by the center's owner and admins; written only through the functions -------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tuition_fees', 'tuition_fee_rates', 'child_tuition', 'child_payment_payers'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Owners and admins read ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_view_confidential(center_id))', 'Owners and admins read ' || t, t);
  END LOOP;
END $$;

-- 6. Helpers ---------------------------------------------------------------------------------------------------

-- Owner or admin of the center, with Tuition switched on
CREATE OR REPLACE FUNCTION public.tuition_can_manage(p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_confidential(p_center_id)
     AND COALESCE((SELECT c.tuition_enabled FROM centers c WHERE c.id = p_center_id), false);
$$;

CREATE OR REPLACE FUNCTION public.tuition_is_owner(p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role = 'owner');
$$;
REVOKE ALL ON FUNCTION public.tuition_is_owner(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.tuition_require(p_center_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.tuition_can_manage(p_center_id) THEN
    RAISE EXCEPTION 'Tuition is not turned on for your center, or you cannot change it' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.tuition_require(uuid) FROM PUBLIC, anon, authenticated;

-- A change that takes effect before today rewrites what a past period cost: the owner only, with a reason
CREATE OR REPLACE FUNCTION public.tuition_require_past_ok(p_center_id uuid, p_date date, p_note text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_date >= public.roster_today(p_center_id) THEN RETURN; END IF;
  IF NOT public.tuition_is_owner(p_center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner can make a change dated before today' USING ERRCODE = '42501';
  END IF;
  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'Give a reason for a change dated before today' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.tuition_require_past_ok(uuid, date, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tuition_log(p_center_id uuid, p_child_id uuid, p_table text, p_row uuid, p_action text, p_summary text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO child_audit_log (center_id, child_id, table_name, row_id, action, changed_by, summary)
  VALUES (p_center_id, p_child_id, p_table, p_row, p_action, auth.uid(), left(p_summary, 300));
$$;
REVOKE ALL ON FUNCTION public.tuition_log(uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tuition_money(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT '$' || to_char(p, 'FM999,990.00') $$;

-- The billing period of a frequency that holds a day. Weeks start on Monday, months on the 1st; two-week periods
-- count from the anchor (the child's start day for that fee).
CREATE OR REPLACE FUNCTION public.tuition_period(p_frequency text, p_anchor date, p_day date, OUT period_start date, OUT period_end date)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p_frequency = 'weekly' THEN
    period_start := date_trunc('week', p_day)::date; period_end := period_start + 6;
  ELSIF p_frequency = 'biweekly' THEN
    period_start := p_anchor + 14 * floor((p_day - p_anchor) / 14.0)::int; period_end := period_start + 13;
  ELSIF p_frequency = 'monthly' THEN
    period_start := date_trunc('month', p_day)::date; period_end := (date_trunc('month', p_day) + interval '1 month - 1 day')::date;
  ELSE
    period_start := p_anchor; period_end := p_anchor;
  END IF;
END $$;

-- The first day a rate starting on p_day is charged: p_day if a period starts that day, else the next period start
CREATE OR REPLACE FUNCTION public.tuition_first_charged(p_frequency text, p_anchor date, p_day date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p.period_start = p_day OR p_frequency = 'one_time' THEN p_day ELSE p.period_end + 1 END
  FROM public.tuition_period(p_frequency, p_anchor, p_day) p
$$;

-- The rate of a fee in force on a day
CREATE OR REPLACE FUNCTION public.tuition_rate_on(p_fee_id uuid, p_day date)
RETURNS public.tuition_fee_rates LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.* FROM tuition_fee_rates r
  WHERE r.fee_id = p_fee_id AND r.effective_from <= p_day AND (r.effective_to IS NULL OR r.effective_to >= p_day)
$$;
REVOKE ALL ON FUNCTION public.tuition_rate_on(uuid, date) FROM PUBLIC, anon, authenticated;

-- 7. Price of a child's fees: the one place the math lives ------------------------------------------------------
-- Every recurring fee whose dates touch the period (of its own frequency) that holds p_day, priced at the rate in
-- force on the period's first day, or on the fee's start day if it starts later in that period. No proration.
-- One-time fees are priced at their own day and come back only when p_day is that day.
CREATE OR REPLACE FUNCTION public.tuition_lines(p_child_id uuid, p_day date)
RETURNS TABLE (
  child_tuition_id uuid, fee_id uuid, fee_name text, kind text, frequency text, program_id uuid,
  period_start date, period_end date, rate_date date, rate_id uuid,
  list_amount numeric, discount_type text, discount_value numeric, discount_reason text, override_amount numeric,
  discount_amount numeric, net_amount numeric, start_date date, end_date date
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH a AS (
    SELECT ct.*, f.name AS fname, f.kind AS fkind, f.frequency AS ffreq, f.program_id AS fprog, p.period_start AS ps, p.period_end AS pe
    FROM child_tuition ct
    JOIN tuition_fees f ON f.id = ct.fee_id
    CROSS JOIN LATERAL public.tuition_period(f.frequency, ct.start_date, p_day) p
    WHERE ct.child_id = p_child_id
      AND ct.start_date <= p.period_end AND (ct.end_date IS NULL OR ct.end_date >= p.period_start)
      AND (f.frequency <> 'one_time' OR ct.start_date = p_day)
  ), r AS (
    SELECT a.*, GREATEST(a.ps, a.start_date) AS rd, rt.id AS rid, rt.amount AS list
    FROM a LEFT JOIN LATERAL public.tuition_rate_on(a.fee_id, GREATEST(a.ps, a.start_date)) rt ON true
  ), d AS (
    SELECT r.*,
      CASE WHEN r.override_amount IS NOT NULL OR r.list IS NULL THEN 0
           WHEN r.discount_type = 'percent' THEN round(r.list * r.discount_value / 100, 2)
           WHEN r.discount_type = 'amount' THEN LEAST(r.discount_value, r.list)
           ELSE 0 END AS disc
    FROM r
  )
  SELECT d.id, d.fee_id, d.fname, d.fkind, d.ffreq, d.fprog, d.ps, d.pe, d.rd, d.rid,
         d.list, d.discount_type, d.discount_value, d.discount_reason, d.override_amount,
         d.disc, COALESCE(d.override_amount, GREATEST(d.list - d.disc, 0)), d.start_date, d.end_date
  FROM d ORDER BY d.ffreq, d.fname
$$;
REVOKE ALL ON FUNCTION public.tuition_lines(uuid, date) FROM PUBLIC, anon, authenticated;

-- How each period's total is split between the payer lines in force on p_day, per frequency:
--   fixed amounts (of that frequency) first, then percents of what is left, then "the rest".
--   Percent shares round down to the cent, so the split never asks for more than the total. The cents left over
--   go to "the rest" or, when the percents make 100%, to the first percent line.
--   unassigned = money no payer covers; over = fixed amounts beyond the total.
-- [{frequency, period_start, period_end, total, unassigned, over, payers: [{payer_id, amount}]}]
CREATE OR REPLACE FUNCTION public.tuition_split(p_child_id uuid, p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out jsonb := '[]'; v_f record; v_left numeric; v_fixed numeric; v_pct_sum numeric; v_given numeric;
  v_payers jsonb; v_line record; v_amt numeric; v_first_pct uuid; v_rest uuid; v_unassigned numeric; v_over numeric;
BEGIN
  FOR v_f IN
    SELECT l.frequency, min(l.period_start) AS ps, max(l.period_end) AS pe, sum(COALESCE(l.net_amount, 0)) AS total
    FROM public.tuition_lines(p_child_id, p_day) l WHERE l.frequency <> 'one_time'
    GROUP BY l.frequency ORDER BY array_position(ARRAY['weekly', 'biweekly', 'monthly'], l.frequency)
  LOOP
    v_payers := '[]'; v_given := 0; v_first_pct := NULL; v_rest := NULL;
    SELECT COALESCE(sum(share_value), 0) INTO v_fixed FROM child_payment_payers
      WHERE child_id = p_child_id AND share_type = 'fixed' AND fixed_frequency = v_f.frequency
        AND effective_from <= p_day AND (effective_to IS NULL OR effective_to >= p_day);
    v_over := GREATEST(v_fixed - v_f.total, 0);
    v_left := GREATEST(v_f.total - v_fixed, 0);
    SELECT COALESCE(sum(share_value), 0) INTO v_pct_sum FROM child_payment_payers
      WHERE child_id = p_child_id AND share_type = 'percent'
        AND effective_from <= p_day AND (effective_to IS NULL OR effective_to >= p_day);

    FOR v_line IN
      SELECT * FROM child_payment_payers
      WHERE child_id = p_child_id AND effective_from <= p_day AND (effective_to IS NULL OR effective_to >= p_day)
        AND (share_type <> 'fixed' OR fixed_frequency = v_f.frequency)
      ORDER BY array_position(ARRAY['fixed', 'percent', 'remainder'], share_type), sort_order, created_at
    LOOP
      IF v_line.share_type = 'fixed' THEN
        -- If fixed amounts are more than the total, they are cut down in order so nobody is asked for more than it costs
        v_amt := LEAST(v_line.share_value, GREATEST(v_f.total - v_given, 0));
      ELSIF v_line.share_type = 'percent' THEN
        v_amt := floor(v_left * v_line.share_value) / 100;   -- down to the cent; the cents left over are given out below
        v_first_pct := COALESCE(v_first_pct, v_line.id);
      ELSE
        v_rest := v_line.id;
        v_amt := 0;   -- filled in below
      END IF;
      v_given := v_given + v_amt;
      v_payers := v_payers || jsonb_build_object('payer_id', v_line.id, 'amount', v_amt);
    END LOOP;

    v_unassigned := GREATEST(v_f.total - v_given, 0);
    IF v_rest IS NOT NULL THEN
      v_payers := (SELECT jsonb_agg(CASE WHEN (e ->> 'payer_id')::uuid = v_rest THEN jsonb_set(e, '{amount}', to_jsonb(v_unassigned)) ELSE e END)
                   FROM jsonb_array_elements(v_payers) e);
      v_unassigned := 0;
    ELSIF v_first_pct IS NOT NULL AND v_pct_sum = 100 THEN
      -- rounding cents
      v_payers := (SELECT jsonb_agg(CASE WHEN (e ->> 'payer_id')::uuid = v_first_pct
                                         THEN jsonb_set(e, '{amount}', to_jsonb((e ->> 'amount')::numeric + v_unassigned)) ELSE e END)
                   FROM jsonb_array_elements(v_payers) e);
      v_unassigned := 0;
    END IF;

    v_out := v_out || jsonb_build_object('frequency', v_f.frequency, 'period_start', v_f.ps, 'period_end', v_f.pe,
      'total', v_f.total, 'unassigned', v_unassigned, 'over', v_over, 'payers', v_payers);
  END LOOP;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.tuition_split(uuid, date) FROM PUBLIC, anon, authenticated;

-- Public, checked: what a child owes for the periods that hold p_day (for reports and, later, autopay)
CREATE OR REPLACE FUNCTION public.child_tuition_on(p_child_id uuid, p_day date)
RETURNS TABLE (
  child_tuition_id uuid, fee_name text, frequency text, period_start date, period_end date,
  list_amount numeric, discount_amount numeric, net_amount numeric, rate_id uuid
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_center uuid;
BEGIN
  SELECT center_id INTO v_center FROM children WHERE id = p_child_id;
  IF v_center IS NULL OR NOT public.tuition_can_manage(v_center) THEN
    RAISE EXCEPTION 'You do not have access to this child''s tuition' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT l.child_tuition_id, l.fee_name, l.frequency, l.period_start, l.period_end,
                      l.list_amount, l.discount_amount, l.net_amount, l.rate_id
               FROM public.tuition_lines(p_child_id, p_day) l;
END $$;

CREATE OR REPLACE FUNCTION public.child_payment_split(p_child_id uuid, p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_center uuid;
BEGIN
  SELECT center_id INTO v_center FROM children WHERE id = p_child_id;
  IF v_center IS NULL OR NOT public.tuition_can_manage(v_center) THEN
    RAISE EXCEPTION 'You do not have access to this child''s tuition' USING ERRCODE = '42501';
  END IF;
  RETURN public.tuition_split(p_child_id, p_day);
END $$;

-- 8. Rate card: list, save a fee, set or remove a dated rate -----------------------------------------------------

-- { can_manage, is_owner, today, programs: [{id, name, is_active}],
--   fees: [{id, program_id, name, kind, frequency, is_active, sort_order, children, current, upcoming, rates: [...]}] }
CREATE OR REPLACE FUNCTION public.tuition_fees_list(p_center_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today date;
BEGIN
  PERFORM public.tuition_require(p_center_id);
  v_today := public.roster_today(p_center_id);
  RETURN jsonb_build_object(
    'can_manage', true,
    'is_owner', public.tuition_is_owner(p_center_id),
    'today', v_today,
    'programs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'is_active', p.is_active) ORDER BY p.sort_order, p.created_at)
                          FROM center_programs p WHERE p.center_id = p_center_id), '[]'),
    'fees', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'program_id', f.program_id, 'name', f.name, 'kind', f.kind, 'frequency', f.frequency,
        'is_active', f.is_active, 'sort_order', f.sort_order,
        'children', (SELECT count(DISTINCT ct.child_id) FROM child_tuition ct
                     WHERE ct.fee_id = f.id AND (ct.end_date IS NULL OR ct.end_date >= v_today)),
        'current', (SELECT jsonb_build_object('id', r.id, 'amount', r.amount, 'from', r.effective_from, 'to', r.effective_to)
                    FROM tuition_fee_rates r WHERE r.fee_id = f.id AND r.effective_from <= v_today
                      AND (r.effective_to IS NULL OR r.effective_to >= v_today)),
        'upcoming', (SELECT jsonb_build_object('id', r.id, 'amount', r.amount, 'from', r.effective_from)
                     FROM tuition_fee_rates r WHERE r.fee_id = f.id AND r.effective_from > v_today
                     ORDER BY r.effective_from LIMIT 1),
        'rates', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'from', r.effective_from,
                                   'to', r.effective_to, 'note', r.note, 'created_at', r.created_at) ORDER BY r.effective_from DESC)
                           FROM tuition_fee_rates r WHERE r.fee_id = f.id), '[]')
      ) ORDER BY f.sort_order, f.name)
      FROM tuition_fees f WHERE f.center_id = p_center_id), '[]')
  );
END $$;

-- Add or change a fee. p: {id?, program_id, name, kind, frequency, is_active, sort_order, amount, from}
-- A new fee needs its first rate (amount, from). The frequency is fixed once any child has had the fee.
CREATE OR REPLACE FUNCTION public.tuition_fee_save(p_center_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := NULLIF(p ->> 'id', '')::uuid;
  v_program uuid := NULLIF(p ->> 'program_id', '')::uuid;
  v_name text := btrim(COALESCE(p ->> 'name', ''));
  v_kind text := COALESCE(NULLIF(p ->> 'kind', ''), 'tuition');
  v_freq text := NULLIF(p ->> 'frequency', '');
  v_amount numeric := NULLIF(p ->> 'amount', '')::numeric;
  v_from date := NULLIF(p ->> 'from', '')::date;
  v_old tuition_fees%ROWTYPE;
BEGIN
  PERFORM public.tuition_require(p_center_id);
  IF v_name = '' THEN RAISE EXCEPTION 'Give the fee a name' USING ERRCODE = '22023'; END IF;
  IF v_freq IS NULL OR v_freq NOT IN ('weekly', 'biweekly', 'monthly', 'one_time') THEN
    RAISE EXCEPTION 'Pick how often the fee is charged' USING ERRCODE = '22023';
  END IF;
  IF v_program IS NOT NULL AND NOT EXISTS (SELECT 1 FROM center_programs WHERE id = v_program AND center_id = p_center_id) THEN
    RAISE EXCEPTION 'That program belongs to another center' USING ERRCODE = '42501';
  END IF;

  IF v_id IS NULL THEN
    IF v_amount IS NULL OR v_amount < 0 THEN RAISE EXCEPTION 'Give the fee''s amount' USING ERRCODE = '22023'; END IF;
    IF v_from IS NULL THEN RAISE EXCEPTION 'Give the date the amount starts' USING ERRCODE = '22023'; END IF;
    INSERT INTO tuition_fees (center_id, program_id, name, kind, frequency, is_active, sort_order, created_by)
    VALUES (p_center_id, v_program, v_name, v_kind, v_freq, COALESCE((p ->> 'is_active')::boolean, true),
            COALESCE(NULLIF(p ->> 'sort_order', '')::int, 0), auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO tuition_fee_rates (center_id, fee_id, amount, effective_from, note, created_by)
    VALUES (p_center_id, v_id, v_amount, v_from, 'First rate', auth.uid());
    RETURN v_id;
  END IF;

  SELECT * INTO v_old FROM tuition_fees WHERE id = v_id AND center_id = p_center_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fee not found' USING ERRCODE = 'P0002'; END IF;
  IF v_freq <> v_old.frequency AND EXISTS (SELECT 1 FROM child_tuition WHERE fee_id = v_id) THEN
    RAISE EXCEPTION 'Children already have this fee, so how often it is charged can''t change. Add a new fee instead'
      USING ERRCODE = '22023';
  END IF;
  UPDATE tuition_fees SET program_id = v_program, name = v_name, kind = v_kind, frequency = v_freq,
    is_active = COALESCE((p ->> 'is_active')::boolean, is_active),
    sort_order = COALESCE(NULLIF(p ->> 'sort_order', '')::int, sort_order), updated_at = now()
  WHERE id = v_id;
  RETURN v_id;
END $$;

-- A fee no child has ever had can be deleted (with its rates). Otherwise turn it off.
CREATE OR REPLACE FUNCTION public.tuition_fee_delete(p_fee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_center uuid;
BEGIN
  SELECT center_id INTO v_center FROM tuition_fees WHERE id = p_fee_id;
  IF v_center IS NULL THEN RAISE EXCEPTION 'Fee not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_center);
  IF EXISTS (SELECT 1 FROM child_tuition WHERE fee_id = p_fee_id) THEN
    RAISE EXCEPTION 'Children have had this fee, so it stays on file. Turn it off instead' USING ERRCODE = '22023';
  END IF;
  DELETE FROM tuition_fees WHERE id = p_fee_id;
END $$;

-- The fee costs p_amount from p_from on, until the next rate already set (if any).
-- A rate that starts on p_from gets the new amount; a rate running through p_from is closed the day before.
CREATE OR REPLACE FUNCTION public.tuition_rate_set(p_fee_id uuid, p_amount numeric, p_from date, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fee tuition_fees%ROWTYPE; v_cover tuition_fee_rates%ROWTYPE; v_next date; v_to date; v_id uuid;
BEGIN
  SELECT * INTO v_fee FROM tuition_fees WHERE id = p_fee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fee not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_fee.center_id);
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'Give an amount of $0 or more' USING ERRCODE = '22023'; END IF;
  IF p_from IS NULL THEN RAISE EXCEPTION 'Give the date the amount starts' USING ERRCODE = '22023'; END IF;
  PERFORM public.tuition_require_past_ok(v_fee.center_id, p_from, p_note);

  SELECT * INTO v_cover FROM tuition_fee_rates WHERE fee_id = p_fee_id AND effective_from = p_from;
  IF FOUND THEN
    UPDATE tuition_fee_rates SET amount = p_amount, note = NULLIF(btrim(COALESCE(p_note, '')), ''), created_by = auth.uid()
    WHERE id = v_cover.id;
    RETURN v_cover.id;
  END IF;

  SELECT * INTO v_cover FROM tuition_fee_rates
  WHERE fee_id = p_fee_id AND effective_from < p_from AND (effective_to IS NULL OR effective_to >= p_from);
  IF FOUND THEN
    v_to := v_cover.effective_to;
    UPDATE tuition_fee_rates SET effective_to = p_from - 1 WHERE id = v_cover.id;
  ELSE
    SELECT min(effective_from) INTO v_next FROM tuition_fee_rates WHERE fee_id = p_fee_id AND effective_from > p_from;
    v_to := v_next - 1;
  END IF;
  INSERT INTO tuition_fee_rates (center_id, fee_id, amount, effective_from, effective_to, note, created_by)
  VALUES (v_fee.center_id, p_fee_id, p_amount, p_from, v_to, NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Remove a rate; the rate before it runs on in its place. A fee always keeps at least one rate.
CREATE OR REPLACE FUNCTION public.tuition_rate_delete(p_rate_id uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rate tuition_fee_rates%ROWTYPE;
BEGIN
  SELECT * INTO v_rate FROM tuition_fee_rates WHERE id = p_rate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rate not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_rate.center_id);
  PERFORM 1 FROM tuition_fees WHERE id = v_rate.fee_id FOR UPDATE;
  IF (SELECT count(*) FROM tuition_fee_rates WHERE fee_id = v_rate.fee_id) <= 1 THEN
    RAISE EXCEPTION 'A fee needs at least one rate. Change the amount instead, or turn the fee off' USING ERRCODE = '22023';
  END IF;
  PERFORM public.tuition_require_past_ok(v_rate.center_id, v_rate.effective_from, p_note);
  DELETE FROM tuition_fee_rates WHERE id = p_rate_id;
  UPDATE tuition_fee_rates SET effective_to = v_rate.effective_to
  WHERE fee_id = v_rate.fee_id AND effective_to = v_rate.effective_from - 1;
END $$;

-- 9. Fees on a child ------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tuition_fee_label(p_fee_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT concat_ws(' · ', p.name, f.name) FROM tuition_fees f LEFT JOIN center_programs p ON p.id = f.program_id WHERE f.id = p_fee_id
$$;
REVOKE ALL ON FUNCTION public.tuition_fee_label(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tuition_discount_label(p_type text, p_value numeric, p_reason text, p_override numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_override IS NOT NULL THEN 'locked-in price ' || public.tuition_money(p_override)
    WHEN p_type = 'percent' THEN trim_scale(p_value)::text || '% off' || COALESCE(' (' || p_reason || ')', '')
    WHEN p_type = 'amount' THEN public.tuition_money(p_value) || ' off' || COALESCE(' (' || p_reason || ')', '')
    ELSE 'list price' END
$$;

-- Discount fields from the app, checked: {discount_type, discount_value, discount_reason, override_amount}
CREATE OR REPLACE FUNCTION public.tuition_check_discount(p jsonb,
  OUT discount_type text, OUT discount_value numeric, OUT discount_reason text, OUT override_amount numeric)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  discount_type := NULLIF(p ->> 'discount_type', '');
  discount_value := NULLIF(p ->> 'discount_value', '')::numeric;
  discount_reason := NULLIF(btrim(COALESCE(p ->> 'discount_reason', '')), '');
  override_amount := NULLIF(p ->> 'override_amount', '')::numeric;
  IF discount_type IS NOT NULL AND discount_type NOT IN ('percent', 'amount') THEN
    RAISE EXCEPTION 'Unknown discount type' USING ERRCODE = '22023';
  END IF;
  IF discount_type IS NOT NULL AND (discount_value IS NULL OR discount_value <= 0) THEN
    RAISE EXCEPTION 'Give the discount amount' USING ERRCODE = '22023';
  END IF;
  IF discount_type = 'percent' AND discount_value > 100 THEN
    RAISE EXCEPTION 'A discount can''t be more than 100%%' USING ERRCODE = '22023';
  END IF;
  IF discount_type IS NULL THEN discount_value := NULL; discount_reason := NULL; END IF;
  IF discount_type IS NOT NULL AND override_amount IS NOT NULL THEN
    RAISE EXCEPTION 'Use a discount or a locked-in price, not both' USING ERRCODE = '22023';
  END IF;
  IF override_amount IS NOT NULL AND override_amount < 0 THEN
    RAISE EXCEPTION 'A locked-in price can''t be negative' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.tuition_check_discount(jsonb) FROM PUBLIC, anon, authenticated;

-- Add a fee to a child. p: {fee_id, start, discount_type, discount_value, discount_reason, override_amount}
-- Start may be any day from the child's enrollment on (to set up children already at the center).
CREATE OR REPLACE FUNCTION public.child_tuition_add(p_child_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_child children%ROWTYPE; v_fee tuition_fees%ROWTYPE; v_d record; v_id uuid;
  v_start date := NULLIF(p ->> 'start', '')::date;
BEGIN
  SELECT * INTO v_child FROM children WHERE id = p_child_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Child not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_child.center_id);
  IF v_child.status <> 'enrolled' THEN RAISE EXCEPTION 'Re-enroll the child before adding fees' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_fee FROM tuition_fees WHERE id = NULLIF(p ->> 'fee_id', '')::uuid AND center_id = v_child.center_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pick a fee from your center''s rate card' USING ERRCODE = '22023'; END IF;
  IF NOT v_fee.is_active THEN RAISE EXCEPTION 'That fee is turned off. Turn it on in Manage Data first' USING ERRCODE = '22023'; END IF;
  v_start := COALESCE(v_start, GREATEST(v_child.enrolled_on, public.roster_today(v_child.center_id)));
  IF v_start < v_child.enrolled_on THEN
    RAISE EXCEPTION 'A fee can''t start before the child''s enrollment date (%)', to_char(v_child.enrolled_on, 'Mon FMDD, YYYY')
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_d FROM public.tuition_check_discount(p);

  BEGIN
    INSERT INTO child_tuition (center_id, child_id, fee_id, start_date, end_date,
      discount_type, discount_value, discount_reason, override_amount, created_by)
    VALUES (v_child.center_id, p_child_id, v_fee.id, v_start, CASE WHEN v_fee.frequency = 'one_time' THEN v_start END,
      v_d.discount_type, v_d.discount_value, v_d.discount_reason, v_d.override_amount, auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'The child already has this fee for those dates' USING ERRCODE = '23P01';
  END;
  PERFORM public.tuition_log(v_child.center_id, p_child_id, 'child_tuition', v_id, 'insert',
    'Fee added: ' || public.tuition_fee_label(v_fee.id) || ' from ' || to_char(v_start, 'Mon FMDD, YYYY')
    || ', ' || public.tuition_discount_label(v_d.discount_type, v_d.discount_value, v_d.discount_reason, v_d.override_amount));
  RETURN v_id;
END $$;

-- Change a child's discount or locked-in price from a day on. The old terms stay for earlier days.
-- p: {discount_type, discount_value, discount_reason, override_amount}
CREATE OR REPLACE FUNCTION public.child_tuition_change(p_id uuid, p_from date, p jsonb, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row child_tuition%ROWTYPE; v_d record; v_id uuid; v_from date;
BEGIN
  SELECT * INTO v_row FROM child_tuition WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fee not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_row.center_id);
  v_from := GREATEST(COALESCE(p_from, public.roster_today(v_row.center_id)), v_row.start_date);
  IF v_row.end_date IS NOT NULL AND v_from > v_row.end_date THEN
    RAISE EXCEPTION 'This fee ended on %', to_char(v_row.end_date, 'Mon FMDD, YYYY') USING ERRCODE = '22023';
  END IF;
  PERFORM public.tuition_require_past_ok(v_row.center_id, v_from, p_note);
  SELECT * INTO v_d FROM public.tuition_check_discount(p);

  IF v_from = v_row.start_date THEN
    UPDATE child_tuition SET discount_type = v_d.discount_type, discount_value = v_d.discount_value,
      discount_reason = v_d.discount_reason, override_amount = v_d.override_amount, updated_at = now()
    WHERE id = p_id;
    v_id := p_id;
  ELSE
    UPDATE child_tuition SET end_date = v_from - 1, updated_at = now() WHERE id = p_id;
    INSERT INTO child_tuition (center_id, child_id, fee_id, start_date, end_date,
      discount_type, discount_value, discount_reason, override_amount, created_by)
    VALUES (v_row.center_id, v_row.child_id, v_row.fee_id, v_from, v_row.end_date,
      v_d.discount_type, v_d.discount_value, v_d.discount_reason, v_d.override_amount, auth.uid())
    RETURNING id INTO v_id;
  END IF;
  PERFORM public.tuition_log(v_row.center_id, v_row.child_id, 'child_tuition', v_id, 'update',
    public.tuition_fee_label(v_row.fee_id) || ': ' || public.tuition_discount_label(v_d.discount_type, v_d.discount_value, v_d.discount_reason, v_d.override_amount)
    || ' from ' || to_char(v_from, 'Mon FMDD, YYYY') || COALESCE(' (' || NULLIF(btrim(p_note), '') || ')', ''));
  RETURN v_id;
END $$;

-- End a child's fee on a day (the last day it is charged). Ending it before it starts removes it.
-- A fee added today by mistake can always be removed.
CREATE OR REPLACE FUNCTION public.child_tuition_end(p_id uuid, p_end date, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row child_tuition%ROWTYPE; v_today date; v_label text;
BEGIN
  SELECT * INTO v_row FROM child_tuition WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fee not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_row.center_id);
  v_today := public.roster_today(v_row.center_id);
  v_label := public.tuition_fee_label(v_row.fee_id);

  IF p_end IS NULL OR p_end < v_row.start_date THEN
    IF v_row.created_at < now() - interval '24 hours' THEN
      PERFORM public.tuition_require_past_ok(v_row.center_id, v_row.start_date, p_note);
    END IF;
    DELETE FROM child_tuition WHERE id = p_id;
    PERFORM public.tuition_log(v_row.center_id, v_row.child_id, 'child_tuition', p_id, 'delete',
      'Fee removed: ' || v_label || COALESCE(' (' || NULLIF(btrim(p_note), '') || ')', ''));
    RETURN;
  END IF;
  IF v_row.end_date IS NOT NULL AND p_end >= v_row.end_date THEN
    RAISE EXCEPTION 'This fee already ends on %', to_char(v_row.end_date, 'Mon FMDD, YYYY') USING ERRCODE = '22023';
  END IF;
  PERFORM public.tuition_require_past_ok(v_row.center_id, p_end + 1, p_note);
  UPDATE child_tuition SET end_date = p_end, updated_at = now() WHERE id = p_id;
  PERFORM public.tuition_log(v_row.center_id, v_row.child_id, 'child_tuition', p_id, 'update',
    'Fee ends: ' || v_label || ' after ' || to_char(p_end, 'Mon FMDD, YYYY') || COALESCE(' (' || NULLIF(btrim(p_note), '') || ')', ''));
END $$;

-- 10. Who pays ------------------------------------------------------------------------------------------------

-- Replace the child's payer lines from p_from on. Lines in force before p_from end the day before; lines that would
-- start on or after p_from are dropped. An empty list clears the plan from p_from.
-- p_lines: [{payer_guardian_id | payer_name, payer_kind, share_type, share_value, fixed_frequency, method, bank_name,
--            account_type, last4, card_brand, other_details, draft_day, authorization_on_file,
--            authorization_signed_on, authorization_file_id}]
-- Rules: at most one "the rest" line; percents add up to at most 100, and to exactly 100 when there is no
-- "the rest" line; fixed amounts say which total (weekly, every two weeks, monthly) they come off.
CREATE OR REPLACE FUNCTION public.child_payment_plan_save(p_child_id uuid, p_from date, p_lines jsonb, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_child children%ROWTYPE; v_from date; v_l jsonb; v_i integer := 0; v_rest integer; v_pct numeric; v_names text[] := '{}';
  v_gid uuid; v_gname text; v_method text; v_last4 text; v_file uuid;
BEGIN
  SELECT * INTO v_child FROM children WHERE id = p_child_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Child not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_child.center_id);
  v_from := COALESCE(p_from, public.roster_today(v_child.center_id));
  PERFORM public.tuition_require_past_ok(v_child.center_id, v_from, p_note);
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'Bad payer list' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_lines) > 6 THEN RAISE EXCEPTION 'Up to 6 payers per child' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_lines) > 0 AND v_child.status <> 'enrolled' THEN
    RAISE EXCEPTION 'Re-enroll the child before setting who pays' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) FILTER (WHERE e ->> 'share_type' = 'remainder'),
         COALESCE(sum(NULLIF(e ->> 'share_value', '')::numeric) FILTER (WHERE e ->> 'share_type' = 'percent'), 0)
  INTO v_rest, v_pct FROM jsonb_array_elements(p_lines) e;
  IF v_rest > 1 THEN RAISE EXCEPTION 'Only one payer can pay "the rest"' USING ERRCODE = '22023'; END IF;
  IF v_pct > 100 THEN RAISE EXCEPTION 'The percentages add up to more than 100%%' USING ERRCODE = '22023'; END IF;
  IF v_rest = 0 AND v_pct > 0 AND v_pct <> 100 THEN
    RAISE EXCEPTION 'The percentages add up to %. Make them 100%%, or let one payer pay "the rest"', trim_scale(v_pct)::text || '%'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e WHERE COALESCE(e ->> 'share_type', '') NOT IN ('percent', 'fixed', 'remainder')) THEN
    RAISE EXCEPTION 'Pick each payer''s share: a fixed amount, a percentage or "the rest"' USING ERRCODE = '22023';
  END IF;

  DELETE FROM child_payment_payers WHERE child_id = p_child_id AND effective_from >= v_from;
  UPDATE child_payment_payers SET effective_to = v_from - 1
  WHERE child_id = p_child_id AND effective_from < v_from AND (effective_to IS NULL OR effective_to >= v_from);

  FOR v_l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_i := v_i + 1;
    v_gid := NULLIF(v_l ->> 'payer_guardian_id', '')::uuid;
    v_gname := NULLIF(btrim(COALESCE(v_l ->> 'payer_name', '')), '');
    IF v_gid IS NOT NULL THEN
      SELECT name INTO v_gname FROM child_guardians WHERE id = v_gid AND child_id = p_child_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Payer % is not one of this child''s contacts', v_i USING ERRCODE = '22023'; END IF;
    ELSIF v_gname IS NULL THEN
      RAISE EXCEPTION 'Pick a parent or name the payer (line %)', v_i USING ERRCODE = '22023';
    END IF;
    v_method := NULLIF(v_l ->> 'method', '');
    IF v_method IS NULL OR v_method NOT IN ('ach', 'credit_card', 'check', 'other') THEN
      RAISE EXCEPTION 'Pick how % pays', v_gname USING ERRCODE = '22023';
    END IF;
    v_last4 := NULLIF(btrim(COALESCE(v_l ->> 'last4', '')), '');
    IF v_last4 IS NOT NULL AND v_last4 !~ '^[0-9]{4}$' THEN
      RAISE EXCEPTION 'Enter only the last 4 digits of the account or card (%)', v_gname USING ERRCODE = '22023';
    END IF;
    IF v_l ->> 'share_type' = 'fixed' AND COALESCE(NULLIF(v_l ->> 'share_value', '')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Give %''s fixed amount', v_gname USING ERRCODE = '22023';
    END IF;
    IF v_l ->> 'share_type' = 'percent' AND COALESCE(NULLIF(v_l ->> 'share_value', '')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Give %''s percentage', v_gname USING ERRCODE = '22023';
    END IF;
    v_file := NULLIF(v_l ->> 'authorization_file_id', '')::uuid;
    IF v_file IS NOT NULL AND NOT EXISTS (SELECT 1 FROM child_files WHERE id = v_file AND child_id = p_child_id) THEN
      RAISE EXCEPTION 'The authorization form must be one of this child''s files' USING ERRCODE = '22023';
    END IF;

    INSERT INTO child_payment_payers (center_id, child_id, payer_guardian_id, payer_name, payer_kind, share_type, share_value,
      fixed_frequency, method, bank_name, account_type, last4, card_brand, other_details, draft_day,
      authorization_on_file, authorization_signed_on, authorization_file_id, sort_order, effective_from, created_by)
    VALUES (v_child.center_id, p_child_id, v_gid, v_gname,
      COALESCE(NULLIF(v_l ->> 'payer_kind', ''), CASE WHEN v_gid IS NOT NULL THEN 'family' ELSE 'other' END),
      v_l ->> 'share_type',
      CASE WHEN v_l ->> 'share_type' = 'remainder' THEN NULL ELSE NULLIF(v_l ->> 'share_value', '')::numeric END,
      CASE WHEN v_l ->> 'share_type' = 'fixed' THEN COALESCE(NULLIF(v_l ->> 'fixed_frequency', ''), 'weekly') END,
      v_method,
      NULLIF(btrim(COALESCE(v_l ->> 'bank_name', '')), ''),
      CASE WHEN v_method IN ('ach', 'credit_card') THEN NULLIF(v_l ->> 'account_type', '') END,
      CASE WHEN v_method IN ('ach', 'credit_card') THEN v_last4 END,
      NULLIF(btrim(COALESCE(v_l ->> 'card_brand', '')), ''),
      NULLIF(btrim(COALESCE(v_l ->> 'other_details', '')), ''),
      NULLIF(btrim(COALESCE(v_l ->> 'draft_day', '')), ''),
      COALESCE((v_l ->> 'authorization_on_file')::boolean, false),
      NULLIF(v_l ->> 'authorization_signed_on', '')::date,
      v_file, v_i, v_from, auth.uid());
    v_names := v_names || (v_gname || ' (' || CASE v_l ->> 'share_type'
      WHEN 'remainder' THEN 'the rest'
      WHEN 'percent' THEN trim_scale((v_l ->> 'share_value')::numeric)::text || '%'
      ELSE public.tuition_money((v_l ->> 'share_value')::numeric) END
      || ', ' || replace(replace(v_method, 'credit_card', 'card'), 'ach', 'ACH') || ')');
  END LOOP;

  PERFORM public.tuition_log(v_child.center_id, p_child_id, 'child_payment_payers', NULL, 'update',
    CASE WHEN v_i = 0 THEN 'Payers cleared' ELSE 'Payers: ' || array_to_string(v_names, ', ') END
    || ' from ' || to_char(v_from, 'Mon FMDD, YYYY') || COALESCE(' (' || NULLIF(btrim(p_note), '') || ')', ''));
  RETURN v_i;
END $$;

-- Children at the same center who share a parent (same email on a contact) with this child
CREATE OR REPLACE FUNCTION public.tuition_siblings(p_child_id uuid)
RETURNS TABLE (id uuid, first_name text, last_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT c.id, c.first_name, c.last_name
  FROM child_guardians g
  JOIN child_guardians g2 ON g2.center_id = g.center_id AND lower(btrim(g2.email)) = lower(btrim(g.email)) AND g2.child_id <> g.child_id
  JOIN children c ON c.id = g2.child_id AND c.status = 'enrolled'
  WHERE g.child_id = p_child_id AND NULLIF(btrim(g.email), '') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.tuition_siblings(uuid) FROM PUBLIC, anon, authenticated;

-- Copy the payer lines in force today from one child to a sibling, from p_from on. Parents are matched by email.
-- The authorization form stays with the first child (it is that child's file); the "on file" flag and date copy.
CREATE OR REPLACE FUNCTION public.child_payment_plan_copy(p_from_child uuid, p_to_child uuid, p_from date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_center uuid; v_today date; v_lines jsonb := '[]'; v_l record; v_gid uuid; v_email text;
BEGIN
  SELECT center_id INTO v_center FROM children WHERE id = p_from_child;
  IF v_center IS NULL THEN RAISE EXCEPTION 'Child not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_center);
  IF NOT EXISTS (SELECT 1 FROM public.tuition_siblings(p_from_child) s WHERE s.id = p_to_child) THEN
    RAISE EXCEPTION 'Payers can only be copied to a sibling (a child who shares a parent''s email)' USING ERRCODE = '22023';
  END IF;
  v_today := public.roster_today(v_center);

  FOR v_l IN SELECT * FROM child_payment_payers
             WHERE child_id = p_from_child AND effective_from <= v_today AND (effective_to IS NULL OR effective_to >= v_today)
             ORDER BY sort_order LOOP
    v_gid := NULL;
    IF v_l.payer_guardian_id IS NOT NULL THEN
      SELECT lower(btrim(email)) INTO v_email FROM child_guardians WHERE id = v_l.payer_guardian_id;
      SELECT g.id INTO v_gid FROM child_guardians g
      WHERE g.child_id = p_to_child AND v_email IS NOT NULL AND lower(btrim(g.email)) = v_email
      ORDER BY g.is_primary DESC, g.created_at LIMIT 1;
      IF v_gid IS NULL THEN
        RAISE EXCEPTION '% is not a contact of the sibling. Add them to the sibling''s contacts first', v_l.payer_name USING ERRCODE = '22023';
      END IF;
    END IF;
    v_lines := v_lines || jsonb_strip_nulls(jsonb_build_object(
      'payer_guardian_id', v_gid, 'payer_name', CASE WHEN v_gid IS NULL THEN v_l.payer_name END, 'payer_kind', v_l.payer_kind,
      'share_type', v_l.share_type, 'share_value', v_l.share_value, 'fixed_frequency', v_l.fixed_frequency,
      'method', v_l.method, 'bank_name', v_l.bank_name, 'account_type', v_l.account_type, 'last4', v_l.last4,
      'card_brand', v_l.card_brand, 'other_details', v_l.other_details, 'draft_day', v_l.draft_day,
      'authorization_on_file', v_l.authorization_on_file, 'authorization_signed_on', v_l.authorization_signed_on));
  END LOOP;
  IF jsonb_array_length(v_lines) = 0 THEN RAISE EXCEPTION 'This child has no payers today to copy' USING ERRCODE = '22023'; END IF;
  RETURN public.child_payment_plan_save(p_to_child, p_from, v_lines, 'Copied from sibling');
END $$;

-- 11. Everything the Fee & Payment tab shows ------------------------------------------------------------------
-- { today, is_owner, child, periods (tuition_split + lines per frequency), fees (current and future), history,
--   one_time, payers (in force today), upcoming_payers, payer_history, guardians, files, siblings, options }
CREATE OR REPLACE FUNCTION public.child_tuition_get(p_child_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_child children%ROWTYPE; v_today date; v_program uuid; v_split jsonb;
BEGIN
  SELECT * INTO v_child FROM children WHERE id = p_child_id;
  IF NOT FOUND OR NOT public.tuition_can_manage(v_child.center_id) THEN
    RAISE EXCEPTION 'Tuition is not turned on for your center, or you do not have access to this child' USING ERRCODE = '42501';
  END IF;
  v_today := public.roster_today(v_child.center_id);
  SELECT w.program_id INTO v_program FROM work_areas w WHERE w.id = v_child.classroom_id;
  v_split := public.tuition_split(p_child_id, v_today);

  RETURN jsonb_build_object(
    'today', v_today,
    'is_owner', public.tuition_is_owner(v_child.center_id),
    'child', jsonb_build_object('id', v_child.id, 'center_id', v_child.center_id, 'first_name', v_child.first_name,
      'status', v_child.status, 'enrolled_on', v_child.enrolled_on, 'withdrawn_on', v_child.withdrawn_on, 'program_id', v_program),
    'periods', COALESCE((
      SELECT jsonb_agg(s || jsonb_build_object('lines', (
        SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.fee_name), '[]') FROM public.tuition_lines(p_child_id, v_today) l
        WHERE l.frequency = s ->> 'frequency')))
      FROM jsonb_array_elements(v_split) s), '[]'),
    'fees', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ct.id, 'fee_id', ct.fee_id, 'label', public.tuition_fee_label(ct.fee_id), 'frequency', f.frequency, 'kind', f.kind,
        'start', ct.start_date, 'end', ct.end_date, 'discount_type', ct.discount_type, 'discount_value', ct.discount_value,
        'discount_reason', ct.discount_reason, 'override_amount', ct.override_amount,
        'created_today', ct.created_at > now() - interval '24 hours',
        'upcoming_rate', CASE WHEN ct.override_amount IS NULL THEN (
          SELECT jsonb_build_object('amount', r.amount, 'from', r.effective_from,
                   'charged_from', public.tuition_first_charged(f.frequency, ct.start_date, r.effective_from)) FROM tuition_fee_rates r
          WHERE r.fee_id = ct.fee_id AND r.effective_from > v_today AND r.effective_from >= ct.start_date
            AND (ct.end_date IS NULL OR r.effective_from <= ct.end_date)
          ORDER BY r.effective_from LIMIT 1) END
      ) ORDER BY ct.start_date, f.name)
      FROM child_tuition ct JOIN tuition_fees f ON f.id = ct.fee_id
      WHERE ct.child_id = p_child_id AND f.frequency <> 'one_time' AND (ct.end_date IS NULL OR ct.end_date >= v_today)), '[]'),
    'one_time', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', ct.id, 'label', public.tuition_fee_label(ct.fee_id), 'on', ct.start_date,
        'net_amount', (SELECT l.net_amount FROM public.tuition_lines(p_child_id, ct.start_date) l WHERE l.child_tuition_id = ct.id),
        'discount', public.tuition_discount_label(ct.discount_type, ct.discount_value, ct.discount_reason, ct.override_amount),
        'created_today', ct.created_at > now() - interval '24 hours') ORDER BY ct.start_date DESC)
      FROM child_tuition ct JOIN tuition_fees f ON f.id = ct.fee_id
      WHERE ct.child_id = p_child_id AND f.frequency = 'one_time'), '[]'),
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', ct.id, 'label', public.tuition_fee_label(ct.fee_id), 'frequency', f.frequency,
        'start', ct.start_date, 'end', ct.end_date,
        'terms', public.tuition_discount_label(ct.discount_type, ct.discount_value, ct.discount_reason, ct.override_amount),
        'first_amount', (SELECT l.net_amount FROM public.tuition_lines(p_child_id, ct.start_date) l WHERE l.child_tuition_id = ct.id)
      ) ORDER BY ct.start_date DESC, f.name)
      FROM child_tuition ct JOIN tuition_fees f ON f.id = ct.fee_id WHERE ct.child_id = p_child_id), '[]'),
    'payers', COALESCE((
      SELECT jsonb_agg(to_jsonb(pp) || jsonb_build_object('relationship', g.relationship) ORDER BY pp.sort_order)
      FROM child_payment_payers pp LEFT JOIN child_guardians g ON g.id = pp.payer_guardian_id
      WHERE pp.child_id = p_child_id AND pp.effective_from <= v_today AND (pp.effective_to IS NULL OR pp.effective_to >= v_today)), '[]'),
    'upcoming_payers', COALESCE((
      SELECT jsonb_agg(to_jsonb(pp) || jsonb_build_object('relationship', g.relationship) ORDER BY pp.effective_from, pp.sort_order)
      FROM child_payment_payers pp LEFT JOIN child_guardians g ON g.id = pp.payer_guardian_id
      WHERE pp.child_id = p_child_id AND pp.effective_from > v_today), '[]'),
    'payer_history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('payer_name', pp.payer_name, 'share_type', pp.share_type, 'share_value', pp.share_value,
        'fixed_frequency', pp.fixed_frequency, 'method', pp.method, 'last4', pp.last4, 'from', pp.effective_from, 'to', pp.effective_to)
        ORDER BY pp.effective_from DESC, pp.sort_order)
      FROM child_payment_payers pp WHERE pp.child_id = p_child_id AND pp.effective_to IS NOT NULL AND pp.effective_to < v_today), '[]'),
    'guardians', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'relationship', g.relationship, 'email', g.email,
        'is_primary', g.is_primary) ORDER BY g.is_primary DESC, g.created_at)
      FROM child_guardians g WHERE g.child_id = p_child_id), '[]'),
    'files', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', cf.id, 'file_name', cf.file_name) ORDER BY cf.created_at DESC)
      FROM child_files cf WHERE cf.child_id = p_child_id AND cf.category = 'record'), '[]'),
    'siblings', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.first_name) FROM public.tuition_siblings(p_child_id) s), '[]'),
    'options', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'label', public.tuition_fee_label(f.id), 'program_id', f.program_id,
        'frequency', f.frequency, 'kind', f.kind,
        'amount', (SELECT r.amount FROM public.tuition_rate_on(f.id, v_today) r))
        ORDER BY (f.program_id IS NOT DISTINCT FROM v_program) DESC, f.sort_order, f.name)
      FROM tuition_fees f WHERE f.center_id = v_child.center_id AND f.is_active), '[]')
  );
END $$;

-- Fees for the add-child / enroll-from-tour step: active fees with today's amount, the program's fees first
CREATE OR REPLACE FUNCTION public.tuition_fee_options(p_center_id uuid, p_program_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today date;
BEGIN
  PERFORM public.tuition_require(p_center_id);
  v_today := public.roster_today(p_center_id);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', f.id, 'label', public.tuition_fee_label(f.id), 'program_id', f.program_id,
      'frequency', f.frequency, 'kind', f.kind, 'amount', (SELECT r.amount FROM public.tuition_rate_on(f.id, v_today) r))
      ORDER BY (f.program_id IS NOT DISTINCT FROM p_program_id) DESC, f.sort_order, f.name)
    FROM tuition_fees f WHERE f.center_id = p_center_id AND f.is_active), '[]');
END $$;

-- 12. Withdrawing a child ends their fees and payers on the withdrawal day --------------------------------------
CREATE OR REPLACE FUNCTION public.tuition_on_withdraw()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  IF NEW.status <> 'withdrawn' OR NEW.withdrawn_on IS NULL
     OR (OLD.status = 'withdrawn' AND OLD.withdrawn_on IS NOT DISTINCT FROM NEW.withdrawn_on) THEN
    RETURN NULL;
  END IF;
  DELETE FROM child_tuition WHERE child_id = NEW.id AND start_date > NEW.withdrawn_on;
  UPDATE child_tuition SET end_date = NEW.withdrawn_on, updated_at = now()
  WHERE child_id = NEW.id AND (end_date IS NULL OR end_date > NEW.withdrawn_on);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM child_payment_payers WHERE child_id = NEW.id AND effective_from > NEW.withdrawn_on;
  UPDATE child_payment_payers SET effective_to = NEW.withdrawn_on
  WHERE child_id = NEW.id AND (effective_to IS NULL OR effective_to > NEW.withdrawn_on);
  IF v_n > 0 THEN
    PERFORM public.tuition_log(NEW.center_id, NEW.id, 'child_tuition', NULL, 'update',
      'Fees and payers end ' || to_char(NEW.withdrawn_on, 'Mon FMDD, YYYY') || ' (withdrawn)');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.tuition_on_withdraw() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tuition_on_withdraw ON public.children;
CREATE TRIGGER trg_tuition_on_withdraw AFTER UPDATE OF status, withdrawn_on ON public.children
  FOR EACH ROW EXECUTE FUNCTION public.tuition_on_withdraw();

-- 13. Who may call what --------------------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'tuition_can_manage(uuid)', 'tuition_money(numeric)', 'tuition_period(text, date, date)', 'tuition_first_charged(text, date, date)',
    'tuition_discount_label(text, numeric, text, numeric)',
    'child_tuition_on(uuid, date)', 'child_payment_split(uuid, date)',
    'tuition_fees_list(uuid)', 'tuition_fee_save(uuid, jsonb)', 'tuition_fee_delete(uuid)',
    'tuition_rate_set(uuid, numeric, date, text)', 'tuition_rate_delete(uuid, text)',
    'child_tuition_add(uuid, jsonb)', 'child_tuition_change(uuid, date, jsonb, text)', 'child_tuition_end(uuid, date, text)',
    'child_payment_plan_save(uuid, date, jsonb, text)', 'child_payment_plan_copy(uuid, uuid, date)',
    'child_tuition_get(uuid)', 'tuition_fee_options(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

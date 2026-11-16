-- ============================================================
-- Tuition catch-up: everything added to 20270109000000_tuition_fees.sql after it was first published.
-- That file is back to its first published version (it may already be applied); this migration brings any database
-- up to date, whichever version of it ran. Safe to run on a database that already has some or all of these changes.
--
--  - tuition_first_charged(): the first day a new price is actually charged (next Monday / next 1st)
--  - child_tuition_get(): upcoming price shows charged_from; payers never carry the encrypted account number
--  - Payer bank details for ACH: routing_number (ABA checksum, tuition_aba_ok) and account_number_enc (encrypted by
--    the server with TUITION_BANK_KEY; never readable by the app: column-level grants), required for ACH lines
--  - child_payment_plan_save() / child_payment_plan_copy(): bank details, keep_account_from, copy to sibling
--  - child_payment_bank_reveal(): the server decrypts for an owner or admin; every view logged in Activity
-- Needs: 20270109000000_tuition_fees.sql
-- Rollback: supabase/rollbacks/20270109100000_tuition_bank_details.down.sql
-- ============================================================

-- 1. Payer bank columns -----------------------------------------------------------------------------------------
ALTER TABLE public.child_payment_payers ADD COLUMN IF NOT EXISTS routing_number text
  CHECK (routing_number IS NULL OR routing_number ~ '^[0-9]{9}$');
ALTER TABLE public.child_payment_payers ADD COLUMN IF NOT EXISTS account_number_enc text
  CHECK (account_number_enc IS NULL OR (account_number_enc ~ '^v[0-9]+:' AND char_length(account_number_enc) <= 400));

ALTER TABLE public.child_payment_payers DROP CONSTRAINT IF EXISTS child_payment_payers_bank_is_ach;
ALTER TABLE public.child_payment_payers ADD CONSTRAINT child_payment_payers_bank_is_ach
  CHECK (method = 'ach' OR (routing_number IS NULL AND account_number_enc IS NULL));
ALTER TABLE public.child_payment_payers DROP CONSTRAINT IF EXISTS child_payment_payers_account_last4;
ALTER TABLE public.child_payment_payers ADD CONSTRAINT child_payment_payers_account_last4
  CHECK (account_number_enc IS NULL OR last4 IS NOT NULL);

-- The encrypted account number is never readable by the app: every column but that one
REVOKE SELECT ON public.child_payment_payers FROM authenticated;
GRANT SELECT (id, center_id, child_id, payer_guardian_id, payer_name, payer_kind, share_type, share_value, fixed_frequency,
  method, bank_name, account_type, last4, routing_number, card_brand, other_details, draft_day, authorization_on_file,
  authorization_signed_on, authorization_file_id, sort_order, effective_from, effective_to, created_by, created_at)
  ON public.child_payment_payers TO authenticated;

-- 2. Functions (the tested versions) ------------------------------------------------------------------------------

-- ABA routing number checksum: 3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10)
CREATE OR REPLACE FUNCTION public.tuition_aba_ok(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p ~ '^[0-9]{9}$' AND p <> '000000000' AND (
    3 * (substr(p,1,1)::int + substr(p,4,1)::int + substr(p,7,1)::int)
  + 7 * (substr(p,2,1)::int + substr(p,5,1)::int + substr(p,8,1)::int)
  +     (substr(p,3,1)::int + substr(p,6,1)::int + substr(p,9,1)::int)) % 10 = 0
$$;

-- The first day a rate starting on p_day is charged: p_day if a period starts that day, else the next period start
CREATE OR REPLACE FUNCTION public.tuition_first_charged(p_frequency text, p_anchor date, p_day date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p.period_start = p_day OR p_frequency = 'one_time' THEN p_day ELSE p.period_end + 1 END
  FROM public.tuition_period(p_frequency, p_anchor, p_day) p
$$;

-- Replace the child's payer lines from p_from on. Lines in force before p_from end the day before; lines that would
-- start on or after p_from are dropped. An empty list clears the plan from p_from.
-- p_lines: [{payer_guardian_id | payer_name, payer_kind, share_type, share_value, fixed_frequency, method, bank_name,
--            account_type, last4, routing_number, account_number_enc | keep_account_from, card_brand, other_details,
--            draft_day, authorization_on_file, authorization_signed_on, authorization_file_id}]
-- ACH needs the bank name, account type, a valid routing number and the account number: either newly encrypted by the
-- server (account_number_enc + last4) or kept from an earlier payer line of this child (keep_account_from = its id).
-- Rules: at most one "the rest" line; percents add up to at most 100, and to exactly 100 when there is no
-- "the rest" line; fixed amounts say which total (weekly, every two weeks, monthly) they come off.
CREATE OR REPLACE FUNCTION public.child_payment_plan_save(p_child_id uuid, p_from date, p_lines jsonb, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_child children%ROWTYPE; v_from date; v_l jsonb; v_i integer := 0; v_rest integer; v_pct numeric; v_names text[] := '{}';
  v_gid uuid; v_gname text; v_method text; v_last4 text; v_file uuid;
  v_routing text; v_enc text; v_keep child_payment_payers%ROWTYPE;
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
      RAISE EXCEPTION 'Enter only the last 4 digits of the card (%)', v_gname USING ERRCODE = '22023';
    END IF;
    v_routing := NULL; v_enc := NULL;
    IF v_method = 'ach' THEN
      v_enc := NULLIF(v_l ->> 'account_number_enc', '');
      IF v_enc IS NULL AND NULLIF(v_l ->> 'keep_account_from', '') IS NOT NULL THEN
        SELECT * INTO v_keep FROM child_payment_payers
        WHERE id = (v_l ->> 'keep_account_from')::uuid AND child_id = p_child_id AND account_number_enc IS NOT NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'Enter %''s account number again', v_gname USING ERRCODE = '22023'; END IF;
        v_enc := v_keep.account_number_enc; v_last4 := v_keep.last4;
      END IF;
      IF v_enc IS NULL THEN RAISE EXCEPTION 'Enter %''s bank account number', v_gname USING ERRCODE = '22023'; END IF;
      IF v_enc !~ '^v[0-9]+:' OR v_last4 IS NULL THEN RAISE EXCEPTION 'Bank account number was not saved securely. Try again' USING ERRCODE = '22023'; END IF;
      v_routing := NULLIF(btrim(COALESCE(v_l ->> 'routing_number', '')), '');
      IF v_routing IS NULL OR NOT public.tuition_aba_ok(v_routing) THEN
        RAISE EXCEPTION '%''s routing number isn''t valid. It is the 9 digits at the bottom left of a check', v_gname USING ERRCODE = '22023';
      END IF;
      IF NULLIF(btrim(COALESCE(v_l ->> 'bank_name', '')), '') IS NULL THEN
        RAISE EXCEPTION 'Enter %''s bank name', v_gname USING ERRCODE = '22023';
      END IF;
      IF COALESCE(v_l ->> 'account_type', '') NOT IN ('checking', 'savings') THEN
        RAISE EXCEPTION 'Pick checking or savings for %', v_gname USING ERRCODE = '22023';
      END IF;
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
      fixed_frequency, method, bank_name, account_type, last4, routing_number, account_number_enc, card_brand, other_details, draft_day,
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
      v_routing, v_enc,
      CASE WHEN v_method = 'credit_card' THEN NULLIF(btrim(COALESCE(v_l ->> 'card_brand', '')), '') END,
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
      'routing_number', v_l.routing_number, 'account_number_enc', v_l.account_number_enc,
      'card_brand', v_l.card_brand, 'other_details', v_l.other_details, 'draft_day', v_l.draft_day,
      'authorization_on_file', v_l.authorization_on_file, 'authorization_signed_on', v_l.authorization_signed_on));
  END LOOP;
  IF jsonb_array_length(v_lines) = 0 THEN RAISE EXCEPTION 'This child has no payers today to copy' USING ERRCODE = '22023'; END IF;
  RETURN public.child_payment_plan_save(p_to_child, p_from, v_lines, 'Copied from sibling');
END $$;

-- The encrypted account number of a payer line, for the server to decrypt for an owner or admin. Logged every time.
CREATE OR REPLACE FUNCTION public.child_payment_bank_reveal(p_payer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p child_payment_payers%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM child_payment_payers WHERE id = p_payer_id;
  IF NOT FOUND OR NOT public.tuition_can_manage(v_p.center_id) THEN
    RAISE EXCEPTION 'You do not have access to these bank details' USING ERRCODE = '42501';
  END IF;
  IF v_p.account_number_enc IS NULL THEN RAISE EXCEPTION 'No bank account number on file' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_log(v_p.center_id, v_p.child_id, 'child_payment_payers', v_p.id, 'update',
    'Bank account number viewed: ' || v_p.payer_name || ' ····' || COALESCE(v_p.last4, ''));
  RETURN jsonb_build_object('account_number_enc', v_p.account_number_enc, 'routing_number', v_p.routing_number, 'last4', v_p.last4);
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
      SELECT jsonb_agg((to_jsonb(pp) - 'account_number_enc') || jsonb_build_object('relationship', g.relationship,
        'has_account_number', pp.account_number_enc IS NOT NULL) ORDER BY pp.sort_order)
      FROM child_payment_payers pp LEFT JOIN child_guardians g ON g.id = pp.payer_guardian_id
      WHERE pp.child_id = p_child_id AND pp.effective_from <= v_today AND (pp.effective_to IS NULL OR pp.effective_to >= v_today)), '[]'),
    'upcoming_payers', COALESCE((
      SELECT jsonb_agg((to_jsonb(pp) - 'account_number_enc') || jsonb_build_object('relationship', g.relationship,
        'has_account_number', pp.account_number_enc IS NOT NULL) ORDER BY pp.effective_from, pp.sort_order)
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

-- 3. Who may call what ------------------------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'tuition_aba_ok(text)', 'tuition_first_charged(text, date, date)', 'child_payment_bank_reveal(uuid)',
    'child_payment_plan_save(uuid, date, jsonb, text)', 'child_payment_plan_copy(uuid, uuid, date)', 'child_tuition_get(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

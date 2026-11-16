-- Rollback for 20270109100000_tuition_bank_details.sql: back to 20270109000000_tuition_fees.sql as first published.
-- Drops the payer bank columns (the encrypted account numbers are deleted) and the functions this migration added, and
-- puts back the original versions of the functions it changed. Roll back 20270110000000_center_bank_account.sql first
-- (it uses tuition_aba_ok).
DROP FUNCTION IF EXISTS public.child_payment_bank_reveal(uuid);

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
          SELECT jsonb_build_object('amount', r.amount, 'from', r.effective_from) FROM tuition_fee_rates r
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

ALTER TABLE public.child_payment_payers DROP CONSTRAINT IF EXISTS child_payment_payers_account_last4;
ALTER TABLE public.child_payment_payers DROP CONSTRAINT IF EXISTS child_payment_payers_bank_is_ach;
ALTER TABLE public.child_payment_payers DROP COLUMN IF EXISTS account_number_enc;
ALTER TABLE public.child_payment_payers DROP COLUMN IF EXISTS routing_number;
GRANT SELECT ON public.child_payment_payers TO authenticated;

DROP FUNCTION IF EXISTS public.tuition_first_charged(text, date, date);
DROP FUNCTION IF EXISTS public.tuition_aba_ok(text);

-- ============================================================
-- Parent billing phase 2: parents ask to change the bank account their ACH drafts come from (or to stop ACH),
-- and the center approves with a signed authorization form, so every draft stays a PPD entry.
--
--  - Parent (Billing tab → How you pay → Request a change, PIN typed again): new bank account for one or more of
--    their payer lines, or stop ACH and pay at the center. The server encrypts the account number (TUITION_BANK_KEY);
--    the database stores the ciphertext and the last 4. One open request per parent; 5 requests a day at most; a wrong
--    PIN counts toward the sign-in limits (parent_login_attempts).
--  - Center (Billing → Bank change requests, owners and admins): print the pre-filled authorization form, then
--    approve with the signed form uploaded to the child's file (required for a new account), or decline with a reason.
--  - Approving ends each payer line today and starts the same line with the new bank details tomorrow. Drafts already
--    queued keep the old account (the ACH file reads the bank details through each charge's own payer line).
--  - Every step is written to each child's Activity (child_audit_log).
-- Needs: 20270122000000_parent_billing.sql, 20270121000000_center_ach_settings.sql, 20270109100000_tuition_bank_details.sql,
--        20261228000000_parent_portal.sql
-- Rollback: supabase/rollbacks/20270123000000_billing_bank_changes.down.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.billing_bank_changes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id                uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  access_id                uuid NOT NULL REFERENCES public.parent_access(id) ON DELETE CASCADE,
  requester_name           text NOT NULL CHECK (char_length(requester_name) BETWEEN 1 AND 120),
  requester_email          text CHECK (requester_email IS NULL OR char_length(requester_email) <= 254),
  kind                     text NOT NULL CHECK (kind IN ('new_account', 'stop_ach')),
  payer_ids                uuid[] NOT NULL CHECK (cardinality(payer_ids) BETWEEN 1 AND 12),
  holder_name              text CHECK (holder_name IS NULL OR char_length(btrim(holder_name)) BETWEEN 1 AND 120),
  bank_name                text CHECK (bank_name IS NULL OR char_length(btrim(bank_name)) BETWEEN 1 AND 80),
  routing_number           text CHECK (routing_number IS NULL OR public.tuition_aba_ok(routing_number)),
  account_number_enc       text CHECK (account_number_enc IS NULL OR (account_number_enc ~ '^v[0-9]+:' AND char_length(account_number_enc) <= 400)),
  account_type             text CHECK (account_type IN ('checking', 'savings')),
  last4                    text CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'canceled')),
  decision_note            text CHECK (decision_note IS NULL OR char_length(decision_note) <= 300),
  authorization_file_id    uuid REFERENCES public.child_files(id) ON DELETE SET NULL,
  authorization_signed_on  date,
  effective_from           date,
  decided_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at               timestamptz,
  ip_hash                  text,
  user_agent               text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_bank_changes_details CHECK (
    (kind = 'new_account' AND holder_name IS NOT NULL AND routing_number IS NOT NULL AND account_number_enc IS NOT NULL
       AND account_type IS NOT NULL AND last4 IS NOT NULL)
    OR (kind = 'stop_ach' AND routing_number IS NULL AND account_number_enc IS NULL AND last4 IS NULL)),
  CONSTRAINT billing_bank_changes_decided CHECK ((status IN ('approved', 'declined')) = (decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_bank_changes_one_open ON public.billing_bank_changes (access_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS billing_bank_changes_center_idx ON public.billing_bank_changes (center_id, status, created_at DESC);

ALTER TABLE public.billing_bank_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_bank_changes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_bank_changes TO service_role;

-- A child's name for Activity lines and lists
CREATE OR REPLACE FUNCTION public.billing_bank_change_children(p_payer_ids uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', ch.id, 'name', public.parent_billing_child_name(ch.id))), '[]')
    FROM child_payment_payers pp JOIN children ch ON ch.id = pp.child_id WHERE pp.id = ANY (p_payer_ids)
$$;

CREATE OR REPLACE FUNCTION public.billing_bank_change_log(p_change billing_bank_changes, p_summary text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO child_audit_log (center_id, child_id, table_name, row_id, action, changed_by, summary)
  SELECT DISTINCT p_change.center_id, pp.child_id, 'billing_bank_changes', p_change.id, 'update', auth.uid(), left(p_summary, 300)
    FROM child_payment_payers pp WHERE pp.id = ANY (p_change.payer_ids)
$$;

-- 1. Parent side (service role; the server checks the PIN hash and encrypts the account number) ----------------------

-- Send a request. p: {kind, payer_ids[], holder_name, bank_name, routing_number, account_number_enc, account_type, last4}
-- Returns {status: ok, id, email, requester_name, kind, account_type, last4} | {status: invalid_pin, left} | {status: rate_limited, retry_after} | raises with a message.
CREATE OR REPLACE FUNCTION public.parent_bank_change_create(p_token_hash text, p_code_hash text, p_ip_hash text, p_user_agent text, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_access uuid; v_center uuid; v_g uuid[]; v_today date; v_fails int; v_oldest timestamptz;
  v_kind text := p ->> 'kind'; v_ids uuid[]; v_bad int; v_row billing_bank_changes%ROWTYPE; v_name text; v_email text;
BEGIN
  v_g := public.parent_billing_guardians(p_token_hash);
  IF cardinality(v_g) = 0 THEN RAISE EXCEPTION 'Billing is not available. Please sign in again.' USING ERRCODE = '42501'; END IF;
  v_access := public.parent_session_access(p_token_hash);
  SELECT center_id INTO v_center FROM parent_access WHERE id = v_access;
  IF p_ip_hash IS NULL THEN RAISE EXCEPTION 'Bad request' USING ERRCODE = '22023'; END IF;

  -- The PIN again, under the same limits as signing in
  PERFORM pg_advisory_xact_lock(hashtext('parent_login:' || p_ip_hash));
  SELECT count(*), min(at) INTO v_fails, v_oldest FROM parent_login_attempts WHERE ip_hash = p_ip_hash AND NOT ok AND at > now() - interval '15 minutes';
  IF v_fails >= 5 THEN
    RETURN jsonb_build_object('status', 'rate_limited', 'retry_after', GREATEST(60, ceil(extract(epoch FROM (v_oldest + interval '15 minutes' - now())))::int));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM parent_access WHERE id = v_access AND code_hash = p_code_hash) THEN
    INSERT INTO parent_login_attempts (ip_hash, center_id, ok) VALUES (p_ip_hash, v_center, false);
    RETURN jsonb_build_object('status', 'invalid_pin', 'left', 5 - v_fails - 1);
  END IF;

  IF (SELECT count(*) FROM billing_bank_changes WHERE access_id = v_access AND created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'You have sent several requests today. Please call the center.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM billing_bank_changes WHERE access_id = v_access AND status = 'pending') THEN
    RAISE EXCEPTION 'You already have a request waiting for the center. Cancel it first to send a new one.' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('new_account', 'stop_ach') THEN RAISE EXCEPTION 'Choose what to change' USING ERRCODE = '22023'; END IF;

  v_today := public.roster_today(v_center);
  SELECT array_agg(DISTINCT x::uuid) INTO v_ids FROM jsonb_array_elements_text(COALESCE(p -> 'payer_ids', '[]')) x;
  IF v_ids IS NULL THEN RAISE EXCEPTION 'Choose which children this is for' USING ERRCODE = '22023'; END IF;
  -- Only this parent's own lines in force today or later (and ACH lines, to stop ACH)
  SELECT count(*) INTO v_bad FROM unnest(v_ids) i
   WHERE NOT EXISTS (SELECT 1 FROM child_payment_payers pp JOIN children ch ON ch.id = pp.child_id
                      WHERE pp.id = i AND pp.payer_guardian_id = ANY (v_g) AND ch.status = 'enrolled'
                        AND (pp.effective_to IS NULL OR pp.effective_to >= v_today)
                        AND (v_kind = 'new_account' OR pp.method = 'ach'));
  IF v_bad > 0 THEN RAISE EXCEPTION 'One of those children can''t be changed here. Please call the center.' USING ERRCODE = '22023'; END IF;

  SELECT g.name, NULLIF(lower(btrim(g.email)), '') INTO v_name, v_email FROM child_guardians g WHERE g.id = ANY (v_g)
   ORDER BY g.is_primary DESC, g.created_at LIMIT 1;

  IF v_kind = 'new_account' THEN
    IF NOT public.tuition_aba_ok(btrim(COALESCE(p ->> 'routing_number', ''))) THEN
      RAISE EXCEPTION 'That routing number isn''t valid. It''s the 9-digit number at the bottom left of a check.' USING ERRCODE = '22023';
    END IF;
    IF btrim(COALESCE(p ->> 'holder_name', '')) = '' THEN RAISE EXCEPTION 'Enter the name on the account' USING ERRCODE = '22023'; END IF;
  END IF;

  INSERT INTO billing_bank_changes (center_id, access_id, requester_name, requester_email, kind, payer_ids, holder_name, bank_name,
         routing_number, account_number_enc, account_type, last4, ip_hash, user_agent)
  VALUES (v_center, v_access, COALESCE(v_name, 'Parent'), v_email, v_kind, v_ids,
          CASE WHEN v_kind = 'new_account' THEN left(btrim(p ->> 'holder_name'), 120) END,
          CASE WHEN v_kind = 'new_account' THEN NULLIF(left(btrim(COALESCE(p ->> 'bank_name', '')), 80), '') END,
          CASE WHEN v_kind = 'new_account' THEN btrim(p ->> 'routing_number') END,
          CASE WHEN v_kind = 'new_account' THEN p ->> 'account_number_enc' END,
          CASE WHEN v_kind = 'new_account' THEN COALESCE(NULLIF(p ->> 'account_type', ''), 'checking') END,
          CASE WHEN v_kind = 'new_account' THEN p ->> 'last4' END,
          p_ip_hash, left(p_user_agent, 300))
  RETURNING * INTO v_row;
  PERFORM public.billing_bank_change_log(v_row, CASE v_kind
    WHEN 'new_account' THEN format('%s asked to pay by ACH from a new account (%s ••%s). Waiting for the signed authorization.', v_row.requester_name, initcap(v_row.account_type), v_row.last4)
    ELSE format('%s asked to stop ACH drafts and pay at the center.', v_row.requester_name) END);
  RETURN jsonb_build_object('status', 'ok', 'id', v_row.id, 'email', v_row.requester_email, 'requester_name', v_row.requester_name,
                            'kind', v_row.kind, 'account_type', v_row.account_type, 'last4', v_row.last4);
END $$;

CREATE OR REPLACE FUNCTION public.parent_bank_change_cancel(p_token_hash text, p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_access uuid; v_row billing_bank_changes%ROWTYPE;
BEGIN
  IF cardinality(public.parent_billing_guardians(p_token_hash)) = 0 THEN RETURN false; END IF;
  v_access := public.parent_session_access(p_token_hash);
  UPDATE billing_bank_changes SET status = 'canceled' WHERE id = p_id AND access_id = v_access AND status = 'pending' RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RETURN false; END IF;
  PERFORM public.billing_bank_change_log(v_row, format('%s canceled their bank change request.', v_row.requester_name));
  RETURN true;
END $$;

-- For the Billing tab: the lines this parent can change ({payer_id, child, method, account_type, last4, bank_name}) and
-- their requests (the open one and the last 90 days). Last 4 only.
CREATE OR REPLACE FUNCTION public.parent_bank_changes(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_access uuid; v_g uuid[]; v_center uuid; v_today date;
BEGIN
  v_g := public.parent_billing_guardians(p_token_hash);
  IF cardinality(v_g) = 0 THEN RETURN NULL; END IF;
  v_access := public.parent_session_access(p_token_hash);
  SELECT center_id INTO v_center FROM parent_access WHERE id = v_access;
  v_today := public.roster_today(v_center);
  RETURN jsonb_build_object(
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('payer_id', pp.id, 'child', public.parent_billing_child_name(pp.child_id), 'method', pp.method,
               'account_type', pp.account_type, 'last4', pp.last4, 'bank_name', pp.bank_name, 'starts', pp.effective_from)
             ORDER BY public.parent_billing_child_name(pp.child_id), pp.effective_from, pp.sort_order)
        FROM child_payment_payers pp JOIN children ch ON ch.id = pp.child_id
       WHERE pp.payer_guardian_id = ANY (v_g) AND ch.status = 'enrolled' AND (pp.effective_to IS NULL OR pp.effective_to >= v_today)), '[]'),
    'requests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'bank_name', r.bank_name, 'account_type', r.account_type,
               'last4', r.last4, 'children', public.billing_bank_change_children(r.payer_ids), 'created_at', r.created_at,
               'decided_at', r.decided_at, 'decision_note', r.decision_note, 'effective_from', r.effective_from) ORDER BY r.created_at DESC)
        FROM billing_bank_changes r
       WHERE r.access_id = v_access AND (r.status = 'pending' OR r.created_at > now() - interval '90 days')), '[]'));
END $$;

-- 2. Center side (owners and admins) ---------------------------------------------------------------------------------

-- Open requests and the last 60 days. No account numbers: routing, last 4, and the current line's details.
CREATE OR REPLACE FUNCTION public.billing_bank_changes_list(p_center_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.tuition_require(p_center_id);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', r.id, 'kind', r.kind, 'status', r.status, 'requester_name', r.requester_name, 'requester_email', r.requester_email,
             'holder_name', r.holder_name, 'bank_name', r.bank_name, 'routing_number', r.routing_number, 'account_type', r.account_type,
             'last4', r.last4, 'created_at', r.created_at, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
             'effective_from', r.effective_from, 'authorization_file_id', r.authorization_file_id,
             'decided_by', (SELECT u.email FROM auth.users u WHERE u.id = r.decided_by),
             'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('payer_id', pp.id, 'child_id', pp.child_id,
                          'child', public.parent_billing_child_name(pp.child_id), 'method', pp.method, 'last4', pp.last4,
                          'account_type', pp.account_type, 'current', pp.effective_to IS NULL OR pp.effective_to >= public.roster_today(r.center_id))
                          ORDER BY public.parent_billing_child_name(pp.child_id))
                         FROM child_payment_payers pp WHERE pp.id = ANY (r.payer_ids)), '[]'))
           ORDER BY (r.status = 'pending') DESC, r.created_at DESC)
      FROM billing_bank_changes r
     WHERE r.center_id = p_center_id AND (r.status = 'pending' OR r.created_at > now() - interval '60 days')), '[]');
END $$;

CREATE OR REPLACE FUNCTION public.billing_bank_change_approve(p_id uuid, p_file_id uuid, p_signed_on date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r billing_bank_changes%ROWTYPE; v_today date; v_from date; v_pp child_payment_payers%ROWTYPE; v_done int := 0;
BEGIN
  SELECT * INTO v_r FROM billing_bank_changes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_r.center_id);
  IF v_r.status <> 'pending' THEN RAISE EXCEPTION 'This request was already handled' USING ERRCODE = '22023'; END IF;
  v_today := public.roster_today(v_r.center_id);
  v_from := v_today + 1;

  IF v_r.kind = 'new_account' THEN
    IF p_file_id IS NULL THEN RAISE EXCEPTION 'Upload the signed authorization form first' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM child_files f JOIN child_payment_payers pp ON pp.child_id = f.child_id
                    WHERE f.id = p_file_id AND f.center_id = v_r.center_id AND pp.id = ANY (v_r.payer_ids)) THEN
      RAISE EXCEPTION 'The signed form must be in one of these children''s files' USING ERRCODE = '22023';
    END IF;
    IF p_signed_on IS NULL OR p_signed_on > v_today OR p_signed_on < v_today - 60 THEN
      RAISE EXCEPTION 'Enter the date the parent signed the form (within the last 60 days)' USING ERRCODE = '22023';
    END IF;
  END IF;

  FOR v_pp IN SELECT * FROM child_payment_payers WHERE id = ANY (v_r.payer_ids) AND (effective_to IS NULL OR effective_to >= v_today)
              ORDER BY child_id, sort_order FOR UPDATE LOOP
    IF v_pp.effective_from >= v_from THEN
      -- A line that starts tomorrow or later: change it in place (nothing has been billed from it yet)
      UPDATE child_payment_payers SET
        method = CASE WHEN v_r.kind = 'new_account' THEN 'ach' ELSE 'check' END,
        bank_name = CASE WHEN v_r.kind = 'new_account' THEN v_r.bank_name END,
        account_type = CASE WHEN v_r.kind = 'new_account' THEN v_r.account_type END,
        last4 = CASE WHEN v_r.kind = 'new_account' THEN v_r.last4 END,
        routing_number = CASE WHEN v_r.kind = 'new_account' THEN v_r.routing_number END,
        account_number_enc = CASE WHEN v_r.kind = 'new_account' THEN v_r.account_number_enc END,
        card_brand = NULL,
        authorization_on_file = v_r.kind = 'new_account',
        authorization_signed_on = CASE WHEN v_r.kind = 'new_account' THEN p_signed_on END,
        authorization_file_id = CASE WHEN v_r.kind = 'new_account' THEN p_file_id END
      WHERE id = v_pp.id;
    ELSE
      -- End today; the same line goes on tomorrow with the new details. Queued drafts keep the old line.
      UPDATE child_payment_payers SET effective_to = v_today WHERE id = v_pp.id;
      INSERT INTO child_payment_payers (center_id, child_id, payer_guardian_id, payer_name, payer_kind, share_type, share_value, fixed_frequency,
             method, bank_name, account_type, last4, card_brand, other_details, draft_day, authorization_on_file, authorization_signed_on,
             authorization_file_id, sort_order, effective_from, effective_to, created_by, routing_number, account_number_enc)
      VALUES (v_pp.center_id, v_pp.child_id, v_pp.payer_guardian_id, v_pp.payer_name, v_pp.payer_kind, v_pp.share_type, v_pp.share_value, v_pp.fixed_frequency,
             CASE WHEN v_r.kind = 'new_account' THEN 'ach' ELSE 'check' END,
             CASE WHEN v_r.kind = 'new_account' THEN v_r.bank_name END,
             CASE WHEN v_r.kind = 'new_account' THEN v_r.account_type END,
             CASE WHEN v_r.kind = 'new_account' THEN v_r.last4 END,
             NULL, CASE WHEN v_r.kind = 'new_account' THEN NULL ELSE v_pp.other_details END, v_pp.draft_day,
             v_r.kind = 'new_account', CASE WHEN v_r.kind = 'new_account' THEN p_signed_on END, CASE WHEN v_r.kind = 'new_account' THEN p_file_id END,
             v_pp.sort_order, v_from, CASE WHEN v_pp.effective_to IS NOT NULL AND v_pp.effective_to >= v_from THEN v_pp.effective_to END, auth.uid(),
             CASE WHEN v_r.kind = 'new_account' THEN v_r.routing_number END,
             CASE WHEN v_r.kind = 'new_account' THEN v_r.account_number_enc END);
    END IF;
    v_done := v_done + 1;
  END LOOP;
  IF v_done = 0 THEN
    RAISE EXCEPTION 'These payers were changed since the request. Decline it and ask the parent to send a new one.' USING ERRCODE = '22023';
  END IF;

  UPDATE billing_bank_changes SET status = 'approved', decided_by = auth.uid(), decided_at = now(), effective_from = v_from,
         authorization_file_id = CASE WHEN kind = 'new_account' THEN p_file_id END,
         authorization_signed_on = CASE WHEN kind = 'new_account' THEN p_signed_on END
   WHERE id = p_id RETURNING * INTO v_r;
  PERFORM public.billing_bank_change_log(v_r, CASE v_r.kind
    WHEN 'new_account' THEN format('Bank change approved: ACH from %s ••%s from %s (authorization signed %s). Drafts already queued keep the old account.',
                                   initcap(v_r.account_type), v_r.last4, to_char(v_from, 'Mon FMDD, YYYY'), to_char(p_signed_on, 'Mon FMDD, YYYY'))
    ELSE format('ACH stopped for %s from %s: pays at the center. Drafts already queued still go out.', v_r.requester_name, to_char(v_from, 'Mon FMDD, YYYY')) END);
  RETURN jsonb_build_object('effective_from', v_from, 'lines', v_done, 'email', v_r.requester_email, 'requester_name', v_r.requester_name,
                            'kind', v_r.kind, 'last4', v_r.last4, 'account_type', v_r.account_type);
END $$;

CREATE OR REPLACE FUNCTION public.billing_bank_change_decline(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r billing_bank_changes%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM billing_bank_changes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_r.center_id);
  IF v_r.status <> 'pending' THEN RAISE EXCEPTION 'This request was already handled' USING ERRCODE = '22023'; END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'Give the parent a reason' USING ERRCODE = '22023'; END IF;
  UPDATE billing_bank_changes SET status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = left(btrim(p_reason), 300)
   WHERE id = p_id RETURNING * INTO v_r;
  PERFORM public.billing_bank_change_log(v_r, format('Bank change request from %s declined: %s', v_r.requester_name, v_r.decision_note));
  RETURN jsonb_build_object('email', v_r.requester_email, 'requester_name', v_r.requester_name, 'kind', v_r.kind, 'reason', v_r.decision_note);
END $$;

-- What the authorization form shows (routing, last 4, holder; never the full account number)
CREATE OR REPLACE FUNCTION public.billing_bank_change_form(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r billing_bank_changes%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM billing_bank_changes WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_r.center_id);
  RETURN jsonb_build_object('kind', v_r.kind, 'requester_name', v_r.requester_name, 'holder_name', v_r.holder_name, 'bank_name', v_r.bank_name,
    'routing_number', v_r.routing_number, 'account_type', v_r.account_type, 'last4', v_r.last4, 'created_at', v_r.created_at,
    'children', public.billing_bank_change_children(v_r.payer_ids),
    'center', (SELECT jsonb_build_object('name', c.name, 'phone', c.phone, 'email', NULLIF(btrim(c.email), ''), 'domain_key', c.domain_key) FROM centers c WHERE c.id = v_r.center_id),
    'company_name', (SELECT s.company_name FROM center_ach_settings s WHERE s.center_id = v_r.center_id));
END $$;

-- The owners and admins to tell about a new request (for the server)
CREATE OR REPLACE FUNCTION public.billing_bank_change_center_staff(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('center_id', r.center_id, 'domain_key', c.domain_key, 'center_name', c.name, 'requester_name', r.requester_name, 'kind', r.kind,
           'user_ids', COALESCE((SELECT jsonb_agg(DISTINCT a.user_id) FROM center_admins a WHERE a.center_id = r.center_id AND a.role IN ('owner', 'admin')), '[]'))
    FROM billing_bank_changes r JOIN centers c ON c.id = r.center_id WHERE r.id = p_id
$$;

-- Center owners and admins see the request count on the Billing page
CREATE OR REPLACE FUNCTION public.billing_bank_changes_open(p_center_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.tuition_can_manage(p_center_id)
              THEN (SELECT count(*)::int FROM billing_bank_changes WHERE center_id = p_center_id AND status = 'pending') ELSE 0 END
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['billing_bank_change_children(uuid[])', 'billing_bank_change_log(public.billing_bank_changes, text)',
    'parent_bank_change_create(text, text, text, text, jsonb)', 'parent_bank_change_cancel(text, uuid)', 'parent_bank_changes(text)',
    'billing_bank_change_center_staff(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['billing_bank_changes_list(uuid)', 'billing_bank_change_approve(uuid, uuid, date)', 'billing_bank_change_decline(uuid, text)',
    'billing_bank_change_form(uuid)', 'billing_bank_changes_open(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- ============================================================
-- Parent portal, phase 1: /parent, a page parents open without a CareLocal account.
--
--  - centers.parent_portal_enabled: the module switch (super admin only, like the other modules). Off by default.
--  - parent_access: one access code per person at a center. An owner or admin issues it from a contact on the
--    child's Contacts tab. The code is shown once; only an HMAC of it (keyed with the app's PARENT_CODE_PEPPER)
--    is stored, with its last 4 characters as a hint for staff.
--  - child_guardians.parent_access_id: which contact rows the code covers. Issuing a code for a contact also
--    links every other contact row at the center with the same email (the same parent of a sibling), so one
--    code shows all of that parent's children. Two parents of one child get separate codes, so one can be
--    turned off (custody, a request) without touching the other. Only the functions below can set the link.
--  - parent_sessions: a device that entered a valid code. The browser keeps a random token in an httpOnly
--    cookie; only its SHA-256 is stored. Sessions slide 30 days from last use, 180 days at most, and end when the
--    code is replaced or turned off, the center turns the portal off, or the child is withdrawn.
--  - parent_login_attempts: brute-force limit, 5 wrong codes per IP (stored as an HMAC) per 15 minutes.
--  - Parents see only enrolled children linked to their code, only the last 60 days, never voided entries,
--    never photos waiting for review, never staff names. Everything goes through the functions below, which
--    only the service role can call; anon and authenticated get nothing.
-- Rollback: supabase/rollbacks/20261228000000_parent_portal.down.sql
-- ============================================================

-- 1. The module switch -------------------------------------------------------------------------------------------
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS parent_portal_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_parent_portal_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.parent_portal_enabled IS NOT DISTINCT FROM OLD.parent_portal_enabled THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.parent_portal_enabled := OLD.parent_portal_enabled;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_parent_portal_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_parent_portal_flag ON public.centers;
CREATE TRIGGER trg_guard_parent_portal_flag BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_parent_portal_flag();

-- 2. Access codes ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.parent_access (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id      uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  code_hash      text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  code_hint      text NOT NULL CHECK (code_hint ~ '^[0-9A-Z]{4}$'),   -- last 4 characters, for staff
  issued_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);
CREATE INDEX IF NOT EXISTS parent_access_center_idx ON public.parent_access (center_id);

ALTER TABLE public.child_guardians ADD COLUMN IF NOT EXISTS parent_access_id uuid REFERENCES public.parent_access(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS child_guardians_parent_access_idx ON public.child_guardians (parent_access_id) WHERE parent_access_id IS NOT NULL;

-- A contact is linked to a code only by the functions below (they set carelocal.parent_access for the
-- transaction) or the service role, and only to a code of the same center. Unlinking is always allowed.
CREATE OR REPLACE FUNCTION public.guard_guardian_parent_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.parent_access_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.parent_access_id IS NOT DISTINCT FROM OLD.parent_access_id
     AND NEW.center_id IS NOT DISTINCT FROM OLD.center_id THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND current_setting('carelocal.parent_access', true) IS DISTINCT FROM 'on' THEN
    NEW.parent_access_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.parent_access_id END;
    IF NEW.parent_access_id IS NULL THEN RETURN NEW; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM parent_access a WHERE a.id = NEW.parent_access_id AND a.center_id = NEW.center_id) THEN
    RAISE EXCEPTION 'A parent access code can only cover contacts at its own center.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_guardian_parent_access() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_guardian_parent_access ON public.child_guardians;
CREATE TRIGGER trg_guard_guardian_parent_access BEFORE INSERT OR UPDATE ON public.child_guardians
  FOR EACH ROW EXECUTE FUNCTION public.guard_guardian_parent_access();

-- 3. Devices and sign-in attempts -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.parent_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_id     uuid NOT NULL REFERENCES public.parent_access(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ip_hash       text,
  user_agent    text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300)
);
CREATE INDEX IF NOT EXISTS parent_sessions_access_idx ON public.parent_sessions (access_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS parent_sessions_expires_idx ON public.parent_sessions (expires_at);

CREATE TABLE IF NOT EXISTS public.parent_login_attempts (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash  text NOT NULL,
  ok       boolean NOT NULL,
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parent_login_attempts_ip_idx ON public.parent_login_attempts (ip_hash, at DESC);
CREATE INDEX IF NOT EXISTS parent_login_attempts_at_idx ON public.parent_login_attempts (at);

ALTER TABLE public.parent_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parent_access FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.parent_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.parent_login_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.parent_access TO service_role;
GRANT ALL ON public.parent_sessions TO service_role;
GRANT ALL ON public.parent_login_attempts TO service_role;

-- 4. Parent side (service role only) ----------------------------------------------------------------------------

-- Enter a code. Returns {status: 'ok', expires_at} | {status: 'invalid', left} | {status: 'rate_limited', retry_after}.
-- A code works only while its center is active with the portal on and it covers at least one enrolled child.
CREATE OR REPLACE FUNCTION public.parent_login(p_code_hash text, p_ip_hash text, p_token_hash text, p_user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_window   constant interval := interval '15 minutes';
  c_max_fail constant integer := 5;
  v_fails    integer;
  v_oldest   timestamptz;
  v_access   uuid;
  v_expires  timestamptz := now() + interval '30 days';
BEGIN
  IF p_ip_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Bad sign-in request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('parent_login:' || p_ip_hash));
  DELETE FROM parent_login_attempts WHERE at < now() - interval '1 day';

  SELECT count(*), min(at) INTO v_fails, v_oldest FROM parent_login_attempts
   WHERE ip_hash = p_ip_hash AND NOT ok AND at > now() - c_window;
  IF v_fails >= c_max_fail THEN
    RETURN jsonb_build_object('status', 'rate_limited',
      'retry_after', GREATEST(60, ceil(extract(epoch FROM (v_oldest + c_window - now())))::integer));
  END IF;

  SELECT a.id INTO v_access
    FROM parent_access a JOIN centers c ON c.id = a.center_id
   WHERE a.code_hash = p_code_hash AND c.parent_portal_enabled AND c.is_active
     AND EXISTS (SELECT 1 FROM child_guardians g JOIN children ch ON ch.id = g.child_id
                  WHERE g.parent_access_id = a.id AND ch.status = 'enrolled');

  IF v_access IS NULL THEN
    INSERT INTO parent_login_attempts (ip_hash, ok) VALUES (p_ip_hash, false);
    RETURN jsonb_build_object('status', 'invalid', 'left', c_max_fail - v_fails - 1);
  END IF;

  INSERT INTO parent_login_attempts (ip_hash, ok) VALUES (p_ip_hash, true);
  INSERT INTO parent_sessions (access_id, token_hash, expires_at, ip_hash, user_agent)
  VALUES (v_access, p_token_hash, v_expires, p_ip_hash, left(p_user_agent, 300));
  UPDATE parent_access SET last_login_at = now() WHERE id = v_access;
  -- At most 10 devices per code: the least recently used go first
  DELETE FROM parent_sessions WHERE id IN (
    SELECT id FROM parent_sessions WHERE access_id = v_access ORDER BY last_seen_at DESC OFFSET 10);
  DELETE FROM parent_sessions WHERE expires_at < now() - interval '1 day';
  RETURN jsonb_build_object('status', 'ok', 'expires_at', v_expires);
END $$;

-- The code a session belongs to, or NULL (expired, replaced, turned off, portal off). Slides the expiry.
CREATE OR REPLACE FUNCTION public.parent_session_access(p_token_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_session parent_sessions%ROWTYPE;
BEGIN
  SELECT s.* INTO v_session
    FROM parent_sessions s JOIN parent_access a ON a.id = s.access_id JOIN centers c ON c.id = a.center_id
   WHERE s.token_hash = p_token_hash AND s.expires_at > now() AND c.parent_portal_enabled AND c.is_active;
  IF v_session.id IS NULL THEN RETURN NULL; END IF;
  IF v_session.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE parent_sessions
       SET last_seen_at = now(), expires_at = LEAST(created_at + interval '180 days', now() + interval '30 days')
     WHERE id = v_session.id;
  END IF;
  RETURN v_session.access_id;
END $$;

-- An enrolled child this session may see, or NULL
CREATE OR REPLACE FUNCTION public.parent_session_child(p_token_hash text, p_child_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT ch.id FROM children ch
   WHERE ch.id = p_child_id AND ch.status = 'enrolled'
     AND EXISTS (SELECT 1 FROM child_guardians g
                  WHERE g.child_id = ch.id AND g.parent_access_id = public.parent_session_access(p_token_hash));
$$;

CREATE OR REPLACE FUNCTION public.parent_logout(p_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM parent_sessions WHERE token_hash = p_token_hash;
$$;

-- The portal's first screen: the center, the parent's name and their enrolled children. NULL = signed out.
CREATE OR REPLACE FUNCTION public.parent_portal_home(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_access uuid; v_center uuid; v_result jsonb;
BEGIN
  v_access := public.parent_session_access(p_token_hash);
  IF v_access IS NULL THEN RETURN NULL; END IF;
  SELECT center_id INTO v_center FROM parent_access WHERE id = v_access;
  SELECT jsonb_build_object(
    'center', jsonb_build_object('id', c.id, 'name', c.name, 'email', NULLIF(btrim(c.email), ''), 'phone', c.phone,
                                 'timezone', public.roster_timezone(c.id), 'today', public.roster_today(c.id),
                                 'domain_key', c.domain_key),
    'parent', jsonb_build_object('name', (SELECT g.name FROM child_guardians g WHERE g.parent_access_id = v_access
                                          ORDER BY g.is_primary DESC, g.created_at LIMIT 1)),
    'children', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', ch.id,
               'first_name', COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name),
               'photo_key', ch.photo_key)
             ORDER BY ch.date_of_birth DESC NULLS LAST, ch.first_name)
        FROM children ch
       WHERE ch.center_id = v_center AND ch.status = 'enrolled'
         AND EXISTS (SELECT 1 FROM child_guardians g WHERE g.child_id = ch.id AND g.parent_access_id = v_access)), '[]'::jsonb))
  INTO v_result
  FROM centers c WHERE c.id = v_center;
  IF jsonb_array_length(v_result -> 'children') = 0 THEN RETURN NULL; END IF;
  RETURN v_result;
END $$;

-- One child's day, as the daily report shows it (no voided entries, approved photos only, no staff names).
-- Days from 60 days ago up to today. NULL = not this parent's child or a day out of range.
CREATE OR REPLACE FUNCTION public.parent_portal_day(p_token_hash text, p_child_id uuid, p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_child uuid; v_center uuid; v_today date; v_day date; v_result jsonb;
BEGIN
  v_child := public.parent_session_child(p_token_hash, p_child_id);
  IF v_child IS NULL THEN RETURN NULL; END IF;
  SELECT center_id INTO v_center FROM children WHERE id = v_child;
  v_today := public.roster_today(v_center);
  v_day := COALESCE(p_day, v_today);
  IF v_day > v_today OR v_day < v_today - 60 THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'child', jsonb_build_object('id', ch.id, 'first_name', COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name)),
    'center', jsonb_build_object('id', c.id, 'name', c.name, 'email', NULLIF(btrim(c.email), ''), 'phone', c.phone,
                                 'timezone', public.roster_timezone(c.id), 'domain_key', c.domain_key),
    'day', v_day,
    'today', v_today,
    'arrived_at', (SELECT min(at) FROM roster_events WHERE child_id = ch.id AND service_date = v_day AND action = 'check_in'),
    'left_at', (SELECT max(at) FROM roster_events WHERE child_id = ch.id AND service_date = v_day AND action = 'check_out'),
    'entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'kind', e.kind, 'at', e.at, 'ends_at', e.ends_at,
               'details', e.details,
               'checks', CASE WHEN e.kind = 'nap' THEN (SELECT count(*) FROM child_daily_entries s
                                                         WHERE s.nap_id = e.id AND s.kind = 'sleep_check' AND s.voided_at IS NULL) END)
             ORDER BY e.at)
      FROM child_daily_entries e
      WHERE e.child_id = ch.id AND e.service_date = v_day AND e.voided_at IS NULL AND e.kind <> 'sleep_check'
        AND (e.kind <> 'photo' OR e.approved_at IS NOT NULL)), '[]'::jsonb),
    'recipients', '[]'::jsonb)
  INTO v_result
  FROM children ch JOIN centers c ON c.id = ch.center_id
  WHERE ch.id = v_child;
  RETURN v_result;
END $$;

-- One child's approved photos, newest first, from the last 60 days. p_before pages back (exclusive).
CREATE OR REPLACE FUNCTION public.parent_portal_photos(p_token_hash text, p_child_id uuid, p_before timestamptz DEFAULT NULL, p_limit integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_child uuid; v_center uuid; v_today date;
BEGIN
  v_child := public.parent_session_child(p_token_hash, p_child_id);
  IF v_child IS NULL THEN RETURN NULL; END IF;
  SELECT center_id INTO v_center FROM children WHERE id = v_child;
  v_today := public.roster_today(v_center);
  RETURN jsonb_build_object(
    'center_id', v_center,
    'timezone', public.roster_timezone(v_center),
    'photos', COALESCE((
      SELECT jsonb_agg(p ORDER BY p.at DESC) FROM (
        SELECT e.id, e.service_date AS day, e.at, e.details ->> 'photo_key' AS photo_key, e.details ->> 'caption' AS caption
          FROM child_daily_entries e
         WHERE e.child_id = v_child AND e.kind = 'photo' AND e.voided_at IS NULL AND e.approved_at IS NOT NULL
           AND e.service_date BETWEEN v_today - 60 AND v_today
           AND (p_before IS NULL OR e.at < p_before)
           AND e.details ? 'photo_key'
         ORDER BY e.at DESC
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 60)) p), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.parent_login(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_session_access(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_session_child(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_logout(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_portal_home(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_portal_day(text, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_portal_photos(text, uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_login(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_session_access(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_session_child(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_logout(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_portal_home(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_portal_day(text, uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_portal_photos(text, uuid, timestamptz, integer) TO service_role;

-- 5. Center side (owners and admins) ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.parent_access_check(p_center_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_confidential(p_center_id) THEN
    RAISE EXCEPTION 'Only the owner and administrators can manage parent access.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM centers WHERE id = p_center_id AND parent_portal_enabled) THEN
    RAISE EXCEPTION 'The parent portal is not turned on for your center.' USING ERRCODE = '42501';
  END IF;
END $$;

-- Each contact of a child: whether they have a code, its hint, last sign-in, devices, the other children it covers.
-- {enabled: false} when the portal is off (or the caller is not an owner or admin).
CREATE OR REPLACE FUNCTION public.parent_access_status(p_center_id uuid, p_child_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_confidential(p_center_id)
     OR NOT EXISTS (SELECT 1 FROM centers WHERE id = p_center_id AND parent_portal_enabled) THEN
    RETURN jsonb_build_object('enabled', false, 'contacts', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('enabled', true, 'contacts', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'guardian_id', g.id,
             'has_access', a.id IS NOT NULL,
             'code_hint', a.code_hint,
             'issued_at', a.issued_at,
             'last_login_at', a.last_login_at,
             'devices', (SELECT count(*) FROM parent_sessions s WHERE s.access_id = a.id AND s.expires_at > now()),
             'also_covers', COALESCE((
               SELECT jsonb_agg(DISTINCT COALESCE(NULLIF(btrim(o.preferred_name), ''), o.first_name))
                 FROM child_guardians og JOIN children o ON o.id = og.child_id
                WHERE og.parent_access_id = a.id AND og.child_id <> p_child_id AND o.status = 'enrolled'), '[]'::jsonb)))
      FROM child_guardians g LEFT JOIN parent_access a ON a.id = g.parent_access_id
     WHERE g.center_id = p_center_id AND g.child_id = p_child_id), '[]'::jsonb));
END $$;

-- Give a contact a code, or a new one (the old code and its devices stop working).
-- When the contact has no code but another contact row at the center with the same email does, the contact is
-- added to that code instead and no new code is made: {access_id, new_code: false}. Otherwise the code whose
-- HMAC is p_code_hash is saved and every unlinked same-email contact row joins it: {access_id, new_code: true}.
CREATE OR REPLACE FUNCTION public.parent_access_issue(p_center_id uuid, p_guardian_id uuid, p_code_hash text, p_code_hint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_guardian child_guardians%ROWTYPE; v_email text; v_access uuid;
BEGIN
  PERFORM public.parent_access_check(p_center_id);
  SELECT * INTO v_guardian FROM child_guardians WHERE id = p_guardian_id AND center_id = p_center_id;
  IF v_guardian.id IS NULL THEN RAISE EXCEPTION 'Contact not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM children WHERE id = v_guardian.child_id AND status = 'enrolled') THEN
    RAISE EXCEPTION 'Parent access is only for children who are enrolled.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('carelocal.parent_access', 'on', true);
  v_email := lower(NULLIF(btrim(v_guardian.email), ''));

  IF v_guardian.parent_access_id IS NOT NULL THEN
    UPDATE parent_access SET code_hash = p_code_hash, code_hint = p_code_hint, issued_by = auth.uid(), issued_at = now()
     WHERE id = v_guardian.parent_access_id;
    DELETE FROM parent_sessions WHERE access_id = v_guardian.parent_access_id;
    RETURN jsonb_build_object('access_id', v_guardian.parent_access_id, 'new_code', true);
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT g.parent_access_id INTO v_access FROM child_guardians g
     WHERE g.center_id = p_center_id AND g.parent_access_id IS NOT NULL AND lower(btrim(g.email)) = v_email
     ORDER BY g.created_at LIMIT 1;
    IF v_access IS NOT NULL THEN
      UPDATE child_guardians SET parent_access_id = v_access WHERE id = p_guardian_id;
      RETURN jsonb_build_object('access_id', v_access, 'new_code', false);
    END IF;
  END IF;

  INSERT INTO parent_access (center_id, code_hash, code_hint, issued_by)
  VALUES (p_center_id, p_code_hash, p_code_hint, auth.uid()) RETURNING id INTO v_access;
  UPDATE child_guardians SET parent_access_id = v_access
   WHERE center_id = p_center_id AND parent_access_id IS NULL
     AND (id = p_guardian_id OR (v_email IS NOT NULL AND lower(btrim(email)) = v_email));
  RETURN jsonb_build_object('access_id', v_access, 'new_code', true);
END $$;

-- Turn a contact's parent access off: the code, its devices and every child it covered.
CREATE OR REPLACE FUNCTION public.parent_access_revoke(p_center_id uuid, p_guardian_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_access uuid;
BEGIN
  PERFORM public.parent_access_check(p_center_id);
  SELECT parent_access_id INTO v_access FROM child_guardians WHERE id = p_guardian_id AND center_id = p_center_id;
  IF v_access IS NULL THEN RETURN; END IF;
  PERFORM set_config('carelocal.parent_access', 'on', true);
  DELETE FROM parent_access WHERE id = v_access AND center_id = p_center_id;
END $$;

-- For emailing a code just issued: the contact's email, only when p_code_hash is that contact's current code.
CREATE OR REPLACE FUNCTION public.parent_access_email_data(p_center_id uuid, p_guardian_id uuid, p_code_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.parent_access_check(p_center_id);
  RETURN (
    SELECT jsonb_build_object('name', g.name, 'email', NULLIF(btrim(g.email), ''),
             'center', jsonb_build_object('name', c.name, 'email', NULLIF(btrim(c.email), ''), 'phone', c.phone, 'domain_key', c.domain_key),
             'children', (SELECT jsonb_agg(DISTINCT COALESCE(NULLIF(btrim(o.preferred_name), ''), o.first_name))
                            FROM child_guardians og JOIN children o ON o.id = og.child_id
                           WHERE og.parent_access_id = a.id AND o.status = 'enrolled'))
      FROM child_guardians g JOIN parent_access a ON a.id = g.parent_access_id JOIN centers c ON c.id = g.center_id
     WHERE g.id = p_guardian_id AND g.center_id = p_center_id AND a.code_hash = p_code_hash);
END $$;

REVOKE ALL ON FUNCTION public.parent_access_check(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_access_status(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parent_access_issue(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parent_access_revoke(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parent_access_email_data(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_access_status(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_access_issue(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_access_revoke(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_access_email_data(uuid, uuid, text) TO authenticated;

-- 6. Withdrawing a child or turning the portal off ends what parents can see right away: the functions above
--    check both on every call, so nothing else is needed here.

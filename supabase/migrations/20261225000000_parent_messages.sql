-- ============================================================
-- Parent messages (email, phase 1): a teacher taps a child on the Live roster, picks one or more of the child's
-- authorized pick-up contacts, and sends a short message by email.
--  - child_guardians.can_message: owners and admins can keep a contact off the list (custody, a request to stop).
--    On by default; only contacts who can pick up the child, have an email and can_message are offered.
--  - parent_messages: one row per message (the child's record of what was sent, by whom, and when).
--  - parent_message_recipients: one row per address, with its delivery result. Two contacts who share one
--    address get one email.
--  - Teachers never see a contact's email address: the picker and the history come through the functions below.
--  - The app sends right away (parent_message_claim with the message id); anything left unsent (a crash, a
--    provider error) is retried by the cron run every 10 minutes, up to 3 attempts, then marked failed.
--  - Replies go to the center's email. Two-way threads come later.
-- Rollback: supabase/rollbacks/20261225000000_parent_messages.down.sql
-- ============================================================

-- 1. Who can be messaged -----------------------------------------------------------------------------------------
ALTER TABLE public.child_guardians ADD COLUMN IF NOT EXISTS can_message boolean NOT NULL DEFAULT true;

-- 2. Messages and recipients ----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.parent_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id     uuid NOT NULL,
  child_id      uuid NOT NULL,
  subject       text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 120),
  body          text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  channel       text NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  status        text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'partial', 'failed')),
  sent_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_label  text NOT NULL,                                -- "Priya S.", as it was when sent
  client_key    uuid NOT NULL,                                -- the app's key: a retried Send is sent once
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  FOREIGN KEY (child_id, center_id) REFERENCES public.children (id, center_id) ON DELETE CASCADE,
  CONSTRAINT parent_messages_client_key UNIQUE (center_id, client_key)
);
CREATE INDEX IF NOT EXISTS parent_messages_child_idx ON public.parent_messages (child_id, created_at DESC);
CREATE INDEX IF NOT EXISTS parent_messages_sender_idx ON public.parent_messages (sent_by, created_at DESC);

CREATE TABLE IF NOT EXISTS public.parent_message_recipients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       uuid NOT NULL REFERENCES public.parent_messages(id) ON DELETE CASCADE,
  center_id        uuid NOT NULL,
  guardian_id      uuid REFERENCES public.child_guardians(id) ON DELETE SET NULL,
  name             text NOT NULL,                             -- as it was when sent
  email            text NOT NULL,
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  attempts         integer NOT NULL DEFAULT 0,
  last_attempt_at  timestamptz,
  provider_id      text,
  last_error       text,
  sent_at          timestamptz,
  CONSTRAINT parent_message_recipients_one_email UNIQUE (message_id, email)
);
CREATE INDEX IF NOT EXISTS parent_message_recipients_due_idx ON public.parent_message_recipients (last_attempt_at) WHERE status = 'queued';

ALTER TABLE public.parent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_message_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners and admins read parent_messages" ON public.parent_messages;
CREATE POLICY "Owners and admins read parent_messages" ON public.parent_messages
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
DROP POLICY IF EXISTS "Owners and admins read parent_message_recipients" ON public.parent_message_recipients;
CREATE POLICY "Owners and admins read parent_message_recipients" ON public.parent_message_recipients
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
REVOKE ALL ON public.parent_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.parent_message_recipients FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.parent_messages TO authenticated;
GRANT SELECT ON public.parent_message_recipients TO authenticated;
GRANT ALL ON public.parent_messages TO service_role;
GRANT ALL ON public.parent_message_recipients TO service_role;

-- 3. Shared checks -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.parent_message_check(p_center_id uuid, p_child_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN
    RAISE EXCEPTION 'The live roster is not turned on for your center, or you do not have access to it.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM children WHERE id = p_child_id AND center_id = p_center_id AND status = 'enrolled') THEN
    RAISE EXCEPTION 'That child is not enrolled at this center.' USING ERRCODE = '42501';
  END IF;
END $$;

-- 4. Teachers: who can get a message (no email addresses, only whether one is on file) --------------------------
CREATE OR REPLACE FUNCTION public.parent_message_contacts(p_center_id uuid, p_child_id uuid)
RETURNS TABLE (id uuid, name text, relationship text, is_primary boolean, has_email boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.parent_message_check(p_center_id, p_child_id);
  RETURN QUERY
  SELECT g.id, g.name, g.relationship, g.is_primary, NULLIF(btrim(g.email), '') IS NOT NULL
  FROM child_guardians g
  WHERE g.child_id = p_child_id AND g.center_id = p_center_id AND g.can_pick_up AND g.can_message
  ORDER BY g.is_primary DESC, g.name;
END $$;

-- 5. Teachers: write a message. Returns its id (the existing one when the same Send is retried). -----------------
CREATE OR REPLACE FUNCTION public.parent_message_create(
  p_center_id uuid, p_child_id uuid, p_guardian_ids uuid[], p_subject text, p_body text, p_client_key uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_subject text := NULLIF(btrim(regexp_replace(COALESCE(p_subject, ''), '[\r\n]+', ' ', 'g')), '');
  v_body text := NULLIF(btrim(COALESCE(p_body, '')), '');
  v_ids uuid[] := ARRAY(SELECT DISTINCT unnest(COALESCE(p_guardian_ids, '{}'::uuid[])));
  v_ok integer;
  v_child text;
BEGIN
  IF p_client_key IS NULL THEN RAISE EXCEPTION 'Missing the message key.' USING ERRCODE = '22023'; END IF;
  PERFORM public.parent_message_check(p_center_id, p_child_id);
  SELECT id INTO v_id FROM parent_messages WHERE center_id = p_center_id AND client_key = p_client_key AND child_id = p_child_id;
  IF FOUND THEN RETURN v_id; END IF;

  IF v_body IS NULL OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'Write the message (up to 2,000 characters).' USING ERRCODE = '22023';
  END IF;
  IF v_subject IS NOT NULL AND char_length(v_subject) > 120 THEN
    RAISE EXCEPTION 'Keep the subject to 120 characters.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_ids) = 0 THEN RAISE EXCEPTION 'Pick at least one person to send to.' USING ERRCODE = '22023'; END IF;
  IF cardinality(v_ids) > 10 THEN RAISE EXCEPTION 'Pick up to 10 people.' USING ERRCODE = '22023'; END IF;

  SELECT count(*) INTO v_ok FROM child_guardians g
  WHERE g.id = ANY (v_ids) AND g.child_id = p_child_id AND g.center_id = p_center_id
    AND g.can_pick_up AND g.can_message AND NULLIF(btrim(g.email), '') IS NOT NULL;
  IF v_ok <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Someone you picked cannot get messages. Close and try again.' USING ERRCODE = '22023';
  END IF;

  -- A guard against runaway sends: 30 messages an hour per person per center
  IF (SELECT count(*) FROM parent_messages WHERE center_id = p_center_id AND sent_by = auth.uid()
      AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'That is a lot of messages in one hour. Wait a little and try again.' USING ERRCODE = '54000';
  END IF;

  SELECT COALESCE(NULLIF(btrim(preferred_name), ''), first_name) INTO v_child FROM children WHERE id = p_child_id;
  INSERT INTO parent_messages (center_id, child_id, subject, body, sent_by, sender_label, client_key)
  VALUES (p_center_id, p_child_id, COALESCE(v_subject, 'A note about ' || v_child), v_body, auth.uid(),
          COALESCE(public.daily_person_label(auth.uid(), p_center_id), 'Staff'), p_client_key)
  RETURNING id INTO v_id;

  INSERT INTO parent_message_recipients (message_id, center_id, guardian_id, name, email)
  SELECT DISTINCT ON (lower(btrim(g.email))) v_id, p_center_id, g.id, g.name, lower(btrim(g.email))
  FROM child_guardians g WHERE g.id = ANY (v_ids)
  ORDER BY lower(btrim(g.email)), g.is_primary DESC, g.name;
  RETURN v_id;
END $$;

-- 6. Everyone on the roster: a child's recent messages (names and results, no addresses) -------------------------
CREATE OR REPLACE FUNCTION public.parent_messages_for_child(p_center_id uuid, p_child_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, subject text, body text, sender_label text, status text, created_at timestamptz, recipients jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.parent_message_check(p_center_id, p_child_id);
  RETURN QUERY
  SELECT m.id, m.subject, m.body, m.sender_label, m.status, m.created_at,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('name', r.name, 'status', r.status) ORDER BY r.name)
                   FROM parent_message_recipients r WHERE r.message_id = m.id), '[]'::jsonb)
  FROM parent_messages m
  WHERE m.center_id = p_center_id AND m.child_id = p_child_id
  ORDER BY m.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
END $$;

-- 7. The sender (service role only) -----------------------------------------------------------------------------
-- A message's status from its recipients: any still queued = sending; all sent = sent; some = partial; none = failed
CREATE OR REPLACE FUNCTION public.parent_message_refresh(p_message_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE parent_messages m SET
    status = s.status,
    finished_at = CASE WHEN s.status = 'sending' THEN NULL ELSE COALESCE(m.finished_at, now()) END
  FROM (
    SELECT CASE WHEN bool_or(r.status = 'queued') THEN 'sending'
                WHEN bool_and(r.status = 'sent') THEN 'sent'
                WHEN bool_or(r.status = 'sent') THEN 'partial'
                ELSE 'failed' END AS status
    FROM parent_message_recipients r WHERE r.message_id = p_message_id
  ) s
  WHERE m.id = p_message_id AND s.status IS NOT NULL;
$$;

-- Claim recipients to send to. With a message id: that message's not-yet-tried recipients (the app, right after
-- Send). Without: the cron retry, recipients still queued 10 minutes after their last try; after 3 tries, failed.
CREATE OR REPLACE FUNCTION public.parent_message_claim(p_message_id uuid DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (recipient_id uuid, message_id uuid, name text, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_msg uuid;
BEGIN
  IF p_message_id IS NULL THEN
    FOR v_msg IN
      UPDATE parent_message_recipients SET status = 'failed', last_error = COALESCE(last_error, 'Not sent after 3 tries')
      WHERE status = 'queued' AND attempts >= 3 AND last_attempt_at < now() - interval '10 minutes'
      RETURNING parent_message_recipients.message_id
    LOOP
      PERFORM public.parent_message_refresh(v_msg);
    END LOOP;
  END IF;

  RETURN QUERY
  UPDATE parent_message_recipients r SET attempts = r.attempts + 1, last_attempt_at = now()
  WHERE r.id IN (
    SELECT q.id FROM parent_message_recipients q
    WHERE q.status = 'queued' AND (
      (p_message_id IS NOT NULL AND q.message_id = p_message_id AND q.last_attempt_at IS NULL)
      OR (p_message_id IS NULL AND q.attempts < 3 AND (q.last_attempt_at IS NULL OR q.last_attempt_at < now() - interval '10 minutes')))
    ORDER BY q.last_attempt_at NULLS FIRST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED)
  RETURNING r.id, r.message_id, r.name, r.email;
END $$;

-- What an email holds
CREATE OR REPLACE FUNCTION public.parent_message_data(p_message_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', m.id, 'subject', m.subject, 'body', m.body, 'sender_label', m.sender_label, 'created_at', m.created_at,
    'child', jsonb_build_object('first_name', COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name)),
    'center', jsonb_build_object('name', c.name, 'email', NULLIF(btrim(c.email), ''), 'phone', c.phone, 'domain_key', c.domain_key))
  FROM parent_messages m JOIN children ch ON ch.id = m.child_id JOIN centers c ON c.id = m.center_id
  WHERE m.id = p_message_id;
$$;

-- Record one recipient's result. A failure stays queued for the retry (failed after 3 tries).
CREATE OR REPLACE FUNCTION public.parent_message_recipient_finish(p_recipient_id uuid, p_ok boolean, p_provider_id text DEFAULT NULL, p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_msg uuid;
BEGIN
  UPDATE parent_message_recipients SET
    status      = CASE WHEN p_ok THEN 'sent' WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
    provider_id = CASE WHEN p_ok THEN left(p_provider_id, 200) ELSE provider_id END,
    sent_at     = CASE WHEN p_ok THEN now() ELSE sent_at END,
    last_error  = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END
  WHERE id = p_recipient_id AND status = 'queued'
  RETURNING message_id INTO v_msg;
  IF v_msg IS NOT NULL THEN PERFORM public.parent_message_refresh(v_msg); END IF;
END $$;

-- 8. Grants -----------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.parent_message_check(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_message_contacts(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parent_message_create(uuid, uuid, uuid[], text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parent_messages_for_child(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_message_contacts(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_message_create(uuid, uuid, uuid[], text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_messages_for_child(uuid, uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.parent_message_refresh(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_message_claim(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_message_data(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_message_recipient_finish(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_message_refresh(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_message_claim(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_message_data(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_message_recipient_finish(uuid, boolean, text, text) TO service_role;

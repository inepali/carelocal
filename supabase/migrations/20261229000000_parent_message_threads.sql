-- ============================================================
-- Parent messages, phase 2: conversations on the parent page.
--
--  - A message is a conversation (thread) of its own, or a reply to one (parent_messages.reply_to = the first
--    message). Replies are never nested.
--  - Parents write too (author_kind = 'parent', channel = 'portal'): a new message about their child from the
--    parent page, or a reply. Any time of day. The child's teachers see it on the Live roster (an unread dot on
--    the child until someone on the roster opens it) and the center's owners and admins get an email copy.
--  - Staff reply from the child card. A reply goes to the parents in that conversation (by email, with a link).
--  - parent_message_recipients.kind: 'parent' (a contact) or 'staff' (an owner or admin getting the copy).
--    read_at / acknowledged_at: the parent opened it / tapped Acknowledge on the parent page.
--  - parent_message_links: each parent email carries a link (/parent/m/<token>, 30 days) that opens ONLY that
--    conversation: read, acknowledge, reply. Photos and daily activities still need the PIN. Only the
--    token's SHA-256 is stored. Links work only while the center has the parent page on.
--  - Who in a conversation: the contacts it was sent to, and the parent who wrote it. A parent sees only
--    conversations they are part of (another parent of the same child, with their own code, does not see them).
--  - Parents see the last 60 days, like the rest of the parent page.
-- Rollback: supabase/rollbacks/20261229000000_parent_message_threads.down.sql
-- ============================================================

-- 1. Columns ----------------------------------------------------------------------------------------------------
ALTER TABLE public.parent_messages ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES public.parent_messages(id) ON DELETE CASCADE;
ALTER TABLE public.parent_messages ADD COLUMN IF NOT EXISTS author_kind text NOT NULL DEFAULT 'staff';
ALTER TABLE public.parent_messages ADD COLUMN IF NOT EXISTS guardian_id uuid REFERENCES public.child_guardians(id) ON DELETE SET NULL;
ALTER TABLE public.parent_messages ADD COLUMN IF NOT EXISTS staff_seen_at timestamptz;
ALTER TABLE public.parent_messages ADD COLUMN IF NOT EXISTS staff_seen_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.parent_messages DROP CONSTRAINT IF EXISTS parent_messages_author_kind_check;
ALTER TABLE public.parent_messages ADD CONSTRAINT parent_messages_author_kind_check CHECK (author_kind IN ('staff', 'parent'));
ALTER TABLE public.parent_messages DROP CONSTRAINT IF EXISTS parent_messages_channel_check;
ALTER TABLE public.parent_messages ADD CONSTRAINT parent_messages_channel_check CHECK (channel IN ('email', 'portal'));
CREATE INDEX IF NOT EXISTS parent_messages_reply_to_idx ON public.parent_messages (reply_to, created_at) WHERE reply_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS parent_messages_unseen_idx ON public.parent_messages (center_id, child_id)
  WHERE author_kind = 'parent' AND staff_seen_at IS NULL;

ALTER TABLE public.parent_message_recipients ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'parent';
ALTER TABLE public.parent_message_recipients ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.parent_message_recipients ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE public.parent_message_recipients ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE public.parent_message_recipients DROP CONSTRAINT IF EXISTS parent_message_recipients_kind_check;
ALTER TABLE public.parent_message_recipients ADD CONSTRAINT parent_message_recipients_kind_check CHECK (kind IN ('parent', 'staff'));
CREATE INDEX IF NOT EXISTS parent_message_recipients_guardian_idx ON public.parent_message_recipients (guardian_id) WHERE guardian_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.parent_message_links (
  recipient_id  uuid PRIMARY KEY REFERENCES public.parent_message_recipients(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
ALTER TABLE public.parent_message_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parent_message_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.parent_message_links TO service_role;

-- 2. Who is in a conversation ---------------------------------------------------------------------------------
-- The contacts of a conversation: everyone a staff message in it was sent to, and every parent who wrote in it.
CREATE OR REPLACE FUNCTION public.parent_thread_contacts(p_thread_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.guardian_id FROM parent_message_recipients r JOIN parent_messages m ON m.id = r.message_id
   WHERE (m.id = p_thread_id OR m.reply_to = p_thread_id) AND r.kind = 'parent' AND r.guardian_id IS NOT NULL
  UNION
  SELECT m.guardian_id FROM parent_messages m
   WHERE (m.id = p_thread_id OR m.reply_to = p_thread_id) AND m.author_kind = 'parent' AND m.guardian_id IS NOT NULL;
$$;

-- The parent acting on the parent page: their contact rows (all rows linked to their PIN), and, when
-- they came from an email link, the one conversation that link opens. NULL guardians = not signed in.
CREATE OR REPLACE FUNCTION public.parent_actor(p_token_hash text, p_link_hash text, OUT guardians uuid[], OUT only_thread uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_access uuid; v_guardian uuid; v_msg uuid;
BEGIN
  IF p_token_hash IS NOT NULL THEN
    v_access := public.parent_session_access(p_token_hash);
    IF v_access IS NULL THEN RETURN; END IF;
  ELSIF p_link_hash IS NOT NULL THEN
    SELECT r.guardian_id, COALESCE(m.reply_to, m.id) INTO v_guardian, only_thread
      FROM parent_message_links l
      JOIN parent_message_recipients r ON r.id = l.recipient_id AND r.kind = 'parent'
      JOIN parent_messages m ON m.id = r.message_id
      JOIN centers c ON c.id = m.center_id
     WHERE l.token_hash = p_link_hash AND l.expires_at > now() AND c.parent_portal_enabled AND c.is_active;
    IF v_guardian IS NULL THEN only_thread := NULL; RETURN; END IF;
    SELECT parent_access_id INTO v_access FROM child_guardians WHERE id = v_guardian;
  ELSE
    RETURN;
  END IF;
  guardians := ARRAY(
    SELECT g.id FROM child_guardians g JOIN children ch ON ch.id = g.child_id
     WHERE ch.status = 'enrolled' AND g.can_message
       AND ((v_access IS NOT NULL AND g.parent_access_id = v_access) OR g.id = v_guardian));
  IF cardinality(guardians) = 0 THEN guardians := NULL; only_thread := NULL; END IF;
END $$;

-- A conversation this parent may open: theirs, about one of their children, active in the last 60 days
CREATE OR REPLACE FUNCTION public.parent_thread_visible(p_guardians uuid[], p_only_thread uuid, p_thread_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_guardians IS NOT NULL
     AND (p_only_thread IS NULL OR p_only_thread = p_thread_id)
     AND EXISTS (
       SELECT 1 FROM parent_messages t
        WHERE t.id = p_thread_id AND t.reply_to IS NULL
          AND EXISTS (SELECT 1 FROM child_guardians g WHERE g.id = ANY (p_guardians) AND g.child_id = t.child_id)
          AND EXISTS (SELECT 1 FROM public.parent_thread_contacts(t.id) c WHERE c = ANY (p_guardians))
          AND (SELECT max(m.created_at) FROM parent_messages m WHERE m.id = t.id OR m.reply_to = t.id)
              > now() - interval '60 days');
$$;

-- 3. Parent page (service role only) -----------------------------------------------------------------------------

-- One child's conversations, newest first
CREATE OR REPLACE FUNCTION public.parent_portal_threads(p_token_hash text, p_child_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor record;
BEGIN
  SELECT * INTO v_actor FROM public.parent_actor(p_token_hash, NULL);
  IF v_actor.guardians IS NULL OR public.parent_session_child(p_token_hash, p_child_id) IS NULL THEN RETURN NULL; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.last_at DESC) FROM (
      SELECT t.id, t.subject,
             last.created_at AS last_at,
             CASE WHEN last.author_kind = 'parent' THEN
                    CASE WHEN last.guardian_id = ANY (v_actor.guardians) THEN 'You' ELSE last.sender_label END
                  ELSE last.sender_label END AS last_from,
             left(last.body, 140) AS preview,
             (SELECT count(*) FROM parent_messages m JOIN parent_message_recipients r ON r.message_id = m.id
               WHERE (m.id = t.id OR m.reply_to = t.id) AND r.kind = 'parent'
                 AND r.guardian_id = ANY (v_actor.guardians) AND r.read_at IS NULL) AS unread,
             EXISTS (SELECT 1 FROM parent_messages m JOIN parent_message_recipients r ON r.message_id = m.id
                      WHERE (m.id = t.id OR m.reply_to = t.id) AND r.kind = 'parent'
                        AND r.guardian_id = ANY (v_actor.guardians) AND r.acknowledged_at IS NULL) AS needs_ack
        FROM parent_messages t
        CROSS JOIN LATERAL (SELECT m.* FROM parent_messages m WHERE m.id = t.id OR m.reply_to = t.id
                             ORDER BY m.created_at DESC LIMIT 1) last
       WHERE t.child_id = p_child_id AND t.reply_to IS NULL
         AND public.parent_thread_visible(v_actor.guardians, NULL, t.id)
       ORDER BY last.created_at DESC
       LIMIT 50) x), '[]'::jsonb);
END $$;

-- One conversation. Marks what was sent to this parent as read. NULL = not theirs (or the link expired).
CREATE OR REPLACE FUNCTION public.parent_portal_thread(p_token_hash text, p_link_hash text, p_thread_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor record; v_thread uuid; v_result jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.parent_actor(p_token_hash, CASE WHEN p_token_hash IS NULL THEN p_link_hash END);
  v_thread := COALESCE(p_thread_id, v_actor.only_thread);
  IF v_thread IS NULL OR NOT public.parent_thread_visible(v_actor.guardians, v_actor.only_thread, v_thread) THEN RETURN NULL; END IF;

  UPDATE parent_message_recipients r SET read_at = now()
    FROM parent_messages m
   WHERE m.id = r.message_id AND (m.id = v_thread OR m.reply_to = v_thread)
     AND r.kind = 'parent' AND r.guardian_id = ANY (v_actor.guardians) AND r.read_at IS NULL;

  SELECT jsonb_build_object(
    'id', t.id,
    'subject', t.subject,
    'child', jsonb_build_object('id', ch.id, 'first_name', COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name)),
    'center', jsonb_build_object('name', c.name, 'phone', c.phone),
    'messages', (
      SELECT jsonb_agg(jsonb_build_object(
               'id', m.id,
               'from', CASE WHEN m.author_kind = 'parent' AND m.guardian_id = ANY (v_actor.guardians) THEN 'You' ELSE m.sender_label END,
               'from_parent', m.author_kind = 'parent',
               'mine', m.author_kind = 'parent' AND m.guardian_id = ANY (v_actor.guardians),
               'body', m.body,
               'at', m.created_at,
               'to_me', mine.id IS NOT NULL,
               'acknowledged_at', mine.acknowledged_at,
               'seen_by_center', m.author_kind = 'parent' AND m.staff_seen_at IS NOT NULL)
             ORDER BY m.created_at)
        FROM parent_messages m
        LEFT JOIN LATERAL (SELECT r.id, max(r.acknowledged_at) OVER () AS acknowledged_at FROM parent_message_recipients r
                            WHERE r.message_id = m.id AND r.kind = 'parent' AND r.guardian_id = ANY (v_actor.guardians)
                            LIMIT 1) mine ON true
       WHERE m.id = t.id OR m.reply_to = t.id))
  INTO v_result
  FROM parent_messages t JOIN children ch ON ch.id = t.child_id JOIN centers c ON c.id = t.center_id
  WHERE t.id = v_thread;
  RETURN v_result;
END $$;

-- Tap Acknowledge on a message sent to this parent
CREATE OR REPLACE FUNCTION public.parent_portal_ack(p_token_hash text, p_link_hash text, p_message_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor record; v_thread uuid; v_count integer;
BEGIN
  SELECT * INTO v_actor FROM public.parent_actor(p_token_hash, CASE WHEN p_token_hash IS NULL THEN p_link_hash END);
  SELECT COALESCE(reply_to, id) INTO v_thread FROM parent_messages WHERE id = p_message_id;
  IF v_thread IS NULL OR NOT public.parent_thread_visible(v_actor.guardians, v_actor.only_thread, v_thread) THEN RETURN false; END IF;
  UPDATE parent_message_recipients
     SET acknowledged_at = COALESCE(acknowledged_at, now()), read_at = COALESCE(read_at, now())
   WHERE message_id = p_message_id AND kind = 'parent' AND guardian_id = ANY (v_actor.guardians);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END $$;

-- The center's owners and admins with an email, as copy recipients of a parent's message
CREATE OR REPLACE FUNCTION public.parent_message_copy_admins(p_message_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_center uuid; v_count integer;
BEGIN
  SELECT center_id INTO v_center FROM parent_messages WHERE id = p_message_id;
  INSERT INTO parent_message_recipients (message_id, center_id, kind, user_id, name, email)
  SELECT DISTINCT ON (lower(btrim(u.email))) p_message_id, v_center, 'staff', u.id,
         COALESCE(public.daily_person_label(u.id, v_center), 'Center admin'), lower(btrim(u.email))
    FROM center_admins a JOIN auth.users u ON u.id = a.user_id
   WHERE a.center_id = v_center AND a.role IN ('owner', 'admin') AND NULLIF(btrim(u.email), '') IS NOT NULL
   ORDER BY lower(btrim(u.email)), a.role DESC
  ON CONFLICT (message_id, email) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF NOT EXISTS (SELECT 1 FROM parent_message_recipients WHERE message_id = p_message_id) THEN
    UPDATE parent_messages SET status = 'sent', finished_at = now() WHERE id = p_message_id;
  END IF;
  RETURN v_count;
END $$;

-- A parent writes: a new conversation about one of their children (p_thread_id NULL; needs the PIN,
-- not an email link) or a reply in a conversation they are part of. Returns the message id (the same one when
-- the same Send is retried). The center's owners and admins are copied by email.
CREATE OR REPLACE FUNCTION public.parent_portal_post(
  p_token_hash text, p_link_hash text, p_child_id uuid, p_thread_id uuid, p_subject text, p_body text, p_client_key uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor record;
  v_child uuid := p_child_id;
  v_center uuid;
  v_subject text := NULLIF(btrim(regexp_replace(COALESCE(p_subject, ''), '[\r\n]+', ' ', 'g')), '');
  v_body text := NULLIF(btrim(COALESCE(p_body, '')), '');
  v_guardian child_guardians%ROWTYPE;
  v_id uuid;
  v_name text;
BEGIN
  IF p_client_key IS NULL THEN RAISE EXCEPTION 'Missing the message key.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_actor FROM public.parent_actor(p_token_hash, CASE WHEN p_token_hash IS NULL THEN p_link_hash END);
  IF v_actor.guardians IS NULL THEN RAISE EXCEPTION 'Please sign in again.' USING ERRCODE = '42501'; END IF;

  IF p_thread_id IS NOT NULL THEN
    IF NOT public.parent_thread_visible(v_actor.guardians, v_actor.only_thread, p_thread_id) THEN
      RAISE EXCEPTION 'This conversation is not available.' USING ERRCODE = '42501';
    END IF;
    SELECT child_id, 'Re: ' || regexp_replace(subject, '^(Re: )+', '') INTO v_child, v_subject FROM parent_messages WHERE id = p_thread_id;
    v_subject := left(v_subject, 120);
  ELSIF v_actor.only_thread IS NOT NULL OR p_token_hash IS NULL OR public.parent_session_child(p_token_hash, p_child_id) IS NULL THEN
    RAISE EXCEPTION 'Open the parent page with your PIN to start a new message.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_guardian FROM child_guardians
   WHERE id = ANY (v_actor.guardians) AND child_id = v_child ORDER BY is_primary DESC, created_at LIMIT 1;
  IF v_guardian.id IS NULL THEN RAISE EXCEPTION 'This conversation is not available.' USING ERRCODE = '42501'; END IF;
  v_center := v_guardian.center_id;

  SELECT id INTO v_id FROM parent_messages WHERE center_id = v_center AND client_key = p_client_key;
  IF FOUND THEN RETURN v_id; END IF;

  IF v_body IS NULL OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'Write your message (up to 2,000 characters).' USING ERRCODE = '22023';
  END IF;
  IF v_subject IS NOT NULL AND char_length(v_subject) > 120 THEN
    RAISE EXCEPTION 'Keep the subject to 120 characters.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM parent_messages WHERE author_kind = 'parent' AND guardian_id = ANY (v_actor.guardians)
       AND created_at > now() - interval '1 hour') >= 20 THEN
    RAISE EXCEPTION 'That is a lot of messages in one hour. Please wait a little, or call the center.' USING ERRCODE = '54000';
  END IF;

  SELECT COALESCE(NULLIF(btrim(preferred_name), ''), first_name) INTO v_name FROM children WHERE id = v_child;
  INSERT INTO parent_messages (center_id, child_id, subject, body, channel, author_kind, guardian_id, sender_label, client_key, reply_to)
  VALUES (v_center, v_child, COALESCE(v_subject, 'A note about ' || v_name), v_body, 'portal', 'parent', v_guardian.id,
          left(v_guardian.name, 120), p_client_key, p_thread_id)
  RETURNING id INTO v_id;
  PERFORM public.parent_message_copy_admins(v_id);
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.parent_thread_contacts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_actor(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_thread_visible(uuid[], uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_portal_threads(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_portal_thread(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_portal_ack(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_message_copy_admins(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_portal_post(text, text, uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_portal_threads(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_portal_thread(text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_portal_ack(text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_portal_post(text, text, uuid, uuid, text, text, uuid) TO service_role;

-- 4. Roster (owners, admins, regular teachers) ------------------------------------------------------------------

-- A child's conversations for the child card, newest activity first, each with its messages (oldest first)
-- and, per message, who it went to and whether they got it, opened it and acknowledged it. No email addresses.
CREATE OR REPLACE FUNCTION public.parent_threads_for_child(p_center_id uuid, p_child_id uuid, p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.parent_message_check(p_center_id, p_child_id);
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.last_at DESC) FROM (
      SELECT t.id, t.subject,
             (SELECT max(m.created_at) FROM parent_messages m WHERE m.id = t.id OR m.reply_to = t.id) AS last_at,
             (SELECT count(*) FROM parent_messages m WHERE (m.id = t.id OR m.reply_to = t.id)
                 AND m.author_kind = 'parent' AND m.staff_seen_at IS NULL) AS unread,
             EXISTS (SELECT 1 FROM public.parent_thread_contacts(t.id) c
                       JOIN child_guardians g ON g.id = c
                      WHERE g.can_message AND NULLIF(btrim(g.email), '') IS NOT NULL) AS can_reply,
             (SELECT jsonb_agg(jsonb_build_object(
                       'id', m.id, 'author_kind', m.author_kind, 'sender_label', m.sender_label, 'body', m.body,
                       'status', m.status, 'created_at', m.created_at, 'seen_at', m.staff_seen_at,
                       'recipients', COALESCE((
                         SELECT jsonb_agg(jsonb_build_object('name', r.name, 'kind', r.kind, 'status', r.status,
                                  'read', r.read_at IS NOT NULL, 'acknowledged', r.acknowledged_at IS NOT NULL) ORDER BY r.kind, r.name)
                           FROM parent_message_recipients r WHERE r.message_id = m.id), '[]'::jsonb))
                     ORDER BY m.created_at)
                FROM parent_messages m WHERE m.id = t.id OR m.reply_to = t.id) AS messages
        FROM parent_messages t
       WHERE t.center_id = p_center_id AND t.child_id = p_child_id AND t.reply_to IS NULL
       ORDER BY 3 DESC
       LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))) x), '[]'::jsonb);
END $$;

-- Staff reply in a conversation: goes to the parents in it who can still get messages. Returns the message id.
CREATE OR REPLACE FUNCTION public.parent_message_reply(p_center_id uuid, p_thread_id uuid, p_body text, p_client_key uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_thread parent_messages%ROWTYPE; v_body text := NULLIF(btrim(COALESCE(p_body, '')), ''); v_id uuid;
BEGIN
  IF p_client_key IS NULL THEN RAISE EXCEPTION 'Missing the message key.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_thread FROM parent_messages WHERE id = p_thread_id AND center_id = p_center_id AND reply_to IS NULL;
  IF v_thread.id IS NULL THEN RAISE EXCEPTION 'Conversation not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.parent_message_check(p_center_id, v_thread.child_id);
  SELECT id INTO v_id FROM parent_messages WHERE center_id = p_center_id AND client_key = p_client_key;
  IF FOUND THEN RETURN v_id; END IF;
  IF v_body IS NULL OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'Write the message (up to 2,000 characters).' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM parent_messages WHERE center_id = p_center_id AND sent_by = auth.uid()
      AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'That is a lot of messages in one hour. Wait a little and try again.' USING ERRCODE = '54000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.parent_thread_contacts(p_thread_id) c JOIN child_guardians g ON g.id = c
                  WHERE g.can_message AND NULLIF(btrim(g.email), '') IS NOT NULL) THEN
    RAISE EXCEPTION 'No one in this conversation can get messages anymore.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO parent_messages (center_id, child_id, subject, body, sent_by, sender_label, client_key, reply_to)
  VALUES (p_center_id, v_thread.child_id, left('Re: ' || regexp_replace(v_thread.subject, '^(Re: )+', ''), 120), v_body,
          auth.uid(), COALESCE(public.daily_person_label(auth.uid(), p_center_id), 'Staff'), p_client_key, p_thread_id)
  RETURNING id INTO v_id;

  INSERT INTO parent_message_recipients (message_id, center_id, guardian_id, name, email)
  SELECT DISTINCT ON (lower(btrim(g.email))) v_id, p_center_id, g.id, g.name, lower(btrim(g.email))
    FROM public.parent_thread_contacts(p_thread_id) c JOIN child_guardians g ON g.id = c
   WHERE g.can_message AND g.child_id = v_thread.child_id AND NULLIF(btrim(g.email), '') IS NOT NULL
   ORDER BY lower(btrim(g.email)), g.is_primary DESC, g.name;

  -- Replying means someone on the roster has read the parent's messages
  UPDATE parent_messages SET staff_seen_at = now(), staff_seen_by = auth.uid()
   WHERE (id = p_thread_id OR reply_to = p_thread_id) AND author_kind = 'parent' AND staff_seen_at IS NULL;
  RETURN v_id;
END $$;

-- Someone on the roster opened a conversation: the parent's messages in it are no longer unread
CREATE OR REPLACE FUNCTION public.parent_message_mark_seen(p_center_id uuid, p_thread_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_child uuid;
BEGIN
  SELECT child_id INTO v_child FROM parent_messages WHERE id = p_thread_id AND center_id = p_center_id AND reply_to IS NULL;
  IF v_child IS NULL THEN RETURN; END IF;
  PERFORM public.parent_message_check(p_center_id, v_child);
  UPDATE parent_messages SET staff_seen_at = now(), staff_seen_by = auth.uid()
   WHERE (id = p_thread_id OR reply_to = p_thread_id) AND author_kind = 'parent' AND staff_seen_at IS NULL;
END $$;

-- The roster's unread dots: enrolled children with parent messages nobody on the roster has opened yet
CREATE OR REPLACE FUNCTION public.parent_messages_unread(p_center_id uuid)
RETURNS TABLE (child_id uuid, unread integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.can_use_roster(p_center_id) THEN RETURN; END IF;
  RETURN QUERY
  SELECT m.child_id, count(*)::integer
    FROM parent_messages m JOIN children ch ON ch.id = m.child_id
   WHERE m.center_id = p_center_id AND m.author_kind = 'parent' AND m.staff_seen_at IS NULL
     AND ch.status = 'enrolled' AND m.created_at > now() - interval '60 days'
   GROUP BY m.child_id;
END $$;

REVOKE ALL ON FUNCTION public.parent_threads_for_child(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parent_message_reply(uuid, uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parent_message_mark_seen(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parent_messages_unread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_threads_for_child(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_message_reply(uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_message_mark_seen(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_messages_unread(uuid) TO authenticated;

-- 5. The sender (service role only) ------------------------------------------------------------------------------

-- Claim now also says who a recipient is ('parent' or 'staff'), so the email can be written for them
DROP FUNCTION IF EXISTS public.parent_message_claim(uuid, integer);
CREATE FUNCTION public.parent_message_claim(p_message_id uuid DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (recipient_id uuid, message_id uuid, name text, email text, kind text)
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
  RETURNING r.id, r.message_id, r.name, r.email, r.kind;
END $$;
REVOKE ALL ON FUNCTION public.parent_message_claim(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_message_claim(uuid, integer) TO service_role;

-- What an email holds: now also who wrote it, the conversation and whether parent page links can be sent
CREATE OR REPLACE FUNCTION public.parent_message_data(p_message_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', m.id, 'subject', m.subject, 'body', m.body, 'sender_label', m.sender_label, 'created_at', m.created_at,
    'author_kind', m.author_kind, 'thread_id', COALESCE(m.reply_to, m.id), 'is_reply', m.reply_to IS NOT NULL,
    'child', jsonb_build_object('first_name', COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name)),
    'center', jsonb_build_object('name', c.name, 'email', NULLIF(btrim(c.email), ''), 'phone', c.phone, 'domain_key', c.domain_key,
                                 'parent_portal', c.parent_portal_enabled AND c.is_active))
  FROM parent_messages m JOIN children ch ON ch.id = m.child_id JOIN centers c ON c.id = m.center_id
  WHERE m.id = p_message_id;
$$;

-- A parent page link for one parent recipient (a new token on every send attempt). false = no link to send.
CREATE OR REPLACE FUNCTION public.parent_message_link_create(p_recipient_id uuid, p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM parent_message_recipients r JOIN parent_messages m ON m.id = r.message_id
                   JOIN centers c ON c.id = m.center_id
                  WHERE r.id = p_recipient_id AND r.kind = 'parent' AND r.guardian_id IS NOT NULL
                    AND c.parent_portal_enabled AND c.is_active) THEN
    RETURN false;
  END IF;
  INSERT INTO parent_message_links (recipient_id, token_hash, expires_at)
  VALUES (p_recipient_id, p_token_hash, now() + interval '30 days')
  ON CONFLICT (recipient_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now(), expires_at = EXCLUDED.expires_at;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.parent_message_link_create(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_message_link_create(uuid, text) TO service_role;

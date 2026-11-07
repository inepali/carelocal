-- Rollback for 20261229000000_parent_message_threads.sql
-- Parent-written messages and replies are deleted (a conversation's replies go with it); teacher messages stay.
DROP FUNCTION IF EXISTS public.parent_message_link_create(uuid, text);
DROP FUNCTION IF EXISTS public.parent_messages_unread(uuid);
DROP FUNCTION IF EXISTS public.parent_message_mark_seen(uuid, uuid);
DROP FUNCTION IF EXISTS public.parent_message_reply(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.parent_threads_for_child(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.parent_portal_post(text, text, uuid, uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.parent_message_copy_admins(uuid);
DROP FUNCTION IF EXISTS public.parent_portal_ack(text, text, uuid);
DROP FUNCTION IF EXISTS public.parent_portal_thread(text, text, uuid);
DROP FUNCTION IF EXISTS public.parent_portal_threads(text, uuid);
DROP FUNCTION IF EXISTS public.parent_thread_visible(uuid[], uuid, uuid);
DROP FUNCTION IF EXISTS public.parent_actor(text, text);
DROP FUNCTION IF EXISTS public.parent_thread_contacts(uuid);
DROP TABLE IF EXISTS public.parent_message_links;

DELETE FROM public.parent_messages WHERE author_kind = 'parent' OR reply_to IS NOT NULL;
DELETE FROM public.parent_message_recipients WHERE kind = 'staff';

-- The sender as it was
DROP FUNCTION IF EXISTS public.parent_message_claim(uuid, integer);
CREATE FUNCTION public.parent_message_claim(p_message_id uuid DEFAULT NULL, p_limit integer DEFAULT 50)
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
REVOKE ALL ON FUNCTION public.parent_message_claim(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_message_claim(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.parent_message_data(p_message_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', m.id, 'subject', m.subject, 'body', m.body, 'sender_label', m.sender_label, 'created_at', m.created_at,
    'child', jsonb_build_object('first_name', COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name)),
    'center', jsonb_build_object('name', c.name, 'email', NULLIF(btrim(c.email), ''), 'phone', c.phone, 'domain_key', c.domain_key))
  FROM parent_messages m JOIN children ch ON ch.id = m.child_id JOIN centers c ON c.id = m.center_id
  WHERE m.id = p_message_id;
$$;

DROP INDEX IF EXISTS public.parent_message_recipients_guardian_idx;
ALTER TABLE public.parent_message_recipients DROP CONSTRAINT IF EXISTS parent_message_recipients_kind_check;
ALTER TABLE public.parent_message_recipients DROP COLUMN IF EXISTS acknowledged_at;
ALTER TABLE public.parent_message_recipients DROP COLUMN IF EXISTS read_at;
ALTER TABLE public.parent_message_recipients DROP COLUMN IF EXISTS user_id;
ALTER TABLE public.parent_message_recipients DROP COLUMN IF EXISTS kind;

DROP INDEX IF EXISTS public.parent_messages_unseen_idx;
DROP INDEX IF EXISTS public.parent_messages_reply_to_idx;
ALTER TABLE public.parent_messages DROP CONSTRAINT IF EXISTS parent_messages_channel_check;
ALTER TABLE public.parent_messages ADD CONSTRAINT parent_messages_channel_check CHECK (channel IN ('email'));
ALTER TABLE public.parent_messages DROP CONSTRAINT IF EXISTS parent_messages_author_kind_check;
ALTER TABLE public.parent_messages DROP COLUMN IF EXISTS staff_seen_by;
ALTER TABLE public.parent_messages DROP COLUMN IF EXISTS staff_seen_at;
ALTER TABLE public.parent_messages DROP COLUMN IF EXISTS guardian_id;
ALTER TABLE public.parent_messages DROP COLUMN IF EXISTS author_kind;
ALTER TABLE public.parent_messages DROP COLUMN IF EXISTS reply_to;

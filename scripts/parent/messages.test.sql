-- Database tests for parent message conversations (20261229000000_parent_message_threads.sql), run on a
-- throwaway local Postgres, never a Supabase project:
--   createdb pm && psql -d pm -f scripts/parent/portal-stub.sql \
--     -f supabase/migrations/20261225000000_parent_messages.sql \
--     -f supabase/migrations/20261228000000_parent_portal.sql \
--     -f supabase/migrations/20261229000000_parent_message_threads.sql -f scripts/parent/messages.test.sql
-- It prints ALL PASSED or stops at the first failed check.
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.as_user(u text, super boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(u, ''), false),
         set_config('request.jwt.claims', json_build_object('app_metadata', json_build_object('is_super_admin', super))::text, false); $$;
CREATE FUNCTION pg_temp.h(t text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(t::bytea), 'hex') $$;

INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000000000a', 'Owner@A.com'),
                                          ('00000000-0000-0000-0000-00000000000c', 'admin2@a.com'),
                                          ('00000000-0000-0000-0000-00000000000b', 'owner@b.com');
INSERT INTO centers (id, name, parent_portal_enabled) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A', true),
                                                             ('10000000-0000-0000-0000-000000000002', 'Center B', true);
INSERT INTO center_admins VALUES ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'owner'),
                                 ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', 'admin'),
                                 ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000002', 'owner');
INSERT INTO children (id, center_id, first_name) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Maya'),
  ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'B kid');
INSERT INTO child_guardians (id, center_id, child_id, name, email, is_primary) VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Mom', 'mom@x.com', true),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Dad', 'dad@x.com', false),
  ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000009', 'B parent', 'b@x.com', false);

-- Codes for Mom, Dad and the center B parent
SET ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
SELECT parent_access_issue('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', pg_temp.h('mom'), 'MOM1');
SELECT parent_access_issue('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', pg_temp.h('dad'), 'DAD1');
-- 1. A teacher writes to Mom and Dad
SELECT parent_message_create('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  ARRAY['30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003']::uuid[], 'Supplies', 'Diapers please', gen_random_uuid());
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
SELECT parent_access_issue('10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000009', pg_temp.h('bpar'), 'BPAR');
RESET ROLE;
SELECT pg_temp.as_user(NULL);
CREATE TEMP TABLE t AS SELECT id AS thread FROM parent_messages WHERE reply_to IS NULL;
GRANT SELECT ON t TO service_role, authenticated;

SET ROLE service_role;
DO $$ DECLARE th uuid := (SELECT thread FROM t); l jsonb; x jsonb; BEGIN
  PERFORM parent_login(pg_temp.h('mom'), 'ip', pg_temp.h('tok-mom'));
  PERFORM parent_login(pg_temp.h('dad'), 'ip', pg_temp.h('tok-dad'));
  PERFORM parent_login(pg_temp.h('bpar'), 'ip', pg_temp.h('tok-b'));
  -- 2. Mom's list: one unread conversation waiting for her acknowledgement
  l := parent_portal_threads(pg_temp.h('tok-mom'), '20000000-0000-0000-0000-000000000001');
  ASSERT jsonb_array_length(l) = 1 AND (l -> 0 ->> 'unread')::int = 1 AND (l -> 0 ->> 'needs_ack')::boolean, l::text;
  -- 3. Opening it marks it read
  x := parent_portal_thread(pg_temp.h('tok-mom'), NULL, th);
  ASSERT jsonb_array_length(x -> 'messages') = 1 AND (x #>> '{messages,0,to_me}')::boolean, x::text;
  ASSERT (parent_portal_threads(pg_temp.h('tok-mom'), '20000000-0000-0000-0000-000000000001') -> 0 ->> 'unread')::int = 0;
  -- 4. Acknowledge
  ASSERT parent_portal_ack(pg_temp.h('tok-mom'), NULL, th);
  ASSERT NOT (parent_portal_threads(pg_temp.h('tok-mom'), '20000000-0000-0000-0000-000000000001') -> 0 ->> 'needs_ack')::boolean;
  ASSERT NOT parent_portal_ack(pg_temp.h('tok-b'), NULL, th), 'center B parent acknowledged';
  -- 5. Mom replies; the owner and the admin are copied
  PERFORM parent_portal_post(pg_temp.h('tok-mom'), NULL, NULL, th, NULL, 'Will bring them', gen_random_uuid());
  ASSERT (SELECT count(*) FROM parent_message_recipients r JOIN parent_messages m ON m.id = r.message_id
           WHERE m.reply_to = th AND r.kind = 'staff') = 2, 'admins not copied';
  ASSERT (SELECT subject FROM parent_messages WHERE reply_to = th) = 'Re: Supplies';
  -- 6. Dad is in the conversation, so he sees Mom's reply; the center B parent sees nothing
  x := parent_portal_thread(pg_temp.h('tok-dad'), NULL, th);
  ASSERT jsonb_array_length(x -> 'messages') = 2 AND x #>> '{messages,1,from}' = 'Mom', x::text;
  ASSERT parent_portal_thread(pg_temp.h('tok-b'), NULL, th) IS NULL, 'center B parent read it';
  ASSERT parent_portal_thread(NULL, NULL, th) IS NULL;
  BEGIN PERFORM parent_portal_post(pg_temp.h('tok-b'), NULL, NULL, th, NULL, 'hi', gen_random_uuid());
    RAISE EXCEPTION 'center B parent replied'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- 7. The roster: Maya has 1 unread; opening the conversation clears it
SET ROLE authenticated; SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
DO $$ DECLARE th uuid := (SELECT thread FROM t); x jsonb; BEGIN
  ASSERT (SELECT unread FROM parent_messages_unread('10000000-0000-0000-0000-000000000001')) = 1;
  x := parent_threads_for_child('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
  ASSERT jsonb_array_length(x) = 1 AND jsonb_array_length(x -> 0 -> 'messages') = 2 AND (x -> 0 ->> 'unread')::int = 1, x::text;
  ASSERT x #> '{0,messages,0,recipients}' @> '[{"name":"Mom","read":true,"acknowledged":true},{"name":"Dad","read":true,"acknowledged":false}]', x::text;
  PERFORM parent_message_mark_seen('10000000-0000-0000-0000-000000000001', th);
  ASSERT NOT EXISTS (SELECT 1 FROM parent_messages_unread('10000000-0000-0000-0000-000000000001'));
  -- 8. Staff reply goes to Mom and Dad
  PERFORM parent_message_reply('10000000-0000-0000-0000-000000000001', th, 'Thank you!', gen_random_uuid());
END $$;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
DO $$ BEGIN
  BEGIN PERFORM parent_message_reply('10000000-0000-0000-0000-000000000001', (SELECT thread FROM t), 'x', gen_random_uuid());
    RAISE EXCEPTION 'center B owner replied'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM parent_threads_for_child('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'center B owner read threads'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE; SELECT pg_temp.as_user(NULL);
DO $$ BEGIN
  ASSERT (SELECT array_agg(r.name ORDER BY r.name) FROM parent_message_recipients r JOIN parent_messages m ON m.id = r.message_id
           WHERE m.author_kind = 'staff' AND m.reply_to IS NOT NULL) = ARRAY['Dad', 'Mom'];
END $$;

-- 9. Email links: open only their conversation; can reply; cannot start a new one
SET ROLE service_role;
DO $$ DECLARE th uuid := (SELECT thread FROM t); rid uuid; c record; BEGIN
  SELECT r.id INTO rid FROM parent_message_recipients r JOIN parent_messages m ON m.id = r.message_id
   WHERE m.author_kind = 'staff' AND m.reply_to IS NOT NULL AND r.name = 'Mom';
  ASSERT parent_message_link_create(rid, pg_temp.h('link-mom'));
  ASSERT jsonb_array_length(parent_portal_thread(NULL, pg_temp.h('link-mom')) -> 'messages') = 3;
  ASSERT parent_portal_ack(NULL, pg_temp.h('link-mom'), (SELECT id FROM parent_messages WHERE author_kind = 'staff' AND reply_to = th));
  PERFORM parent_portal_post(NULL, pg_temp.h('link-mom'), NULL, th, NULL, 'See you', gen_random_uuid());
  BEGIN PERFORM parent_portal_post(NULL, pg_temp.h('link-mom'), '20000000-0000-0000-0000-000000000001', NULL, 'New', 'x', gen_random_uuid());
    RAISE EXCEPTION 'link started a conversation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT parent_portal_threads(NULL, '20000000-0000-0000-0000-000000000001') IS NULL;
  -- 10. Mom starts a conversation with her code: Dad is not in it
  PERFORM parent_portal_post(pg_temp.h('tok-mom'), NULL, '20000000-0000-0000-0000-000000000001', NULL, 'Pick-up today', 'Grandma picks up', gen_random_uuid());
  ASSERT jsonb_array_length(parent_portal_threads(pg_temp.h('tok-mom'), '20000000-0000-0000-0000-000000000001')) = 2;
  ASSERT jsonb_array_length(parent_portal_threads(pg_temp.h('tok-dad'), '20000000-0000-0000-0000-000000000001')) = 1, 'dad saw mom''s own conversation';
  -- The same Send twice is one message
  PERFORM parent_portal_post(pg_temp.h('tok-mom'), NULL, '20000000-0000-0000-0000-000000000001', NULL, 'Dup', 'once', '40000000-0000-0000-0000-000000000001');
  PERFORM parent_portal_post(pg_temp.h('tok-mom'), NULL, '20000000-0000-0000-0000-000000000001', NULL, 'Dup', 'once', '40000000-0000-0000-0000-000000000001');
  ASSERT (SELECT count(*) FROM parent_messages WHERE subject = 'Dup') = 1;
  -- 11. The sender sees who each recipient is
  SELECT * INTO c FROM parent_message_claim(NULL, 200) WHERE kind = 'staff' LIMIT 1;
  ASSERT c.kind = 'staff' AND c.email IN ('owner@a.com', 'admin2@a.com'), c::text;
  ASSERT (parent_message_data(c.message_id) ->> 'author_kind') = 'parent';
  -- 12. Expired link, portal off
  UPDATE parent_message_links SET expires_at = now() - interval '1 minute';
  ASSERT parent_portal_thread(NULL, pg_temp.h('link-mom')) IS NULL, 'expired link worked';
END $$;
RESET ROLE;
-- 13. Dad turned off for messages: out of his conversations, and staff replies skip him
UPDATE child_guardians SET can_message = false WHERE id = '30000000-0000-0000-0000-000000000003';
SET ROLE service_role;
DO $$ BEGIN ASSERT parent_portal_threads(pg_temp.h('tok-dad'), '20000000-0000-0000-0000-000000000001') IS NULL; END $$;
RESET ROLE;
SET ROLE authenticated; SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
SELECT parent_message_reply('10000000-0000-0000-0000-000000000001', (SELECT thread FROM t), 'Second reply', '50000000-0000-0000-0000-000000000001');
RESET ROLE; SELECT pg_temp.as_user(NULL);
DO $$ BEGIN
  ASSERT (SELECT array_agg(r.name) FROM parent_message_recipients r WHERE r.message_id =
           (SELECT id FROM parent_messages WHERE client_key = '50000000-0000-0000-0000-000000000001')) = ARRAY['Mom'];
END $$;
UPDATE centers SET parent_portal_enabled = false WHERE id = '10000000-0000-0000-0000-000000000001';
SET ROLE service_role;
DO $$ BEGIN ASSERT parent_portal_threads(pg_temp.h('tok-mom'), '20000000-0000-0000-0000-000000000001') IS NULL, 'portal off'; END $$;
RESET ROLE;
SELECT 'ALL PASSED';

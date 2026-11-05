-- Rollback for 20261225000000_parent_messages.sql. Deletes every parent message and its delivery history.
DROP FUNCTION IF EXISTS public.parent_message_recipient_finish(uuid, boolean, text, text);
DROP FUNCTION IF EXISTS public.parent_message_data(uuid);
DROP FUNCTION IF EXISTS public.parent_message_claim(uuid, integer);
DROP FUNCTION IF EXISTS public.parent_message_refresh(uuid);
DROP FUNCTION IF EXISTS public.parent_messages_for_child(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.parent_message_create(uuid, uuid, uuid[], text, text, uuid);
DROP FUNCTION IF EXISTS public.parent_message_contacts(uuid, uuid);
DROP FUNCTION IF EXISTS public.parent_message_check(uuid, uuid);
DROP TABLE IF EXISTS public.parent_message_recipients;
DROP TABLE IF EXISTS public.parent_messages;
ALTER TABLE public.child_guardians DROP COLUMN IF EXISTS can_message;

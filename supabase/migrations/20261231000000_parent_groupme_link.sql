-- The center's "all parents" GroupMe group: an invite link the owner or admin pastes on Center Profile → GroupMe
-- Notification. Parents see it on the parent page (Notices tab and footer) so they can join.
--
-- Kept on centers, not center_groupme: that row is the staff shift-alert bot (a secret, deleted on disconnect),
-- while this is a plain invite link the center chooses to share with families. Only GroupMe invite links are
-- accepted. Written by the server (service role) after checking the caller is an owner or admin.
-- Rollback: supabase/rollbacks/20261231000000_parent_groupme_link.down.sql

ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS parent_groupme_url text;

ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_parent_groupme_url_check;
ALTER TABLE public.centers ADD CONSTRAINT centers_parent_groupme_url_check CHECK (
  parent_groupme_url IS NULL
  OR (char_length(parent_groupme_url) <= 200
      AND parent_groupme_url ~ '^https://(www\.|web\.)?groupme\.com/join_group/[0-9]+/[A-Za-z0-9_-]+$')
);

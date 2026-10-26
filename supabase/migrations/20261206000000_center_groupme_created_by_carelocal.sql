-- A center admin can have CareLocal create the GroupMe group and bot for them, under CareLocal's own GroupMe
-- account. The invite link is what the center gives its staff to join the group (it is not a secret the way the
-- bot id is, but the table stays server-only like the rest of center_groupme).
-- carelocal_owned marks bots CareLocal's token created, so disconnecting can remove them (GroupMe only lets a
-- bot's creator delete it).
ALTER TABLE public.center_groupme
  ADD COLUMN IF NOT EXISTS share_url text,
  ADD COLUMN IF NOT EXISTS carelocal_owned boolean NOT NULL DEFAULT false;

ALTER TABLE public.center_groupme DROP CONSTRAINT IF EXISTS center_groupme_share_url_check;
ALTER TABLE public.center_groupme ADD CONSTRAINT center_groupme_share_url_check
  CHECK (share_url IS NULL OR (share_url ~ '^https://' AND char_length(share_url) <= 300));

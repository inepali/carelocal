-- GroupMe shift alerts: each center can connect one GroupMe group. When a shift is posted, a bot the center
-- created in that group ("<Center Name>_Notification") posts it there.
--
-- Anyone holding a bot_id can post into that group, so it is a secret: the table has RLS on and NO policies,
-- and app roles have no grants. Only the server (service role) reads or writes it, after checking the caller is
-- an owner or admin of the center. The GroupMe access token used to create the bot is never stored.

CREATE TABLE IF NOT EXISTS public.center_groupme (
  center_id      uuid PRIMARY KEY REFERENCES public.centers(id) ON DELETE CASCADE,
  bot_id         text NOT NULL CHECK (bot_id ~ '^[A-Za-z0-9]{10,64}$'),
  bot_name       text CHECK (bot_name IS NULL OR char_length(bot_name) <= 120),
  group_id       text CHECK (group_id IS NULL OR char_length(group_id) <= 64),
  group_name     text CHECK (group_name IS NULL OR char_length(group_name) <= 200),
  enabled        boolean NOT NULL DEFAULT true,
  connected_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at   timestamptz NOT NULL DEFAULT now(),
  last_posted_at timestamptz,
  last_error     text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  last_error_at  timestamptz
);

ALTER TABLE public.center_groupme ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.center_groupme FROM PUBLIC, anon, authenticated;

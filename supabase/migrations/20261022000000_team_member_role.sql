-- Team members (About → Team) get a Role from Manage Data → Roles (center_lookups 'Role'),
-- which replaces the free-text title in the form (title is kept for existing rows).
ALTER TABLE public.center_team_members ADD COLUMN IF NOT EXISTS role text;

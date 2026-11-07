-- Rollback for 20261228000000_parent_portal.sql
DROP FUNCTION IF EXISTS public.parent_access_email_data(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.parent_access_revoke(uuid, uuid);
DROP FUNCTION IF EXISTS public.parent_access_issue(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.parent_access_status(uuid, uuid);
DROP FUNCTION IF EXISTS public.parent_access_check(uuid);
DROP FUNCTION IF EXISTS public.parent_portal_photos(text, uuid, timestamptz, integer);
DROP FUNCTION IF EXISTS public.parent_portal_day(text, uuid, date);
DROP FUNCTION IF EXISTS public.parent_portal_home(text);
DROP FUNCTION IF EXISTS public.parent_logout(text);
DROP FUNCTION IF EXISTS public.parent_session_child(text, uuid);
DROP FUNCTION IF EXISTS public.parent_session_access(text);
DROP FUNCTION IF EXISTS public.parent_login(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.parent_center(text);

DROP TABLE IF EXISTS public.parent_login_attempts;
DROP TABLE IF EXISTS public.parent_sessions;

DROP TRIGGER IF EXISTS trg_guard_guardian_parent_access ON public.child_guardians;
DROP FUNCTION IF EXISTS public.guard_guardian_parent_access();
DROP INDEX IF EXISTS public.child_guardians_parent_access_idx;
ALTER TABLE public.child_guardians DROP COLUMN IF EXISTS parent_access_id;
DROP TABLE IF EXISTS public.parent_access;

DROP TRIGGER IF EXISTS trg_guard_parent_portal_flag ON public.centers;
DROP FUNCTION IF EXISTS public.guard_parent_portal_flag();
ALTER TABLE public.centers DROP COLUMN IF EXISTS parent_portal_enabled;
DROP INDEX IF EXISTS public.centers_parent_portal_key_idx;
ALTER TABLE public.centers DROP COLUMN IF EXISTS parent_portal_key;
DROP FUNCTION IF EXISTS public.parent_portal_new_key();

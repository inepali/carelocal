-- Lock each account to the vertical (childcare / healthcare) it signed up on.
-- The vertical lives on staff_profiles.domain_key / centers.domain_key; mirror it into
-- auth.users.raw_app_meta_data.domain_key so the app can check it on every request
-- without extra queries. app_metadata is not user-editable, so it is safe to trust.

CREATE OR REPLACE FUNCTION public.set_user_domain_key(p_user_id uuid, p_domain_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('domain_key', p_domain_key)
  WHERE id = p_user_id
    AND p_domain_key IS NOT NULL
    -- First vertical wins: never move an existing account to another vertical.
    AND (raw_app_meta_data ->> 'domain_key') IS NULL;
$$;

REVOKE ALL ON FUNCTION public.set_user_domain_key(uuid, text) FROM PUBLIC, anon, authenticated;

-- Staff profiles carry their own domain_key.
CREATE OR REPLACE FUNCTION public.sync_staff_profile_domain_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.set_user_domain_key(NEW.user_id, NEW.domain_key);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_profiles_sync_domain_key ON public.staff_profiles;
CREATE TRIGGER staff_profiles_sync_domain_key
  AFTER INSERT ON public.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_staff_profile_domain_key();

-- Center admins inherit the domain_key of the center they administer.
CREATE OR REPLACE FUNCTION public.sync_center_admin_domain_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.set_user_domain_key(
    NEW.user_id,
    (SELECT domain_key FROM public.centers WHERE id = NEW.center_id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS center_admins_sync_domain_key ON public.center_admins;
CREATE TRIGGER center_admins_sync_domain_key
  AFTER INSERT ON public.center_admins
  FOR EACH ROW EXECUTE FUNCTION public.sync_center_admin_domain_key();

-- Backfill existing accounts. Center admin role takes precedence over a staff profile.
SELECT public.set_user_domain_key(ca.user_id, c.domain_key)
FROM public.center_admins ca
JOIN public.centers c ON c.id = ca.center_id;

SELECT public.set_user_domain_key(sp.user_id, sp.domain_key)
FROM public.staff_profiles sp
WHERE sp.user_id IS NOT NULL;

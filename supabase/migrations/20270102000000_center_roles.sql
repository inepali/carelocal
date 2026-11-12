-- ============================================================
-- Center roles: Owner, Director, Assistant Director and other roles
--  * Every employee can hold one role at their center: center_staff.center_role.
--      owner               -> center_admins 'owner'  (set only by a super admin; a center can have several)
--      director            -> center_admins 'admin'  (set by an owner)
--      assistant_director  -> center_admins 'admin'  (set by an owner)
--      anything else       -> a title from the center's Role list (Teacher, Cook, ...), no dashboard access
--  * Access still comes only from center_admins, never from the title. center_role is kept in step with it
--    here and can only be changed through set_center_role() (or by the service role).
--  * Directors can give and change the plain roles (Teacher, Cook, ...) of non-leadership staff.
--  * Closes a hole: any signed-in user could insert a center_admins row for ANY center and make themselves
--    its owner. Self-insert is now only for claiming a brand-new center during registration.
-- ============================================================

-- 1. Column ----------------------------------------------------------------------
ALTER TABLE public.center_staff ADD COLUMN IF NOT EXISTS center_role text;

ALTER TABLE public.center_staff DROP CONSTRAINT IF EXISTS center_staff_center_role_format;
ALTER TABLE public.center_staff ADD CONSTRAINT center_staff_center_role_format
  CHECK (center_role IS NULL OR center_role ~ '^[a-z0-9_]{1,50}$');

-- Backfill from today's access grants
UPDATE public.center_staff cs
SET center_role = CASE ca.role WHEN 'owner' THEN 'owner' ELSE 'director' END
FROM public.staff_profiles sp, public.center_admins ca
WHERE sp.id = cs.staff_id AND ca.user_id = sp.user_id AND ca.center_id = cs.center_id
  AND ca.role IN ('owner', 'admin') AND cs.center_role IS NULL;

-- 2. Only set_center_role() (or the service role) may change center_role --------------
CREATE OR REPLACE FUNCTION public.guard_center_staff_role()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR current_setting('carelocal.center_role_rpc', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.center_role := NULL;
  ELSIF NEW.center_role IS DISTINCT FROM OLD.center_role THEN
    NEW.center_role := OLD.center_role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_center_staff_role ON public.center_staff;
CREATE TRIGGER trg_guard_center_staff_role
  BEFORE INSERT OR UPDATE OF center_role ON public.center_staff
  FOR EACH ROW EXECUTE FUNCTION public.guard_center_staff_role();

-- 3. The one way to set a role ---------------------------------------------------------
-- p_role: 'owner' | 'director' | 'assistant_director' | a Role list value | NULL (no role)
CREATE OR REPLACE FUNCTION public.set_center_role(p_center_id uuid, p_staff_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := NULLIF(lower(btrim(p_role)), '');
  v_caller uuid := auth.uid();
  v_super boolean := v_caller IS NULL   -- service role (super admin server actions)
    OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false);
  v_caller_role text;
  v_user_id uuid;
  v_class text;
  v_status text;
  v_current text;
  v_access text;
  v_new_access text;
BEGIN
  IF v_role IS NOT NULL AND v_role !~ '^[a-z0-9_]{1,50}$' THEN
    RAISE EXCEPTION 'That role name is not valid' USING ERRCODE = 'check_violation';
  END IF;

  SELECT sp.user_id, cs.employment_class, cs.status::text, cs.center_role
    INTO v_user_id, v_class, v_status, v_current
  FROM center_staff cs
  JOIN staff_profiles sp ON sp.id = cs.staff_id
  WHERE cs.center_id = p_center_id AND cs.staff_id = p_staff_id;

  IF v_user_id IS NULL OR v_status = 'removed' THEN
    RAISE EXCEPTION 'This person is not an employee of the center' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT role INTO v_access FROM center_admins WHERE center_id = p_center_id AND user_id = v_user_id;
  IF v_access = 'owner' THEN v_current := 'owner'; END IF;   -- access wins over a stale title

  -- Who may do this
  IF NOT v_super THEN
    SELECT role INTO v_caller_role FROM center_admins WHERE center_id = p_center_id AND user_id = v_caller;
    IF v_caller_role IS NULL THEN
      RAISE EXCEPTION 'Only the center owner can change roles' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_user_id = v_caller THEN
      RAISE EXCEPTION 'You cannot change your own role' USING ERRCODE = 'check_violation';
    END IF;
    IF v_role = 'owner' OR v_current = 'owner' THEN
      RAISE EXCEPTION 'Only CareLocal support can add or remove an owner' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_caller_role <> 'owner' AND (
         v_role IN ('director', 'assistant_director') OR v_current IN ('director', 'assistant_director')
         OR v_access IS NOT NULL) THEN
      RAISE EXCEPTION 'Only the center owner can make someone a Director or Assistant Director' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Rules for leadership roles
  IF v_role IN ('owner', 'director', 'assistant_director') THEN
    IF v_role <> 'owner' AND v_class <> 'regular' THEN
      RAISE EXCEPTION 'Only Regular employees can be a Director or Assistant Director' USING ERRCODE = 'check_violation';
    END IF;
    -- The center dashboard serves one center per sign-in
    IF EXISTS (SELECT 1 FROM center_admins WHERE user_id = v_user_id AND center_id <> p_center_id) THEN
      RAISE EXCEPTION 'This person already manages another center' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF v_current = 'owner' AND v_role IS DISTINCT FROM 'owner'
     AND NOT EXISTS (SELECT 1 FROM center_admins WHERE center_id = p_center_id AND role = 'owner' AND user_id <> v_user_id) THEN
    RAISE EXCEPTION 'A center needs at least one owner. Add another owner first.' USING ERRCODE = 'check_violation';
  END IF;

  -- Access that goes with the role
  v_new_access := CASE
    WHEN v_role = 'owner' THEN 'owner'
    WHEN v_role IN ('director', 'assistant_director') THEN 'admin'
    ELSE NULL
  END;

  IF v_new_access IS NULL THEN
    DELETE FROM center_admins WHERE center_id = p_center_id AND user_id = v_user_id;
  ELSIF v_access IS NULL THEN
    INSERT INTO center_admins (center_id, user_id, role) VALUES (p_center_id, v_user_id, v_new_access);
  ELSIF v_access <> v_new_access THEN
    UPDATE center_admins SET role = v_new_access WHERE center_id = p_center_id AND user_id = v_user_id;
  END IF;

  PERFORM set_config('carelocal.center_role_rpc', 'on', true);
  UPDATE center_staff
  SET center_role = v_role,
      -- An owner is a regular employee of their own center
      employment_class = CASE WHEN v_role = 'owner' THEN 'regular' ELSE employment_class END
  WHERE center_id = p_center_id AND staff_id = p_staff_id;
  PERFORM set_config('carelocal.center_role_rpc', 'off', true);

  IF v_new_access IS NOT NULL THEN
    UPDATE staff_profiles SET staff_type = 'admin' WHERE id = p_staff_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_center_role(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_center_role(uuid, uuid, text) TO authenticated, service_role;

-- The old Admin switch now goes through roles (kept so older app builds still work)
CREATE OR REPLACE FUNCTION public.set_center_admin_access(p_center_id uuid, p_staff_id uuid, p_is_admin boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.set_center_role(p_center_id, p_staff_id, CASE WHEN p_is_admin THEN 'director' ELSE NULL END);
END;
$$;

-- 4. Demoted to Substitute or removed: a Director / Assistant Director loses the role and access ----
CREATE OR REPLACE FUNCTION public.revoke_admin_when_not_regular()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.employment_class <> 'regular' OR NEW.status::text = 'removed' THEN
    DELETE FROM center_admins ca
    USING staff_profiles sp
    WHERE sp.id = NEW.staff_id AND ca.user_id = sp.user_id
      AND ca.center_id = NEW.center_id AND ca.role = 'admin';
    IF NEW.center_role IN ('director', 'assistant_director') THEN
      PERFORM set_config('carelocal.center_role_rpc', 'on', true);
      UPDATE center_staff SET center_role = NULL WHERE id = NEW.id;
      PERFORM set_config('carelocal.center_role_rpc', 'off', true);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Registration may only claim a brand-new center ------------------------------------
CREATE OR REPLACE FUNCTION public.can_claim_new_center(p_center_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM centers c WHERE c.id = p_center_id AND c.created_at > now() - interval '15 minutes')
     AND NOT EXISTS (SELECT 1 FROM center_admins WHERE center_id = p_center_id)
     AND NOT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.can_claim_new_center(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_claim_new_center(uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can create their own admin records" ON public.center_admins;
CREATE POLICY "Users can create their own admin records"
  ON public.center_admins FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'owner' AND public.can_claim_new_center(center_id));

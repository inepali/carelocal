-- ============================================================
-- Center "Admin" role for employees
--  * The center owner promotes a Regular employee to Admin: a center_admins row with
--    role 'admin' (access comes from this grant, never from the self-editable
--    staff_profiles.staff_type) and the employee's Role set to 'admin'.
--  * Admins remain employees: their own checklist still applies, and they cannot
--    review / complete their own records (no self-approval).
-- ============================================================

-- 1. Helpers --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_own_staff(p_staff_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM staff_profiles WHERE id = p_staff_id AND user_id = auth.uid());
$$;

-- Center role ('owner' / 'admin') of a staff member at a center, for that center's admins
CREATE OR REPLACE FUNCTION public.staff_center_role(p_center_id uuid, p_staff_id uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT ca.role
  FROM center_admins ca
  JOIN staff_profiles sp ON sp.user_id = ca.user_id
  WHERE ca.center_id = p_center_id
    AND sp.id = p_staff_id
    AND public.is_center_admin(p_center_id)
  LIMIT 1;
$$;

-- 2. Owner grants / revokes Admin -----------------------------------------------
CREATE OR REPLACE FUNCTION public.set_center_admin_access(p_center_id uuid, p_staff_id uuid, p_is_admin boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_class text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the center owner can change admin access' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT sp.user_id, cs.employment_class INTO v_user_id, v_class
  FROM center_staff cs
  JOIN staff_profiles sp ON sp.id = cs.staff_id
  WHERE cs.center_id = p_center_id AND cs.staff_id = p_staff_id AND cs.status::text <> 'removed';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'This person is not an employee of the center' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own access' USING ERRCODE = 'check_violation';
  END IF;

  IF p_is_admin THEN
    IF v_class <> 'regular' THEN
      RAISE EXCEPTION 'Only Regular employees can be made Admin' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM center_admins WHERE center_id = p_center_id AND user_id = v_user_id) THEN
      INSERT INTO center_admins (center_id, user_id, role) VALUES (p_center_id, v_user_id, 'admin');
    END IF;
    UPDATE staff_profiles SET staff_type = 'admin' WHERE id = p_staff_id;
  ELSE
    -- Never removes an owner
    DELETE FROM center_admins WHERE center_id = p_center_id AND user_id = v_user_id AND role = 'admin';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_center_admin_access(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_center_admin_access(uuid, uuid, boolean) TO authenticated;

-- An Admin who is demoted to Substitute (or removed) loses admin access
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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_revoke_admin_when_not_regular ON public.center_staff;
CREATE TRIGGER trg_revoke_admin_when_not_regular
  AFTER UPDATE OF employment_class, status ON public.center_staff
  FOR EACH ROW EXECUTE FUNCTION public.revoke_admin_when_not_regular();

-- 3. No self-approval: an admin acting on their own records is treated as staff ----
CREATE OR REPLACE FUNCTION public.guard_document_status_admin_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR (public.is_center_admin(NEW.center_id) AND NOT public.is_own_staff(NEW.staff_id)) THEN
    RETURN NEW;
  END IF;

  NEW.status := 'pending_review';
  NEW.center_reviewed := false;

  IF TG_OP = 'INSERT' THEN
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.review_notes := NULL;
    NEW.completed_on := NULL;
    NEW.hours := NULL;
    NEW.expires_on := NULL;
    NEW.not_applicable := false;
    NEW.not_applicable_reason := NULL;
  ELSE
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.review_notes := OLD.review_notes;
    NEW.completed_on := OLD.completed_on;
    NEW.hours := OLD.hours;
    NEW.expires_on := OLD.expires_on;
    NEW.not_applicable := OLD.not_applicable;
    NEW.not_applicable_reason := OLD.not_applicable_reason;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_accepted_document_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR (public.is_center_admin(OLD.center_id) AND NOT public.is_own_staff(OLD.staff_id)) THEN
    RETURN OLD;
  END IF;
  IF OLD.status::text = 'accepted' THEN
    RAISE EXCEPTION 'An accepted document can only be removed by the center' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_center_staff_employment_class()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = NEW.center_id)
     AND NOT public.is_own_staff(NEW.staff_id) THEN
    IF TG_OP = 'INSERT' AND NEW.employment_start_date IS NULL THEN
      NEW.employment_start_date := COALESCE(NEW.added_at, now())::date;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.employment_class := 'substitute';
    NEW.employment_start_date := COALESCE(NEW.added_at, now())::date;
  ELSE
    NEW.employment_class := OLD.employment_class;
    NEW.employment_start_date := OLD.employment_start_date;
  END IF;
  RETURN NEW;
END;
$$;

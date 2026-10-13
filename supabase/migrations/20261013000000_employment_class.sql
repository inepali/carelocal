-- ============================================================
-- Employment class (regular / substitute) per center relationship
--  - Lives on center_staff: a person can be regular at one center
--    and a substitute at another.
--  - Only center admins (or super admins / service role) may change it.
--  - Regular employees are out of scope for that center's shift
--    marketplace (open shift visibility, claims, notifications).
--  - Document requirements can target one or both classes.
-- ============================================================

-- 1. Column on center_staff (existing rows become substitute = current flow)
ALTER TABLE public.center_staff
  ADD COLUMN IF NOT EXISTS employment_class text NOT NULL DEFAULT 'substitute';

ALTER TABLE public.center_staff
  DROP CONSTRAINT IF EXISTS center_staff_employment_class_check;
ALTER TABLE public.center_staff
  ADD CONSTRAINT center_staff_employment_class_check
  CHECK (employment_class IN ('regular', 'substitute'));

-- 2. Requirements can target classes; NULL = all classes
ALTER TABLE public.center_document_requirements
  ADD COLUMN IF NOT EXISTS applies_to_class text[];

-- 3. Only center admins can set / change employment_class.
--    Non-admin writes are not rejected (keeps staff self-join flows working);
--    the value is silently forced to substitute on insert / kept on update.
CREATE OR REPLACE FUNCTION public.guard_center_staff_employment_class()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role / server-side jobs have no auth user
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM center_admins
    WHERE user_id = auth.uid() AND center_id = NEW.center_id
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.employment_class := 'substitute';
  ELSE
    NEW.employment_class := OLD.employment_class;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_center_staff_employment_class ON public.center_staff;
CREATE TRIGGER trg_guard_center_staff_employment_class
  BEFORE INSERT OR UPDATE ON public.center_staff
  FOR EACH ROW EXECUTE FUNCTION public.guard_center_staff_employment_class();

-- 4. Centers where the user is a regular employee (SECURITY DEFINER avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.get_user_regular_centers(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT cs.center_id
  FROM center_staff cs
  JOIN staff_profiles sp ON sp.id = cs.staff_id
  WHERE sp.user_id = p_user_id
    AND cs.employment_class = 'regular';
$$;

-- 5. Hide a center's open shifts from its regular employees
--    (same as 20260527230000 plus the regular-center exclusion)
DROP POLICY IF EXISTS "Authenticated users can view open shifts" ON public.shifts;
CREATE POLICY "Authenticated users can view open shifts"
  ON public.shifts FOR SELECT
  TO authenticated
  USING (
    status = 'open'
    AND shift_date >= CURRENT_DATE
    AND center_id NOT IN (SELECT public.get_user_regular_centers(auth.uid()))
  );

-- 6. Regular employees cannot claim / express interest in their center's shifts
CREATE OR REPLACE FUNCTION public.guard_shift_claim_employment_class()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM shifts s
    JOIN center_staff cs ON cs.center_id = s.center_id AND cs.staff_id = NEW.staff_id
    WHERE s.id = NEW.shift_id
      AND cs.employment_class = 'regular'
  ) THEN
    RAISE EXCEPTION 'Regular employees cannot claim shifts at their own center'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_shift_claim_employment_class ON public.shift_claims;
CREATE TRIGGER trg_guard_shift_claim_employment_class
  BEFORE INSERT ON public.shift_claims
  FOR EACH ROW EXECUTE FUNCTION public.guard_shift_claim_employment_class();

-- 7. When a staff member becomes regular, withdraw their open (pending / interested)
--    claims on that center's shifts. Confirmed assignments are kept.
CREATE OR REPLACE FUNCTION public.cancel_claims_on_regular_employment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.employment_class = 'regular' AND OLD.employment_class IS DISTINCT FROM 'regular' THEN
    UPDATE shift_claims sc
    SET status = 'cancelled'
    FROM shifts s
    WHERE sc.shift_id = s.id
      AND s.center_id = NEW.center_id
      AND sc.staff_id = NEW.staff_id
      AND sc.status::text IN ('pending', 'interested');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_claims_on_regular_employment ON public.center_staff;
CREATE TRIGGER trg_cancel_claims_on_regular_employment
  AFTER UPDATE OF employment_class ON public.center_staff
  FOR EACH ROW EXECUTE FUNCTION public.cancel_claims_on_regular_employment();

-- 8. A regular employee is associated with exactly one center.
--    - A regular cannot join / apply / be invited to another center.
--    - A staff member cannot become regular while associated with another center.
--    Trigger name sorts after trg_guard_* so the admin-only guard runs first.
CREATE OR REPLACE FUNCTION public.enforce_regular_single_center()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text = 'removed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM center_staff
    WHERE staff_id = NEW.staff_id
      AND center_id <> NEW.center_id
      AND employment_class = 'regular'
      AND status::text <> 'removed'
  ) THEN
    RAISE EXCEPTION 'This staff member is a regular employee at another center and cannot join additional centers'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.employment_class = 'regular'
     AND (TG_OP = 'INSERT' OR OLD.employment_class IS DISTINCT FROM 'regular')
     AND EXISTS (
       SELECT 1 FROM center_staff
       WHERE staff_id = NEW.staff_id
         AND center_id <> NEW.center_id
         AND status::text <> 'removed'
     ) THEN
    RAISE EXCEPTION 'This staff member is associated with other centers and cannot become a regular employee here until they leave them'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_regular_single_center ON public.center_staff;
CREATE TRIGGER trg_regular_single_center
  BEFORE INSERT OR UPDATE ON public.center_staff
  FOR EACH ROW EXECUTE FUNCTION public.enforce_regular_single_center();

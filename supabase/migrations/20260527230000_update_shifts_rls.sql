-- 1. Create helper function for assigned shifts if not exists
CREATE OR REPLACE FUNCTION public.get_user_assigned_shifts(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT shift_id 
  FROM shift_claims 
  WHERE staff_id = (SELECT id FROM staff_profiles WHERE user_id = p_user_id LIMIT 1)
    AND status = 'confirmed';
$$;

-- 2. Drop existing SELECT policies on public.shifts for authenticated users
DROP POLICY IF EXISTS "Authenticated users can view open shifts" ON public.shifts;
DROP POLICY IF EXISTS "Staff can view shifts they have claimed" ON public.shifts;
DROP POLICY IF EXISTS "Staff can view shifts they are assigned to" ON public.shifts;

-- 3. Re-create open shifts policy to restrict to open and future shifts
CREATE POLICY "Authenticated users can view open shifts"
  ON public.shifts FOR SELECT
  TO authenticated
  USING (
    status = 'open' AND shift_date >= CURRENT_DATE
  );

-- 4. Re-create claimed shifts policy to restrict to shifts assigned (confirmed) to the logged staff
CREATE POLICY "Staff can view shifts they are assigned to"
  ON public.shifts FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT get_user_assigned_shifts(auth.uid()))
  );

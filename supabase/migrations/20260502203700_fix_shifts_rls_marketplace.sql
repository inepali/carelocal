-- Remove the restrictive policy that prevented new users from seeing open shifts
DROP POLICY IF EXISTS "Active staff can read open shifts for their centers" ON public.shifts;
DROP POLICY IF EXISTS "Authenticated users can view open shifts" ON public.shifts;
DROP POLICY IF EXISTS "Staff can view shifts they have claimed" ON public.shifts;

-- 1. Allow all authenticated users to see OPEN shifts (for the marketplace)
CREATE POLICY "Authenticated users can view open shifts"
  ON public.shifts FOR SELECT
  TO authenticated
  USING (status = 'open');

-- 2. Create a SECURITY DEFINER function to break the infinite recursion
CREATE OR REPLACE FUNCTION get_user_claimed_shifts(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT shift_id 
  FROM shift_claims 
  WHERE staff_id = (SELECT id FROM staff_profiles WHERE user_id = p_user_id LIMIT 1);
$$;

-- 3. Allow staff to see ANY shift (even filled ones) if they have a claim on it, using the function to bypass recursion
CREATE POLICY "Staff can view shifts they have claimed"
  ON public.shifts FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT get_user_claimed_shifts(auth.uid()))
  );

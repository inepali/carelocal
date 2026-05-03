-- Remove the restrictive policy that prevented new users from seeing open shifts
DROP POLICY IF EXISTS "Active staff can read open shifts for their centers" ON public.shifts;

-- 1. Allow all authenticated users to see OPEN shifts (for the marketplace)
CREATE POLICY "Authenticated users can view open shifts"
  ON public.shifts FOR SELECT
  TO authenticated
  USING (status = 'open');

-- 2. Allow staff to see ANY shift (even filled ones) if they have a claim on it
CREATE POLICY "Staff can view shifts they have claimed"
  ON public.shifts FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT shift_id 
      FROM shift_claims 
      WHERE staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
    )
  );

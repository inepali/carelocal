-- ==========================================
-- EMERGENCY RECURSION RESET
-- Please execute this ENTIRE script in the Supabase SQL Editor.
-- ==========================================

-- 1. Disable RLS temporarily
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_claims DISABLE ROW LEVEL SECURITY;

-- 2. DYNAMICALLY wipe ANY and ALL custom policies on the "shifts" table (This guarantees the recursive ghost policy is destroyed regardless of its name!)
DO $$ 
DECLARE 
    pol record;
BEGIN
    FOR pol IN 
        SELECT polname 
        FROM pg_policy 
        WHERE polrelid = 'public.shifts'::regclass 
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.shifts;', pol.polname);
    END LOOP;
END $$;

-- 3. DYNAMICALLY wipe ALL policies on the "shift_claims" table safely
DO $$ 
DECLARE 
    pol record;
BEGIN
    FOR pol IN 
        SELECT polname 
        FROM pg_policy 
        WHERE polrelid = 'public.shift_claims'::regclass 
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.shift_claims;', pol.polname);
    END LOOP;
END $$;

-- 4. Re-enable clean baseline Row Level Security
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_claims ENABLE ROW LEVEL SECURITY;

-- 5. Rebuild exact baseline policies for shifts
CREATE POLICY "Center admins can manage shifts"
  ON shifts FOR ALL
  USING (
    center_id IN (SELECT center_id FROM center_admins WHERE user_id = auth.uid())
  );

CREATE POLICY "Active staff can read open shifts for their centers"
  ON shifts FOR SELECT
  USING (
    center_id IN (
      SELECT cs.center_id FROM center_staff cs
      JOIN staff_profiles sp ON sp.id = cs.staff_id
      WHERE sp.user_id = auth.uid() AND cs.status = 'active'
    )
    AND status = 'open'
  );

CREATE POLICY "Super admins can manage all shifts"
  ON shifts FOR ALL
  TO authenticated
  USING ( ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true) );

-- 6. Rebuild exact baseline policies for shift_claims
CREATE POLICY "Staff can manage their own claims"
  ON shift_claims FOR ALL
  USING (
    staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Center admins can view claims for their shifts"
  ON shift_claims FOR SELECT
  USING (
    shift_id IN (
      SELECT id FROM shifts WHERE center_id IN (
        SELECT center_id FROM center_admins WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Center admins can confirm or cancel claims"
  ON shift_claims FOR UPDATE
  USING (
    shift_id IN (
      SELECT id FROM shifts WHERE center_id IN (
        SELECT center_id FROM center_admins WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Super admins can manage all shift claims"
  ON shift_claims FOR ALL
  TO authenticated
  USING ( ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true) );

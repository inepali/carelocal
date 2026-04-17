-- =============================================================
-- Super Admin Global RLS Policies
-- =============================================================

-- 1. Centers
create policy "Super admins can manage all centers"
  on centers for all
  to authenticated
  using ( ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true) );

-- 2. Subscriptions
create policy "Super admins can manage all subscriptions"
  on subscriptions for all
  to authenticated
  using ( ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true) );

-- 3. Staff Profiles
create policy "Super admins can manage all staff profiles"
  on staff_profiles for all
  to authenticated
  using ( ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true) );

-- 4. Center Staff
create policy "Super admins can manage all center-staff relationships"
  on center_staff for all
  to authenticated
  using ( ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true) );

-- 5. Staff Documents
create policy "Super admins can manage all staff documents"
  on staff_documents for all
  to authenticated
  using ( ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true) );

-- 6. Classrooms
create policy "Super admins can manage all classrooms"
  on classrooms for all
  to authenticated
  using ( ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true) );

-- 7. Shifts
create policy "Super admins can manage all shifts"
  on shifts for all
  to authenticated
  using ( ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true) );

-- 8. Shift Claims
create policy "Super admins can manage all shift claims"
  on shift_claims for all
  to authenticated
  using ( ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true) );

-- 9. Center Admins
create policy "Super admins can manage all center admins"
  on center_admins for all
  to authenticated
  using ( ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true) );

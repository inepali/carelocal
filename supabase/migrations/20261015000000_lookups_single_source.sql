-- ============================================================
-- center_lookups as the single source of truth for every dropdown
--
-- Model:
--   * Platform defaults: center_id IS NULL, one set per domain_key.
--   * Center rows: a row whose value matches a default overrides it
--     (rename / deactivate / reorder); any other value is a custom addition.
-- ============================================================

-- 1. document_category: enum -> text so Document Type lookups can add values
--    (same treatment staff_type got in 20260625000000).
ALTER TABLE public.staff_documents ALTER COLUMN document_category TYPE text;
ALTER TABLE public.center_document_requirements ALTER COLUMN document_category TYPE text;

-- 2. Remove duplicate platform defaults (healthcare roles were seeded twice), then prevent repeats.
DELETE FROM public.center_lookups a
USING public.center_lookups b
WHERE a.center_id IS NULL AND b.center_id IS NULL
  AND a.group_name = b.group_name
  AND a.domain_key = b.domain_key
  AND a.value = b.value
  AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS center_lookups_default_unique
  ON public.center_lookups (group_name, domain_key, value)
  WHERE center_id IS NULL;

-- One override/custom row per value per center
DELETE FROM public.center_lookups a
USING public.center_lookups b
WHERE a.center_id IS NOT NULL AND a.center_id = b.center_id
  AND a.group_name = b.group_name
  AND a.value = b.value
  AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS center_lookups_center_unique
  ON public.center_lookups (center_id, group_name, value)
  WHERE center_id IS NOT NULL;

-- 3. Seed platform defaults that were previously hard-coded in the app.
INSERT INTO public.center_lookups (center_id, group_name, label, value, is_active, sort_order, domain_key)
SELECT NULL, t.group_name, t.label, t.value, true, t.sort_order, t.domain_key
FROM (VALUES
  -- Childcare roles (was STAFF_TYPE_LABELS)
  ('Role', 'Teacher', 'teacher', 1, 'childcare'),
  ('Role', 'Floater', 'floater', 2, 'childcare'),
  ('Role', 'Support Staff', 'support', 3, 'childcare'),
  ('Role', 'Cook', 'cook', 4, 'childcare'),

  -- Childcare document types (was DOCUMENT_CATEGORY_LABELS / CATEGORIES)
  ('Document Type', 'Identity (ID/Passport)', 'identity', 1, 'childcare'),
  ('Document Type', 'Certification (CPR/First Aid)', 'certification', 2, 'childcare'),
  ('Document Type', 'Background Check', 'background', 3, 'childcare'),
  ('Document Type', 'Training', 'training', 4, 'childcare'),
  ('Document Type', 'Medical/Health', 'medical', 5, 'childcare'),
  ('Document Type', 'Documentation', 'documentation', 6, 'childcare'),
  ('Document Type', 'Academic Qualification', 'academic_qualification', 7, 'childcare'),
  ('Document Type', 'Other', 'other', 8, 'childcare'),

  -- Senior defaults (also in 20260920000000; repeated here so they exist even if that ran first/never)
  ('Role', 'Caregiver', 'caregiver', 1, 'senior'),
  ('Role', 'Home Health Aide', 'home_health_aide', 2, 'senior'),
  ('Role', 'Personal Care Assistant', 'personal_care_assistant', 3, 'senior'),
  ('Role', 'Medication Aide', 'medication_aide', 4, 'senior'),
  ('Role', 'Activities Assistant', 'activities_assistant', 5, 'senior'),
  ('Document Type', 'Background Check', 'background_check', 1, 'senior'),
  ('Document Type', 'CPR / First Aid Certification', 'cpr_first_aid', 2, 'senior'),
  ('Document Type', 'Caregiver Training', 'caregiver_training', 3, 'senior'),
  ('Document Type', 'Medication Training', 'medication_training', 4, 'senior'),
  ('Document Type', 'Other Credentials', 'other', 5, 'senior'),

  -- Payment methods for every vertical (was PAYMENT_METHODS / DEFAULT_PAYMENT_METHODS)
  ('Payment Method', 'Payroll', 'payroll', 1, 'childcare'),
  ('Payment Method', 'Direct Deposit', 'direct_deposit', 2, 'childcare'),
  ('Payment Method', 'Check', 'check', 3, 'childcare'),
  ('Payment Method', 'Cash', 'cash', 4, 'childcare'),
  ('Payment Method', 'Zelle', 'zelle', 5, 'childcare'),
  ('Payment Method', 'Venmo', 'venmo', 6, 'childcare'),
  ('Payment Method', 'Cash App', 'cashapp', 7, 'childcare'),
  ('Payment Method', 'PayPal', 'paypal', 8, 'childcare'),
  ('Payment Method', 'Payroll', 'payroll', 1, 'healthcare'),
  ('Payment Method', 'Direct Deposit', 'direct_deposit', 2, 'healthcare'),
  ('Payment Method', 'Check', 'check', 3, 'healthcare'),
  ('Payment Method', 'Cash', 'cash', 4, 'healthcare'),
  ('Payment Method', 'Zelle', 'zelle', 5, 'healthcare'),
  ('Payment Method', 'Venmo', 'venmo', 6, 'healthcare'),
  ('Payment Method', 'Cash App', 'cashapp', 7, 'healthcare'),
  ('Payment Method', 'PayPal', 'paypal', 8, 'healthcare'),
  ('Payment Method', 'Payroll', 'payroll', 1, 'senior'),
  ('Payment Method', 'Direct Deposit', 'direct_deposit', 2, 'senior'),
  ('Payment Method', 'Check', 'check', 3, 'senior'),
  ('Payment Method', 'Cash', 'cash', 4, 'senior'),
  ('Payment Method', 'Zelle', 'zelle', 5, 'senior'),
  ('Payment Method', 'Venmo', 'venmo', 6, 'senior'),
  ('Payment Method', 'Cash App', 'cashapp', 7, 'senior'),
  ('Payment Method', 'PayPal', 'paypal', 8, 'senior')
) AS t(group_name, label, value, sort_order, domain_key)
ON CONFLICT DO NOTHING;

-- 4. Read access. Defaults are readable by every signed-in user; center rows by that
--    center's admins (existing FOR ALL policy) and by staff connected to the center.
DROP POLICY IF EXISTS "Staff can view center lookups" ON public.center_lookups;

DROP POLICY IF EXISTS "Authenticated users can read default lookups" ON public.center_lookups;
CREATE POLICY "Authenticated users can read default lookups"
  ON public.center_lookups FOR SELECT
  TO authenticated
  USING (center_id IS NULL);

DROP POLICY IF EXISTS "Staff can read their centers' lookups" ON public.center_lookups;
CREATE POLICY "Staff can read their centers' lookups"
  ON public.center_lookups FOR SELECT
  TO authenticated
  USING (
    center_id IN (
      SELECT cs.center_id
      FROM public.center_staff cs
      JOIN public.staff_profiles sp ON sp.id = cs.staff_id
      WHERE sp.user_id = auth.uid()
    )
  );

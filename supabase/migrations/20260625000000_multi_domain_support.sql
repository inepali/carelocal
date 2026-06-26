-- ============================================================
-- Migration: Multi-domain/tenant support for Childcare & Healthcare
-- ============================================================

-- 1. Convert staff_type enum columns to text for extensibility
ALTER TABLE public.staff_profiles ALTER COLUMN staff_type TYPE text;
ALTER TABLE public.shifts ALTER COLUMN staff_type_needed TYPE text;
ALTER TABLE public.center_document_requirements ALTER COLUMN applies_to TYPE text[];

-- 2. Add domain_key columns
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS domain_key text NOT NULL DEFAULT 'childcare';
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS domain_key text NOT NULL DEFAULT 'childcare';
ALTER TABLE public.center_lookups ADD COLUMN IF NOT EXISTS domain_key text NOT NULL DEFAULT 'childcare';

-- 3. Update existing lookups to match their center's domain
UPDATE public.center_lookups cl
SET domain_key = c.domain_key
FROM public.centers c
WHERE cl.center_id = c.id;

-- 4. Seed default healthcare roles (domain_key = 'healthcare', center_id = NULL)
INSERT INTO public.center_lookups (center_id, group_name, label, value, is_active, sort_order, domain_key) VALUES
  (NULL, 'Role', 'Nurse (RN/LPN)', 'nurse', true, 1, 'healthcare'),
  (NULL, 'Role', 'Certified Nursing Assistant (CNA)', 'cna', true, 2, 'healthcare'),
  (NULL, 'Role', 'Caregiver', 'caregiver', true, 3, 'healthcare'),
  (NULL, 'Role', 'Therapist', 'therapist', true, 4, 'healthcare');

-- 5. Seed default healthcare document types (domain_key = 'healthcare', center_id = NULL)
INSERT INTO public.center_lookups (center_id, group_name, label, value, is_active, sort_order, domain_key) VALUES
  (NULL, 'Document Type', 'State Professional License', 'license', true, 1, 'healthcare'),
  (NULL, 'Document Type', 'BLS / CPR Certification', 'bls_cpr', true, 2, 'healthcare'),
  (NULL, 'Document Type', 'Background & Drug Screen', 'background_drug', true, 3, 'healthcare'),
  (NULL, 'Document Type', 'Immunization & Health Records', 'immunization', true, 4, 'healthcare'),
  (NULL, 'Document Type', 'Other Credentials', 'other', true, 5, 'healthcare');

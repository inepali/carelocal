-- Add the Senior vertical's platform defaults.
-- Existing centers and staff remain in their current vertical.

INSERT INTO public.center_lookups (center_id, group_name, label, value, is_active, sort_order, domain_key) VALUES
  (NULL, 'Role', 'Caregiver', 'caregiver', true, 1, 'senior'),
  (NULL, 'Role', 'Home Health Aide', 'home_health_aide', true, 2, 'senior'),
  (NULL, 'Role', 'Personal Care Assistant', 'personal_care_assistant', true, 3, 'senior'),
  (NULL, 'Role', 'Medication Aide', 'medication_aide', true, 4, 'senior'),
  (NULL, 'Role', 'Activities Assistant', 'activities_assistant', true, 5, 'senior');

INSERT INTO public.center_lookups (center_id, group_name, label, value, is_active, sort_order, domain_key) VALUES
  (NULL, 'Document Type', 'Background Check', 'background_check', true, 1, 'senior'),
  (NULL, 'Document Type', 'CPR / First Aid Certification', 'cpr_first_aid', true, 2, 'senior'),
  (NULL, 'Document Type', 'Caregiver Training', 'caregiver_training', true, 3, 'senior'),
  (NULL, 'Document Type', 'Medication Training', 'medication_training', true, 4, 'senior'),
  (NULL, 'Document Type', 'Other Credentials', 'other', true, 5, 'senior');

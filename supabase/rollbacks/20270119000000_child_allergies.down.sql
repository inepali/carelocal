-- Rollback for 20270119000000_child_allergies.sql. WARNING: deletes every child's allergies (export first).
DROP TABLE IF EXISTS public.child_allergies;
DROP FUNCTION IF EXISTS public.child_allergies_log();
DROP FUNCTION IF EXISTS public.child_allergies_touch();
DELETE FROM public.center_lookups WHERE center_id IS NULL AND group_name = 'Allergy' AND domain_key = 'childcare';
-- Centers' own Allergy list items (custom / renamed) are kept; delete them too only if you want them gone:
-- DELETE FROM public.center_lookups WHERE group_name = 'Allergy';

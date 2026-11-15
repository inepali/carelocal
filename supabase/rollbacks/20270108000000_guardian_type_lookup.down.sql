-- Rollback for 20270108000000_guardian_type_lookup.sql
-- Removes the Parent/Guardian Types list: platform defaults and every center's overrides / custom types.
-- child_guardians.relationship keeps its saved text, so no contact loses its relationship.
DELETE FROM public.center_lookups WHERE group_name = 'Guardian Type';

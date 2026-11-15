-- ============================================================
-- Parent / guardian types: a Manage Data list (center_lookups group 'Guardian Type').
-- Center admins rename, reorder, deactivate or add types in About → Manage Data; the Relationship field
-- when adding a parent or contact to a child picks from the active list.
-- child_guardians.relationship stays free text (≤ 60 chars) and stores the chosen label, so existing
-- records and every place that shows the relationship keep working unchanged.
-- Platform defaults are for childcare only (the only vertical with children).
-- Rollback: DELETE FROM public.center_lookups WHERE group_name = 'Guardian Type';
-- ============================================================

INSERT INTO public.center_lookups (center_id, group_name, label, value, is_active, sort_order, domain_key)
SELECT NULL, 'Guardian Type', t.label, t.value, true, t.sort_order, 'childcare'
FROM (VALUES
  ('Mother',             'mother',        1),
  ('Father',             'father',        2),
  ('Parent',             'parent',        3),
  ('Legal Guardian',     'legal_guardian', 4),
  ('Stepmother',         'stepmother',    5),
  ('Stepfather',         'stepfather',    6),
  ('Foster Parent',      'foster_parent', 7),
  ('Grandmother',        'grandmother',   8),
  ('Grandfather',        'grandfather',   9),
  ('Aunt',               'aunt',          10),
  ('Uncle',              'uncle',         11),
  ('Sibling',            'sibling',       12),
  ('Nanny / Babysitter', 'nanny',         13),
  ('Family Friend',      'family_friend', 14),
  ('Neighbor',           'neighbor',      15),
  ('Other',              'other',         16)
) AS t(label, value, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.center_lookups cl
  WHERE cl.center_id IS NULL AND cl.group_name = 'Guardian Type'
    AND cl.value = t.value AND cl.domain_key = 'childcare'
);

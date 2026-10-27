-- "Join your center's GroupMe" on the staff Getting started checklist. Shown only when a center the staff member is
-- invited to or works at has a GroupMe invite link (center_groupme.share_url), read through a server action since
-- center_groupme is server-only.
ALTER TABLE public.staff_onboarding_items DROP CONSTRAINT IF EXISTS staff_onboarding_items_task_check;
ALTER TABLE public.staff_onboarding_items ADD CONSTRAINT staff_onboarding_items_task_check
  CHECK (task IN ('profile', 'id', 'education', 'credentials', 'availability', 'groupme'));

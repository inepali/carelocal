-- Rollback for 20270107000000_center_guardians.sql (contact rows keep their name, phone and email)
DROP TRIGGER IF EXISTS trg_push_center_guardian_details ON public.center_guardians;
DROP TRIGGER IF EXISTS trg_guard_center_guardian ON public.center_guardians;
DROP TRIGGER IF EXISTS trg_fill_guardian_from_list ON public.child_guardians;
DROP FUNCTION IF EXISTS public.push_center_guardian_details();
DROP FUNCTION IF EXISTS public.fill_guardian_from_list();
DROP FUNCTION IF EXISTS public.guard_center_guardian();
DROP INDEX IF EXISTS public.child_guardians_child_center_guardian_uq;
ALTER TABLE public.child_guardians DROP CONSTRAINT IF EXISTS child_guardians_center_guardian_fk;
ALTER TABLE public.child_guardians DROP COLUMN IF EXISTS center_guardian_id;
DROP TABLE IF EXISTS public.center_guardians;

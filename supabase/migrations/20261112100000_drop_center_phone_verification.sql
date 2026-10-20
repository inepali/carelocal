-- Phone verification was rolled back for now (it will come back with its own migration).
-- Removes what 20261112000000_center_phone_verification added.

DROP TRIGGER IF EXISTS trg_guard_center_phone_verification ON public.centers;
DROP FUNCTION IF EXISTS public.guard_center_phone_verification();
ALTER TABLE public.centers
  DROP COLUMN IF EXISTS phone_verified_at,
  DROP COLUMN IF EXISTS phone_verified_by;

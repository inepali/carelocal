-- Public center page: the center chooses whether its capacity (centers.max_capacity) is shown, like phone,
-- email, license number and Care Score.
ALTER TABLE public.centers
  ADD COLUMN IF NOT EXISTS public_show_capacity boolean NOT NULL DEFAULT true;

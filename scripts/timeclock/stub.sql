-- Extra stand-ins for the Time Clock migration (20270120000000_time_clock.sql), on top of the schedule stubs
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS roster_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.center_staff ADD COLUMN IF NOT EXISTS part_time boolean NOT NULL DEFAULT false;
ALTER TABLE public.center_staff ADD COLUMN IF NOT EXISTS employment_start_date date;
ALTER TABLE public.center_staff ADD COLUMN IF NOT EXISTS added_at timestamptz NOT NULL DEFAULT now();

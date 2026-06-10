-- Add staff_maintenance_fee column to metro_areas table (default 0.00)
ALTER TABLE public.metro_areas
ADD COLUMN IF NOT EXISTS staff_maintenance_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00;

-- Add balance_due column to staff_profiles table (default 0.00)
ALTER TABLE public.staff_profiles
ADD COLUMN IF NOT EXISTS balance_due NUMERIC(10, 2) NOT NULL DEFAULT 0.00;

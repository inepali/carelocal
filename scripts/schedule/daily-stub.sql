-- Extra stand-ins for the daily board migration (20270101010000_schedule_days.sql), on top of stub.sql
ALTER TABLE public.work_areas ADD COLUMN ratio_children integer;
CREATE TABLE public.children (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  first_name text NOT NULL DEFAULT 'Kid', classroom_id uuid REFERENCES work_areas(id) ON DELETE SET NULL, status text NOT NULL DEFAULT 'enrolled');
CREATE TABLE public.shifts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  work_area_id uuid REFERENCES work_areas(id) ON DELETE SET NULL, shift_date date NOT NULL, start_time time NOT NULL, end_time time NOT NULL,
  status text NOT NULL DEFAULT 'open', is_archived boolean NOT NULL DEFAULT false);
CREATE TABLE public.shift_claims (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'pending');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.children, public.shifts, public.shift_claims TO authenticated, service_role;

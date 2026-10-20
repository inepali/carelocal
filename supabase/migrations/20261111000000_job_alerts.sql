-- Regular hiring, Phase 2: opt-in job alerts by city and role.
-- A staff member saves alerts (a city and/or a role, or neither = any job in their metro area).
-- When a job is published for the first time, matching staff are notified once.

CREATE TABLE IF NOT EXISTS public.job_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  city        text,                 -- NULL = any city in their metro area
  state       text,
  role_value  text,                 -- NULL = any role
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_alerts_staff ON public.job_alerts (staff_id);
CREATE UNIQUE INDEX IF NOT EXISTS job_alerts_unique
  ON public.job_alerts (staff_id, COALESCE(lower(city), ''), COALESCE(lower(state), ''), COALESCE(role_value, ''));

ALTER TABLE public.job_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff manage their own job alerts" ON public.job_alerts;
CREATE POLICY "Staff manage their own job alerts" ON public.job_alerts FOR ALL TO authenticated
  USING (public.is_own_staff_profile(staff_id))
  WITH CHECK (public.is_own_staff_profile(staff_id));

-- Alerts go out once per posting, the first time it is published
ALTER TABLE public.job_postings ADD COLUMN IF NOT EXISTS alerts_sent_at timestamptz;

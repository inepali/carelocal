-- Tour requests from the public center page (/centers/<handle>). Visitors are not signed in, so rows are
-- created on the server (service role) after validation; center admins read and manage their own center's
-- requests. Nobody else can read them: they hold a family's contact details and children's names.

ALTER TABLE public.centers
  ADD COLUMN IF NOT EXISTS public_tours_enabled boolean NOT NULL DEFAULT true;   -- shows "Schedule a Tour" on the public page

CREATE TABLE IF NOT EXISTS public.center_tour_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id       uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  first_name      text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 60),
  last_name       text NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 60),
  email           text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  phone           text NOT NULL CHECK (char_length(phone) BETWEEN 7 AND 30),
  contact_time    text CHECK (contact_time IN ('morning', 'afternoon', 'evening')),
  tour_type       text NOT NULL DEFAULT 'in_person' CHECK (tour_type IN ('in_person', 'virtual')),
  preferred_date  date,                                    -- null when the visitor only listed their availability
  preferred_time  text CHECK (preferred_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  alternate_times text CHECK (char_length(alternate_times) <= 500),
  children        jsonb NOT NULL DEFAULT '[]',             -- [{ "name": "...", "dob": "YYYY-MM-DD" | null }]
  start_date      date,
  first_group_care boolean,
  topics          text[] NOT NULL DEFAULT '{}',
  message         text CHECK (char_length(message) <= 1000),
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'completed', 'cancelled')),
  confirmed_date  date,
  confirmed_time  text CHECK (confirmed_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  center_note     text CHECK (char_length(center_note) <= 1000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tour_requests_center_status ON public.center_tour_requests (center_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tour_requests_email_recent ON public.center_tour_requests (lower(email), created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.center_tour_requests;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.center_tour_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.center_tour_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Center admins read their tour requests" ON public.center_tour_requests;
CREATE POLICY "Center admins read their tour requests" ON public.center_tour_requests FOR SELECT TO authenticated
  USING (public.is_center_admin(center_id));
DROP POLICY IF EXISTS "Center admins update their tour requests" ON public.center_tour_requests;
CREATE POLICY "Center admins update their tour requests" ON public.center_tour_requests FOR UPDATE TO authenticated
  USING (public.is_center_admin(center_id)) WITH CHECK (public.is_center_admin(center_id));
DROP POLICY IF EXISTS "Center admins delete their tour requests" ON public.center_tour_requests;
CREATE POLICY "Center admins delete their tour requests" ON public.center_tour_requests FOR DELETE TO authenticated
  USING (public.is_center_admin(center_id));

-- No insert policy on purpose: only the server (service role) creates requests.
REVOKE ALL ON public.center_tour_requests FROM anon;
GRANT SELECT, UPDATE, DELETE ON public.center_tour_requests TO authenticated;

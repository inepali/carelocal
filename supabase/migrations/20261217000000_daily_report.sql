-- ============================================================
-- Daily activities, phase E: the parent daily report.
--  - centers.daily_reports_enabled (off until an owner or admin turns it on) and centers.early_pickup_before
--    (default 2:00 PM, the center's time zone).
--  - child_guardians.daily_report: who gets the email (turned on here for existing primary contacts).
--  - daily_report_queue: one row per child per day. The final check-out of the day queues it to send about
--    10 minutes later; a check-in the same day cancels a report not yet sent; the next check-out queues it again.
--  - Early pick-up gate: before the cutoff only owners and admins can check a child out (button or drag alike).
--  - The send route (service role) claims due reports, reads each report, and records the result; failures are
--    retried up to 3 times. Owners and admins can see the history, preview a day and resend from the child's file.
--  - A report holds only what parents should see: no removed entries, no staff names, no care alert, approved
--    photos only.
-- Rollback: supabase/rollbacks/20261217000000_daily_report.down.sql
-- ============================================================

-- 1. Settings ---------------------------------------------------------------------------------------------------
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS daily_reports_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS early_pickup_before time NOT NULL DEFAULT '14:00';
ALTER TABLE public.child_guardians ADD COLUMN IF NOT EXISTS daily_report boolean NOT NULL DEFAULT false;
UPDATE public.child_guardians SET daily_report = true WHERE is_primary AND email IS NOT NULL AND NOT daily_report;

-- 2. The queue -----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_report_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id     uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  child_id      uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  service_date  date NOT NULL,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled', 'skipped')),
  send_after    timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  attempts      integer NOT NULL DEFAULT 0,
  recipients    text[] NOT NULL DEFAULT '{}',
  sent_at       timestamptz,
  last_error    text,
  requested_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,     -- a Resend from the child's file
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_report_queue_child_day UNIQUE (child_id, service_date)
);
CREATE INDEX IF NOT EXISTS daily_report_queue_due_idx ON public.daily_report_queue (send_after) WHERE status IN ('queued', 'sending');

ALTER TABLE public.daily_report_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners and admins read daily_report_queue" ON public.daily_report_queue;
CREATE POLICY "Owners and admins read daily_report_queue" ON public.daily_report_queue
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
REVOKE ALL ON public.daily_report_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.daily_report_queue TO authenticated;
GRANT ALL ON public.daily_report_queue TO service_role;

-- 3. Early pick-up gate and the queue, both on the roster's own check-in / check-out events --------------------
CREATE OR REPLACE FUNCTION public.roster_events_before_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cutoff time; v_now time;
BEGIN
  IF NEW.child_id IS NULL OR NEW.action <> 'check_out' OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT early_pickup_before INTO v_cutoff FROM centers WHERE id = NEW.center_id;
  v_now := (now() AT TIME ZONE public.roster_timezone(NEW.center_id))::time;
  IF v_now < v_cutoff AND NOT public.can_view_confidential(NEW.center_id) THEN
    RAISE EXCEPTION 'Early pick-up: before % only a director can check a child out.', to_char(v_cutoff, 'FMHH12:MI AM')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.roster_events_after_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.child_id IS NULL THEN RETURN NULL; END IF;
  IF NEW.action = 'check_out' THEN
    INSERT INTO daily_report_queue (center_id, child_id, service_date, status, send_after)
    VALUES (NEW.center_id, NEW.child_id, NEW.service_date, 'queued', now() + interval '10 minutes')
    ON CONFLICT ON CONSTRAINT daily_report_queue_child_day DO UPDATE
      SET status = 'queued', send_after = EXCLUDED.send_after, attempts = 0, last_error = NULL, updated_at = now()
      WHERE daily_report_queue.status <> 'sending';
  ELSIF NEW.action = 'check_in' THEN
    UPDATE daily_report_queue SET status = 'cancelled', updated_at = now()
    WHERE child_id = NEW.child_id AND service_date = NEW.service_date AND status = 'queued';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_roster_events_before_report ON public.roster_events;
CREATE TRIGGER trg_roster_events_before_report BEFORE INSERT ON public.roster_events
  FOR EACH ROW EXECUTE FUNCTION public.roster_events_before_report();
DROP TRIGGER IF EXISTS trg_roster_events_after_report ON public.roster_events;
CREATE TRIGGER trg_roster_events_after_report AFTER INSERT ON public.roster_events
  FOR EACH ROW EXECUTE FUNCTION public.roster_events_after_report();

-- 4. What a report holds (internal; the send route and the preview use it) --------------------------------------
CREATE OR REPLACE FUNCTION public.daily_report_data(p_child_id uuid, p_day date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'child', jsonb_build_object('id', ch.id, 'first_name', COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name)),
    'center', jsonb_build_object('id', c.id, 'name', c.name, 'email', NULLIF(btrim(c.email), ''), 'phone', c.phone,
                                 'timezone', public.roster_timezone(c.id), 'domain_key', c.domain_key),
    'day', p_day,
    'arrived_at', (SELECT min(at) FROM roster_events WHERE child_id = ch.id AND service_date = p_day AND action = 'check_in'),
    'left_at', (SELECT max(at) FROM roster_events WHERE child_id = ch.id AND service_date = p_day AND action = 'check_out'),
    'entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'kind', e.kind, 'at', e.at, 'ends_at', e.ends_at,
               'details', e.details,
               'checks', CASE WHEN e.kind = 'nap' THEN (SELECT count(*) FROM child_daily_entries s
                                                         WHERE s.nap_id = e.id AND s.kind = 'sleep_check' AND s.voided_at IS NULL) END)
             ORDER BY e.at)
      FROM child_daily_entries e
      WHERE e.child_id = ch.id AND e.service_date = p_day AND e.voided_at IS NULL AND e.kind <> 'sleep_check'
        AND (e.kind <> 'photo' OR e.approved_at IS NOT NULL)), '[]'::jsonb),
    'recipients', COALESCE((
      SELECT jsonb_agg(DISTINCT lower(btrim(g.email)))
      FROM child_guardians g WHERE g.child_id = ch.id AND g.daily_report AND NULLIF(btrim(g.email), '') IS NOT NULL), '[]'::jsonb))
  FROM children ch JOIN centers c ON c.id = ch.center_id
  WHERE ch.id = p_child_id;
$$;

-- 5. The send route (service role only) ----------------------------------------------------------------------------
-- Claim due reports: queued and due, or stuck "sending" for 15 minutes. Centers with reports off are skipped.
CREATE OR REPLACE FUNCTION public.daily_reports_claim(p_limit integer DEFAULT 25)
RETURNS SETOF public.daily_report_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE daily_report_queue q SET status = 'skipped', updated_at = now(), last_error = 'Daily reports are off for this center'
  FROM centers c
  WHERE c.id = q.center_id AND NOT c.daily_reports_enabled AND q.status = 'queued' AND q.send_after <= now();

  RETURN QUERY
  UPDATE daily_report_queue q SET status = 'sending', attempts = q.attempts + 1, updated_at = now()
  WHERE q.id IN (
    SELECT id FROM daily_report_queue
    WHERE (status = 'queued' AND send_after <= now()) OR (status = 'sending' AND updated_at < now() - interval '15 minutes')
    ORDER BY send_after
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    FOR UPDATE SKIP LOCKED)
  RETURNING q.*;
END $$;

-- Record the result. A failure is retried in 15 minutes, up to 3 attempts in all.
CREATE OR REPLACE FUNCTION public.daily_report_finish(p_id uuid, p_ok boolean, p_recipients text[] DEFAULT '{}', p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE daily_report_queue SET
    status     = CASE WHEN p_ok THEN 'sent' WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
    send_after = CASE WHEN p_ok THEN send_after ELSE now() + interval '15 minutes' END,
    sent_at    = CASE WHEN p_ok THEN now() ELSE sent_at END,
    recipients = COALESCE(p_recipients, '{}'),
    last_error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END,
    updated_at = now()
  WHERE id = p_id AND status = 'sending';
END $$;

-- Nobody to send to (no guardian with an email and the switch on): not an error, nothing to retry
CREATE OR REPLACE FUNCTION public.daily_report_skip(p_id uuid, p_reason text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE daily_report_queue SET status = 'skipped', last_error = left(p_reason, 500), updated_at = now()
  WHERE id = p_id AND status = 'sending';
$$;

-- 6. Owners and admins -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.daily_report_preview(p_center_id uuid, p_child_id uuid, p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_confidential(p_center_id)
     OR NOT EXISTS (SELECT 1 FROM children WHERE id = p_child_id AND center_id = p_center_id) THEN
    RAISE EXCEPTION 'Only the owner and administrators can see daily reports.' USING ERRCODE = '42501';
  END IF;
  RETURN public.daily_report_data(p_child_id, p_day);
END $$;

-- Send (again) now: the day's report, as it stands
CREATE OR REPLACE FUNCTION public.daily_report_resend(p_center_id uuid, p_child_id uuid, p_day date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_confidential(p_center_id)
     OR NOT EXISTS (SELECT 1 FROM children WHERE id = p_child_id AND center_id = p_center_id) THEN
    RAISE EXCEPTION 'Only the owner and administrators can send daily reports.' USING ERRCODE = '42501';
  END IF;
  IF p_day IS NULL OR p_day > public.roster_today(p_center_id) OR p_day < public.roster_today(p_center_id) - 30 THEN
    RAISE EXCEPTION 'Pick a day in the last 30 days.' USING ERRCODE = '22023';
  END IF;
  IF NOT (SELECT daily_reports_enabled FROM centers WHERE id = p_center_id) THEN
    RAISE EXCEPTION 'Daily reports are turned off for your center. Turn them on from the Live roster.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO daily_report_queue (center_id, child_id, service_date, status, send_after, requested_by)
  VALUES (p_center_id, p_child_id, p_day, 'queued', now(), auth.uid())
  ON CONFLICT ON CONSTRAINT daily_report_queue_child_day DO UPDATE
    SET status = 'queued', send_after = now(), attempts = 0, last_error = NULL, requested_by = auth.uid(), updated_at = now()
    WHERE daily_report_queue.status <> 'sending';
END $$;

-- Center settings: reports on or off, and the early pick-up cutoff
CREATE OR REPLACE FUNCTION public.daily_report_settings(p_center_id uuid, p_enabled boolean DEFAULT NULL, p_early_pickup_before time DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.can_view_confidential(p_center_id) THEN
    RAISE EXCEPTION 'Only the owner and administrators can change daily report settings.' USING ERRCODE = '42501';
  END IF;
  IF p_early_pickup_before IS NOT NULL AND (p_early_pickup_before < '06:00' OR p_early_pickup_before > '20:00') THEN
    RAISE EXCEPTION 'Pick a cutoff between 6:00 AM and 8:00 PM.' USING ERRCODE = '22023';
  END IF;
  UPDATE centers SET daily_reports_enabled = COALESCE(p_enabled, daily_reports_enabled),
                     early_pickup_before = COALESCE(p_early_pickup_before, early_pickup_before)
  WHERE id = p_center_id
  RETURNING jsonb_build_object('enabled', daily_reports_enabled, 'early_pickup_before', to_char(early_pickup_before, 'HH24:MI'),
                               'reply_to', NULLIF(btrim(email), '')) INTO v;
  RETURN v;
END $$;

-- 7. Grants -----------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.roster_events_before_report() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.roster_events_after_report() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_report_data(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_reports_claim(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_report_finish(uuid, boolean, text[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_report_skip(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_report_data(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.daily_reports_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.daily_report_finish(uuid, boolean, text[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.daily_report_skip(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.daily_report_preview(uuid, uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_report_resend(uuid, uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daily_report_settings(uuid, boolean, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_report_preview(uuid, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_report_resend(uuid, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_report_settings(uuid, boolean, time) TO authenticated;

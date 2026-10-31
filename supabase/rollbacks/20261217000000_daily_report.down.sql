-- Rollback for 20261217000000_daily_report.sql. Deletes the report queue and its history.
DROP TRIGGER IF EXISTS trg_roster_events_after_report ON public.roster_events;
DROP TRIGGER IF EXISTS trg_roster_events_before_report ON public.roster_events;
DROP FUNCTION IF EXISTS public.daily_report_settings(uuid, boolean, time);
DROP FUNCTION IF EXISTS public.daily_report_resend(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.daily_report_preview(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.daily_report_skip(uuid, text);
DROP FUNCTION IF EXISTS public.daily_report_finish(uuid, boolean, text[], text);
DROP FUNCTION IF EXISTS public.daily_reports_claim(integer);
DROP FUNCTION IF EXISTS public.daily_report_data(uuid, date);
DROP FUNCTION IF EXISTS public.roster_events_after_report();
DROP FUNCTION IF EXISTS public.roster_events_before_report();
DROP TABLE IF EXISTS public.daily_report_queue;
ALTER TABLE public.child_guardians DROP COLUMN IF EXISTS daily_report;
ALTER TABLE public.centers DROP COLUMN IF EXISTS early_pickup_before;
ALTER TABLE public.centers DROP COLUMN IF EXISTS daily_reports_enabled;

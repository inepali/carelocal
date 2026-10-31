-- Run ONCE in the Supabase SQL editor (production project) to send parent daily reports every 5 minutes.
-- Not a migration on purpose: it holds the site URL and the cron secret, which differ per environment.
--
-- Before running:
--   1. Database → Extensions: turn on pg_cron and pg_net.
--   2. Replace the two values below: your site URL and the same CRON_SECRET that is set in Vercel.
--
-- Vercel Cron also calls the route once a day (vercel.json) as a safety net, so reports still go out if this
-- job is not set up, just later in the evening instead of about 10 minutes after pick-up.

-- The secret lives in Vault, not in the job text
SELECT vault.create_secret('REPLACE_WITH_CRON_SECRET', 'daily_reports_cron_secret', 'Bearer token for /api/cron/daily-reports');

SELECT cron.unschedule('daily-reports') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-reports');
SELECT cron.schedule(
  'daily-reports',
  '*/5 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://carelocal.co/api/cron/daily-reports',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'daily_reports_cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $$
);

-- Check it:   SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'daily-reports') ORDER BY start_time DESC LIMIT 5;
-- Responses:  SELECT status_code, content FROM net._http_response ORDER BY created DESC LIMIT 5;
-- Stop it:    SELECT cron.unschedule('daily-reports');

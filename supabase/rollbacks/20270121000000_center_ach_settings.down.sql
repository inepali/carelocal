-- Rollback for 20270121000000_center_ach_settings.sql: the per-center ACH settings and their event log go.
-- This deletes the stored (encrypted) SFTP and API secrets. Centers would need to enter them again.
DROP FUNCTION IF EXISTS public.center_ach_settings_log(uuid, text, text);
DROP FUNCTION IF EXISTS public.center_ach_settings_secrets(uuid, text);
DROP FUNCTION IF EXISTS public.center_ach_settings_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.center_ach_settings_get(uuid);
DROP FUNCTION IF EXISTS public.center_ach_settings_public(public.center_ach_settings);
DROP TABLE IF EXISTS public.center_ach_settings_events;
DROP TABLE IF EXISTS public.center_ach_settings;
DROP FUNCTION IF EXISTS public.billing_ach_sftp_done(uuid, text);
DROP FUNCTION IF EXISTS public.billing_ach_sftp_claim(uuid);
ALTER TABLE public.billing_ach_batches DROP COLUMN IF EXISTS sftp_file_name;
ALTER TABLE public.billing_ach_batches DROP COLUMN IF EXISTS sftp_claimed_at;

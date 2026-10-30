-- ============================================================
-- ROLLBACK for supabase/migrations/20261211000000_roster_attendance_export.sql
-- Removes the export functions. No data is stored by them, so nothing else changes. Run by hand.
-- ============================================================
BEGIN;

DROP FUNCTION IF EXISTS public.roster_moves_export(uuid, date, date);
DROP FUNCTION IF EXISTS public.roster_attendance(uuid, date, date, boolean);
DROP FUNCTION IF EXISTS public.roster_export_check(uuid, date, date);
DROP FUNCTION IF EXISTS public.roster_timezone(uuid);

DO $$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261211000000';
  END IF;
END $$;

COMMIT;

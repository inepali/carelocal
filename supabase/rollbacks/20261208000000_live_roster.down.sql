-- ============================================================
-- ROLLBACK for supabase/migrations/20261208000000_live_roster.sql
--
-- Undoes the Live Roster phase 1 migration and nothing else. Run it by hand in the SQL editor (or psql) only
-- when you mean to remove the roster. It is NOT a migration: it lives outside supabase/migrations so
-- `supabase db push` never runs it.
--
-- WHAT IS LOST: every roster check-in, check-out and move (roster_presence, roster_events), the room ratio
-- and age-range settings, child photo keys (the photo files stay in R2), staff home rooms and the per-center
-- roster switch. Nothing that existed before the migration is touched.
--
-- Runs in one transaction: it all goes, or nothing does.
-- ============================================================
BEGIN;

-- 1. Realtime
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'roster_presence') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.roster_presence;
  END IF;
END $$;

-- 2. Functions the app calls (before the tables they return)
DROP FUNCTION IF EXISTS public.roster_apply(uuid, uuid, uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.roster_room_status(uuid, date);
DROP FUNCTION IF EXISTS public.roster_snapshot(uuid, date);

-- 3. Tables (their policies and indexes go with them)
DROP TABLE IF EXISTS public.roster_events;
DROP TABLE IF EXISTS public.roster_presence;

-- 4. Helpers
DROP FUNCTION IF EXISTS public.can_use_roster(uuid);
DROP FUNCTION IF EXISTS public.is_center_regular_staff(uuid);
DROP FUNCTION IF EXISTS public.roster_today(uuid);
DROP FUNCTION IF EXISTS public.roster_age_months(date, date);

-- 5. Triggers and their functions
DROP TRIGGER IF EXISTS trg_guard_roster_flag ON public.centers;
DROP FUNCTION IF EXISTS public.guard_roster_flag();
DROP TRIGGER IF EXISTS trg_guard_center_staff_home_room ON public.center_staff;
DROP FUNCTION IF EXISTS public.guard_center_staff_home_room();
DROP TRIGGER IF EXISTS trg_check_child_photo_key ON public.children;
DROP FUNCTION IF EXISTS public.check_child_photo_key();

-- 6. Columns and constraints on existing tables
ALTER TABLE public.centers DROP COLUMN IF EXISTS roster_enabled;
ALTER TABLE public.center_staff DROP COLUMN IF EXISTS home_work_area_id;
ALTER TABLE public.children DROP COLUMN IF EXISTS photo_key;
ALTER TABLE public.work_areas DROP CONSTRAINT IF EXISTS work_areas_age_range_check;
ALTER TABLE public.work_areas DROP CONSTRAINT IF EXISTS work_areas_ratio_children_check;
ALTER TABLE public.work_areas DROP COLUMN IF EXISTS on_roster;
ALTER TABLE public.work_areas DROP COLUMN IF EXISTS max_age_months;
ALTER TABLE public.work_areas DROP COLUMN IF EXISTS min_age_months;
ALTER TABLE public.work_areas DROP COLUMN IF EXISTS ratio_children;

-- 7. Forget that the migration ran, so a fixed version can be pushed again later
DO $$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261208000000';
  END IF;
END $$;

COMMIT;

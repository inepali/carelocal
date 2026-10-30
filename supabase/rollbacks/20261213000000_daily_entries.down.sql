-- Rollback for 20261213000000_daily_entries.sql. Deletes every daily entry recorded so far.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'child_daily_entries') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.child_daily_entries;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.daily_day(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.daily_entry_void(uuid, text);
DROP FUNCTION IF EXISTS public.daily_class_entry(uuid, text, jsonb, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.daily_entry_add(uuid, uuid, text, jsonb, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.daily_person_label(uuid, uuid);
DROP FUNCTION IF EXISTS public.daily_check_write(uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.daily_details(text, jsonb);
DROP TABLE IF EXISTS public.child_daily_entries;

-- RESET: wipes everything CareLocal put in the "public" schema of a project, leaving it empty and ready for
-- full_schema.sql. Use it on a NEW project (carelocal-prod) after a wrong schema was loaded.
--
-- It does NOT touch sign-in users (auth), storage, or Supabase's own schemas.
-- NEVER run it on the development project: it deletes every table and row in "public".
--
-- Safety: it refuses to run if the centers table holds any rows, so it cannot wipe a database that is in use.

DO $$
DECLARE v_rows bigint := 0;
BEGIN
  IF to_regclass('public.centers') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.centers' INTO v_rows;
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'Refusing to reset: public.centers has % row(s). This is not an empty project.', v_rows;
    END IF;
  END IF;
END $$;

-- Sign-up triggers on auth.users point at public functions, so remove them first (full_schema.sql re-creates them)
DROP TRIGGER IF EXISTS on_auth_user_created_preferences ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created_settings ON auth.users;

-- Everything in public goes: tables, views, functions, types, policies, extensions installed there
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- Put back the standard Supabase access rules for a fresh public schema
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

-- Forget any migration history from the wrong load (mark_migrations_applied.sql re-creates it)
DO $$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'TRUNCATE supabase_migrations.schema_migrations';
  END IF;
END $$;

-- Check: should list nothing
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

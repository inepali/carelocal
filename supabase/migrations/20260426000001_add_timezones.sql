-- Add timezone column to centers table
ALTER TABLE centers ADD COLUMN IF NOT EXISTS timezone text;

-- Add timezone column to metro_areas table (if the table exists)
-- Checking if metro_areas exists first, it should exist based on types.ts
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'metro_areas') THEN
        ALTER TABLE metro_areas ADD COLUMN IF NOT EXISTS timezone text;
        ALTER TABLE metro_areas ADD COLUMN IF NOT EXISTS city text;
    END IF;
END $$;

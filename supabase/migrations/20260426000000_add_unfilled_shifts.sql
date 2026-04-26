-- Create the new 'unfilled' status
-- Note: Supabase migrations run in a transaction, and ALTER TYPE ADD VALUE cannot run inside a transaction block in older PG versions, 
-- but in PG 12+ it works if it's not in a transaction block, or we can use a workaround.
COMMIT;
ALTER TYPE shift_status ADD VALUE IF NOT EXISTS 'unfilled';
BEGIN;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;

-- Create an RPC function to mark unfilled shifts as archived
CREATE OR REPLACE FUNCTION archive_unfilled_shifts()
RETURNS integer AS $$
DECLARE
  updated_count integer;
BEGIN
  WITH updated AS (
    UPDATE shifts
    SET status = 'unfilled', is_archived = true
    WHERE status = 'open'
      AND (
        -- If the shift_date was before today (in Eastern Time)
        shift_date < (timezone('America/New_York', now())::date)
        OR
        -- If the shift_date is today, and the current time is 12:00 PM or later in Eastern Time
        (
          shift_date = (timezone('America/New_York', now())::date)
          AND
          extract(hour from timezone('America/New_York', now())) >= 12
        )
      )
    RETURNING id
  )
  SELECT count(*) INTO updated_count FROM updated;
  
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

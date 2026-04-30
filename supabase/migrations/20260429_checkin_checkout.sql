-- Add check_in_time and check_out_time to shift_claims
ALTER TABLE public.shift_claims
ADD COLUMN IF NOT EXISTS check_in_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS check_out_time TIMESTAMP WITH TIME ZONE;

-- Note: The shifts table already has a 'status' column which is text.
-- We will now use 'completed' as a valid status value alongside 'open' and 'filled'.

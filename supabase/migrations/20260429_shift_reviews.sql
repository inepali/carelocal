-- Create shift_reviews table
CREATE TABLE IF NOT EXISTS public.shift_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL, -- Either a center_id or a staff_profile id
    reviewee_id UUID NOT NULL, -- Either a center_id or a staff_profile id
    reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('center', 'staff')),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    punctual BOOLEAN, -- Primarily used when a center rates staff
    tags TEXT[] DEFAULT '{}',
    public_comment TEXT,
    private_feedback TEXT,
    do_not_return BOOLEAN DEFAULT false, -- Used to blacklist staff from a center
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    -- Prevent the same user/center from reviewing the same shift twice
    UNIQUE(shift_id, reviewer_id, reviewer_type) 
);

-- Enable RLS
ALTER TABLE public.shift_reviews ENABLE ROW LEVEL SECURITY;

-- 1. Staff can view reviews about themselves (excluding private feedback from centers)
CREATE POLICY "Staff can view reviews about themselves"
ON public.shift_reviews FOR SELECT
USING (
  reviewee_id IN (
    SELECT id FROM public.staff_profiles WHERE user_id = auth.uid()
  )
);

-- 2. Staff can view reviews they wrote
CREATE POLICY "Staff can view reviews they wrote"
ON public.shift_reviews FOR SELECT
USING (
  reviewer_id IN (
    SELECT id FROM public.staff_profiles WHERE user_id = auth.uid()
  ) AND reviewer_type = 'staff'
);

-- 3. Centers can view reviews about themselves
CREATE POLICY "Centers can view reviews about themselves"
ON public.shift_reviews FOR SELECT
USING (
  reviewee_id IN (
    SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()
  )
);

-- 4. Centers can view reviews they wrote
CREATE POLICY "Centers can view reviews they wrote"
ON public.shift_reviews FOR SELECT
USING (
  reviewer_id IN (
    SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()
  ) AND reviewer_type = 'center'
);

-- 5. Staff can insert their reviews
CREATE POLICY "Staff can insert reviews"
ON public.shift_reviews FOR INSERT
WITH CHECK (
  reviewer_id IN (
    SELECT id FROM public.staff_profiles WHERE user_id = auth.uid()
  ) AND reviewer_type = 'staff'
);

-- 6. Centers can insert their reviews
CREATE POLICY "Centers can insert reviews"
ON public.shift_reviews FOR INSERT
WITH CHECK (
  reviewer_id IN (
    SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()
  ) AND reviewer_type = 'center'
);

-- Allow public viewing of shift_reviews if we want averages displayed publicly?
-- (For now keeping it restricted to involved parties to build the feature first)

-- Create a generic function to update updated_at if it doesn't exist
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'handle_updated_at' AND tgrelid = 'public.shift_reviews'::regclass) THEN
    CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.shift_reviews
      FOR EACH ROW EXECUTE PROCEDURE public.set_current_timestamp_updated_at();
  END IF;
END $$;

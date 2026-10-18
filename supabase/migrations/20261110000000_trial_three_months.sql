-- The free trial is now 3 months for new centers. Existing centers keep the trial length they have.
ALTER TABLE public.centers ALTER COLUMN trial_months SET DEFAULT 3;

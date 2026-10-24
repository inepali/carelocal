-- Super admin can set how many active job postings each center may have, overriding the plan's default.
--   NULL        use the plan's default (trial 1, Starter 2, Growth 5, Network and up unlimited)
--   0 or more   exactly that many active (published or paused) jobs
--   -1          unlimited
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS job_limit_override integer;
ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_job_limit_override_check;
ALTER TABLE public.centers ADD CONSTRAINT centers_job_limit_override_check
  CHECK (job_limit_override IS NULL OR job_limit_override BETWEEN -1 AND 1000);

-- Only a super admin (or the server) can change it; a center cannot raise its own limit
CREATE OR REPLACE FUNCTION public.guard_job_limit_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.job_limit_override IS NOT DISTINCT FROM OLD.job_limit_override THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.job_limit_override := OLD.job_limit_override;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.guard_job_limit_override() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_job_limit_override ON public.centers;
CREATE TRIGGER trg_guard_job_limit_override
  BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_job_limit_override();

-- The limit the publish check uses: the override when there is one, else the plan's default (NULL = unlimited)
CREATE OR REPLACE FUNCTION public.job_post_limit(p_center_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN c.job_limit_override = -1 THEN NULL
    WHEN c.job_limit_override IS NOT NULL THEN c.job_limit_override
    WHEN c.subscription_status::text = 'trialing' THEN 1
    WHEN c.subscription_tier::text = 'starter' THEN 2
    WHEN c.subscription_tier::text = 'growth' THEN 5
    ELSE NULL                                        -- network / enterprise: unlimited
  END
  FROM centers c WHERE c.id = p_center_id;
$$;

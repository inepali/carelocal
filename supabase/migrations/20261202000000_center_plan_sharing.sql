-- Plan sharing between centers.
--
-- A center on a paid Growth or Network plan (the PRIMARY) can share it with other centers (SECONDARIES):
-- Growth covers 3 centers in all, Network 10, Enterprise unlimited. Every center stays fully independent
-- (its own admins, staff, children and documents; linking shares no data); a secondary only takes its plan
-- from the primary. Only the primary has a Stripe subscription.
--
-- - Linking is by a one-time invite code: the primary's owner creates it, the secondary's owner accepts it.
-- - The primary's owner can remove a secondary, and a secondary's owner can leave.
-- - When the primary's plan lapses (cancelled, unpaid, downgraded to Starter, or the center is deleted), its
--   secondaries keep the plan for 30 days. A downgrade to fewer centers unlinks the most recently linked
--   extras, also with 30 days' grace.
-- - Plan columns can only be changed by the server (Stripe webhook / service role), a super admin, or the
--   functions below. Before this, a center admin could update its own subscription_tier from the browser.

-- ── Columns ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS primary_center_id uuid REFERENCES public.centers(id) ON DELETE SET NULL;
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS linked_at timestamptz;
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS shared_grace_tier public.subscription_tier;
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS shared_grace_until timestamptz;

ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_primary_not_self;
ALTER TABLE public.centers ADD CONSTRAINT centers_primary_not_self CHECK (primary_center_id IS DISTINCT FROM id);

CREATE INDEX IF NOT EXISTS centers_primary_center_id_idx ON public.centers (primary_center_id) WHERE primary_center_id IS NOT NULL;

-- Invite codes are reached only through the functions below
CREATE TABLE IF NOT EXISTS public.center_link_invites (
  code              text PRIMARY KEY,
  primary_center_id uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT now() + interval '7 days',
  used_at           timestamptz,
  used_by_center_id uuid REFERENCES public.centers(id) ON DELETE SET NULL
);
ALTER TABLE public.center_link_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.center_link_invites FROM PUBLIC, anon, authenticated;

-- ── Plan rules (change the numbers here and nowhere else) ────────────────────────────────────────────────
-- How many centers a plan covers, counting the primary. NULL = unlimited.
CREATE OR REPLACE FUNCTION public.plan_center_cap(p_tier public.subscription_tier)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tier::text WHEN 'growth' THEN 3 WHEN 'network' THEN 10 WHEN 'enterprise' THEN NULL ELSE 1 END;
$$;

-- Only a paid Growth, Network or Enterprise plan in good standing can be shared
CREATE OR REPLACE FUNCTION public.plan_can_share(p_tier public.subscription_tier, p_status public.subscription_status)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_tier::text IN ('growth', 'network', 'enterprise') AND p_status::text IN ('active', 'trialing');
$$;

-- A center's own plan is paid (as opposed to the free trial or a lapsed plan)
CREATE OR REPLACE FUNCTION public.plan_is_paid(p_tier public.subscription_tier, p_status public.subscription_status)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_tier::text <> 'trial' AND p_status::text IN ('active', 'trialing', 'past_due');
$$;

-- ── The plan a center actually gets ──────────────────────────────────────────────────────────────────────
-- source: 'primary' (shared from its primary), 'grace' (shared plan ended, 30 days left), or 'own'
CREATE OR REPLACE FUNCTION public.center_effective_plan(p_center_id uuid)
RETURNS TABLE (tier public.subscription_tier, status public.subscription_status, source text, grace_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    CASE x.source WHEN 'primary' THEN p.subscription_tier WHEN 'grace' THEN c.shared_grace_tier ELSE c.subscription_tier END,
    CASE x.source WHEN 'primary' THEN p.subscription_status WHEN 'grace' THEN 'active'::public.subscription_status ELSE c.subscription_status END,
    x.source,
    CASE WHEN x.source = 'grace' THEN c.shared_grace_until END
  FROM public.centers c
  LEFT JOIN public.centers p ON p.id = c.primary_center_id
  CROSS JOIN LATERAL (SELECT CASE
    WHEN p.id IS NOT NULL AND public.plan_can_share(p.subscription_tier, p.subscription_status) THEN 'primary'
    WHEN public.plan_is_paid(c.subscription_tier, c.subscription_status) THEN 'own'
    WHEN c.shared_grace_until > now() AND c.shared_grace_tier IS NOT NULL THEN 'grace'
    ELSE 'own'
  END AS source) x
  WHERE c.id = p_center_id;
$$;
REVOKE ALL ON FUNCTION public.center_effective_plan(uuid) FROM PUBLIC, anon, authenticated;

-- ── Limits now follow the effective plan ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.job_post_limit(p_center_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN c.job_limit_override = -1 THEN NULL
    WHEN c.job_limit_override IS NOT NULL THEN c.job_limit_override
    WHEN e.tier::text = 'trial' OR e.status::text = 'trialing' THEN 1
    WHEN e.tier::text = 'starter' THEN 2
    WHEN e.tier::text = 'growth' THEN 5
    ELSE NULL                                        -- network / enterprise: unlimited
  END
  FROM centers c CROSS JOIN LATERAL public.center_effective_plan(c.id) e
  WHERE c.id = p_center_id;
$$;
REVOKE ALL ON FUNCTION public.job_post_limit(uuid) FROM PUBLIC, anon;

-- Trial centers have everything; Starter is capped; Growth and above are unlimited.
CREATE OR REPLACE FUNCTION public.child_limit(p_center_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN e.status::text = 'trialing' THEN NULL
    WHEN e.tier::text = 'starter' THEN 25
    ELSE NULL
  END FROM public.center_effective_plan(p_center_id) e;
$$;
REVOKE ALL ON FUNCTION public.child_limit(uuid) FROM PUBLIC, anon, authenticated;

-- ── Guard: plan columns are not editable from the browser ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_center_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;                                      -- server / service role
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  IF current_setting('carelocal.plan_write', true) = 'on' THEN RETURN NEW; END IF;  -- the functions below

  IF TG_OP = 'INSERT' THEN
    -- A new center always starts on the free trial
    NEW.subscription_tier := 'trial';
    NEW.subscription_status := 'trialing';
    NEW.trial_months := 3;
    NEW.trial_started_at := now();
    NEW.primary_center_id := NULL;
    NEW.linked_at := NULL;
    NEW.shared_grace_tier := NULL;
    NEW.shared_grace_until := NULL;
    RETURN NEW;
  END IF;

  NEW.subscription_tier := OLD.subscription_tier;
  NEW.subscription_status := OLD.subscription_status;
  NEW.trial_months := OLD.trial_months;
  NEW.trial_started_at := OLD.trial_started_at;
  NEW.primary_center_id := OLD.primary_center_id;
  NEW.linked_at := OLD.linked_at;
  NEW.shared_grace_tier := OLD.shared_grace_tier;
  NEW.shared_grace_until := OLD.shared_grace_until;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.guard_center_plan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_center_plan ON public.centers;
CREATE TRIGGER trg_guard_center_plan
  BEFORE INSERT OR UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_center_plan();

-- ── When a plan changes, its secondaries follow ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.center_plan_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_was boolean := public.plan_can_share(OLD.subscription_tier, OLD.subscription_status);
  v_now boolean := public.plan_can_share(NEW.subscription_tier, NEW.subscription_status);
  v_cap integer;
BEGIN
  PERFORM set_config('carelocal.plan_write', 'on', true);

  IF v_was AND NOT v_now THEN
    -- Lapsed: secondaries keep the plan for 30 days and stay linked, so a renewal restores it
    UPDATE public.centers
       SET shared_grace_tier = OLD.subscription_tier, shared_grace_until = now() + interval '30 days'
     WHERE primary_center_id = NEW.id;
  ELSIF v_now THEN
    UPDATE public.centers SET shared_grace_tier = NULL, shared_grace_until = NULL
     WHERE primary_center_id = NEW.id AND shared_grace_until IS NOT NULL;

    -- A plan for fewer centers: the most recently linked extras leave, with 30 days' grace
    v_cap := public.plan_center_cap(NEW.subscription_tier);
    IF v_cap IS NOT NULL THEN
      UPDATE public.centers
         SET primary_center_id = NULL, linked_at = NULL,
             shared_grace_tier = COALESCE(OLD.subscription_tier, NEW.subscription_tier),
             shared_grace_until = now() + interval '30 days'
       WHERE id IN (
         SELECT id FROM public.centers WHERE primary_center_id = NEW.id
          ORDER BY linked_at ASC NULLS LAST OFFSET GREATEST(v_cap - 1, 0)
       );
    END IF;
  END IF;

  -- A secondary that starts its own paid plan no longer needs the shared one
  IF NEW.primary_center_id IS NOT NULL AND public.plan_is_paid(NEW.subscription_tier, NEW.subscription_status)
     AND NOT public.plan_is_paid(OLD.subscription_tier, OLD.subscription_status) THEN
    UPDATE public.centers SET primary_center_id = NULL, linked_at = NULL, shared_grace_tier = NULL, shared_grace_until = NULL
     WHERE id = NEW.id;
  END IF;

  PERFORM set_config('carelocal.plan_write', 'off', true);
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.center_plan_changed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_center_plan_changed ON public.centers;
CREATE TRIGGER trg_center_plan_changed
  AFTER UPDATE OF subscription_tier, subscription_status ON public.centers
  FOR EACH ROW
  WHEN (OLD.subscription_tier IS DISTINCT FROM NEW.subscription_tier OR OLD.subscription_status IS DISTINCT FROM NEW.subscription_status)
  EXECUTE FUNCTION public.center_plan_changed();

-- A deleted primary: its secondaries get the same 30 days (the foreign key then unlinks them)
CREATE OR REPLACE FUNCTION public.center_primary_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.plan_can_share(OLD.subscription_tier, OLD.subscription_status) THEN
    PERFORM set_config('carelocal.plan_write', 'on', true);
    UPDATE public.centers
       SET shared_grace_tier = OLD.subscription_tier, shared_grace_until = now() + interval '30 days'
     WHERE primary_center_id = OLD.id;
    PERFORM set_config('carelocal.plan_write', 'off', true);
  END IF;
  RETURN OLD;
END $$;
REVOKE EXECUTE ON FUNCTION public.center_primary_deleted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_center_primary_deleted ON public.centers;
CREATE TRIGGER trg_center_primary_deleted
  BEFORE DELETE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.center_primary_deleted();

-- ── Called from the app ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_center_owner(p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role = 'owner');
$$;
REVOKE ALL ON FUNCTION public.is_center_owner(uuid) FROM PUBLIC, anon, authenticated;

-- Everything the Subscription tab shows. Any admin of the center may read it; invite codes only for the owner.
CREATE OR REPLACE FUNCTION public.center_plan_summary(p_center_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.centers;
  p public.centers;
  e record;
  v_owner boolean;
  v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id) THEN
    RAISE EXCEPTION 'Center not found or you do not have access to it.';
  END IF;
  SELECT * INTO c FROM centers WHERE id = p_center_id;
  SELECT * INTO p FROM centers WHERE id = c.primary_center_id;
  SELECT * INTO e FROM public.center_effective_plan(p_center_id);
  v_owner := public.is_center_owner(p_center_id);
  -- Centers covered by the plan this center is part of, counting the primary
  v_count := 1 + (SELECT count(*) FROM centers WHERE primary_center_id = COALESCE(p.id, c.id));

  RETURN jsonb_build_object(
    'tier', e.tier,
    'status', e.status,
    'source', e.source,
    'grace_until', e.grace_until,
    'own_tier', c.subscription_tier,
    'is_owner', v_owner,
    'can_share', c.primary_center_id IS NULL AND public.plan_can_share(c.subscription_tier, c.subscription_status),
    'centers_used', v_count,
    'centers_cap', public.plan_center_cap(COALESCE(CASE WHEN e.source = 'primary' THEN p.subscription_tier END, c.subscription_tier)),
    'primary', CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id', p.id, 'name', p.name) END,
    'secondaries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'linked_at', s.linked_at) ORDER BY s.linked_at)
        FROM centers s WHERE s.primary_center_id = c.id), '[]'::jsonb),
    'invites', CASE WHEN v_owner THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('code', i.code, 'expires_at', i.expires_at) ORDER BY i.created_at DESC)
        FROM center_link_invites i
       WHERE i.primary_center_id = c.id AND i.used_at IS NULL AND i.expires_at > now()), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END $$;

-- The primary's owner makes a one-time code (valid 7 days) for another center to join its plan
CREATE OR REPLACE FUNCTION public.create_center_link_invite(p_center_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.centers;
  v_cap integer;
  v_code text;
  v_expires timestamptz;
BEGIN
  IF NOT public.is_center_owner(p_center_id) THEN
    RAISE EXCEPTION 'Only the center owner can add centers to the plan.';
  END IF;
  SELECT * INTO c FROM centers WHERE id = p_center_id FOR UPDATE;
  IF c.primary_center_id IS NOT NULL THEN
    RAISE EXCEPTION 'This center is on another center''s plan, so it cannot add centers of its own.';
  END IF;
  IF NOT public.plan_can_share(c.subscription_tier, c.subscription_status) THEN
    RAISE EXCEPTION 'Adding centers needs a paid Growth or Network plan.';
  END IF;
  v_cap := public.plan_center_cap(c.subscription_tier);
  IF v_cap IS NOT NULL AND 1 + (SELECT count(*) FROM centers WHERE primary_center_id = c.id) >= v_cap THEN
    RAISE EXCEPTION 'Your plan covers % centers and all are in use. Upgrade to add more.', v_cap;
  END IF;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
  INSERT INTO center_link_invites (code, primary_center_id, created_by)
  VALUES (v_code, c.id, auth.uid())
  RETURNING expires_at INTO v_expires;
  RETURN jsonb_build_object('code', v_code, 'expires_at', v_expires);
END $$;

-- The secondary's owner accepts a code: their center joins the primary's plan
CREATE OR REPLACE FUNCTION public.accept_center_link_invite(p_center_id uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i public.center_link_invites;
  c public.centers;
  p public.centers;
  v_cap integer;
BEGIN
  IF NOT public.is_center_owner(p_center_id) THEN
    RAISE EXCEPTION 'Only the center owner can join another center''s plan.';
  END IF;

  SELECT * INTO i FROM center_link_invites WHERE code = upper(trim(p_code)) FOR UPDATE;
  IF i.code IS NULL OR i.used_at IS NOT NULL OR i.expires_at <= now() THEN
    RAISE EXCEPTION 'That code is not valid or has expired. Ask the other center for a new one.';
  END IF;
  IF i.primary_center_id = p_center_id THEN
    RAISE EXCEPTION 'That code is for your own center. Share it with the center you want to add.';
  END IF;

  -- Lock both centers in a fixed order so two joins cannot overfill the plan
  PERFORM 1 FROM centers WHERE id IN (p_center_id, i.primary_center_id) ORDER BY id FOR UPDATE;
  SELECT * INTO c FROM centers WHERE id = p_center_id;
  SELECT * INTO p FROM centers WHERE id = i.primary_center_id;

  IF c.primary_center_id IS NOT NULL THEN
    RAISE EXCEPTION 'This center is already on another center''s plan. Leave that plan first.';
  END IF;
  IF EXISTS (SELECT 1 FROM centers WHERE primary_center_id = c.id) THEN
    RAISE EXCEPTION 'This center shares its own plan with other centers, so it cannot join another plan.';
  END IF;
  IF public.plan_is_paid(c.subscription_tier, c.subscription_status) THEN
    RAISE EXCEPTION 'This center has its own paid plan. Cancel it under Manage Subscription first, so you are not billed twice.';
  END IF;
  IF c.domain_key IS DISTINCT FROM p.domain_key THEN
    RAISE EXCEPTION 'Centers can only share a plan on the same CareLocal site.';
  END IF;
  IF p.primary_center_id IS NOT NULL OR NOT public.plan_can_share(p.subscription_tier, p.subscription_status) THEN
    RAISE EXCEPTION 'That center''s plan can no longer be shared.';
  END IF;
  v_cap := public.plan_center_cap(p.subscription_tier);
  IF v_cap IS NOT NULL AND 1 + (SELECT count(*) FROM centers WHERE primary_center_id = p.id) >= v_cap THEN
    RAISE EXCEPTION 'That center''s plan has no free spots left.';
  END IF;

  PERFORM set_config('carelocal.plan_write', 'on', true);
  UPDATE centers SET primary_center_id = p.id, linked_at = now(), shared_grace_tier = NULL, shared_grace_until = NULL
   WHERE id = c.id;
  PERFORM set_config('carelocal.plan_write', 'off', true);
  UPDATE center_link_invites SET used_at = now(), used_by_center_id = c.id WHERE code = i.code;

  RETURN jsonb_build_object('primary_name', p.name, 'tier', p.subscription_tier);
END $$;

-- Unlink a secondary. Its own owner can leave (no grace: their choice); the primary's owner can remove it
-- (30 days' grace, so the center has time to choose a plan).
CREATE OR REPLACE FUNCTION public.unlink_center(p_center_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.centers;
  p public.centers;
BEGIN
  SELECT * INTO c FROM centers WHERE id = p_center_id FOR UPDATE;
  IF c.id IS NULL OR c.primary_center_id IS NULL THEN
    RAISE EXCEPTION 'That center is not on a shared plan.';
  END IF;
  SELECT * INTO p FROM centers WHERE id = c.primary_center_id;

  PERFORM set_config('carelocal.plan_write', 'on', true);
  IF public.is_center_owner(c.id) THEN
    UPDATE centers SET primary_center_id = NULL, linked_at = NULL, shared_grace_tier = NULL, shared_grace_until = NULL
     WHERE id = c.id;
  ELSIF public.is_center_owner(p.id) THEN
    UPDATE centers SET primary_center_id = NULL, linked_at = NULL,
           shared_grace_tier = CASE WHEN public.plan_can_share(p.subscription_tier, p.subscription_status) THEN p.subscription_tier ELSE c.shared_grace_tier END,
           shared_grace_until = CASE WHEN public.plan_can_share(p.subscription_tier, p.subscription_status) THEN now() + interval '30 days' ELSE c.shared_grace_until END
     WHERE id = c.id;
  ELSE
    PERFORM set_config('carelocal.plan_write', 'off', true);
    RAISE EXCEPTION 'Only the owner of either center can remove it from the plan.';
  END IF;
  PERFORM set_config('carelocal.plan_write', 'off', true);
END $$;

REVOKE ALL ON FUNCTION public.center_plan_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_center_link_invite(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_center_link_invite(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_center(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.center_plan_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_center_link_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_center_link_invite(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_center(uuid) TO authenticated;

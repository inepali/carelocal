-- ============================================================
-- Care Score: "ask for a review" links (plan: claude/care-score-plan.md)
--  * Every center (made by an owner or admin) and every staff member (teachers included) gets a personal link
--    /r/<code> (also as a QR code) to ask others for a review. Rotating makes a new code and turns the old one off;
--    links expire after 180 days.
--  * Who may review from a link, checked here, never in the browser:
--      center's link  -> its staff: employed there (active), or worked a confirmed shift there in the last 180 days
--                        (parents are sent to the parent portal, which has its own rules)
--      staff's link   -> admins of a center the person works or worked at (as that center)
--                     -> coworkers: another staff member at a center where both work or worked (new source 'peer')
--  * Link reviews have no shift: one per reviewer per subject every 90 days, editable for 48 hours, shown at once
--    (the subject asked for them), personal-info hold applies. Trust: center/staff 0.9, coworkers 0.7.
--  * Coworker reviews count toward a staff member's Care Score and show as "Sam L. · Floater · Sunrise KA".
-- ============================================================

-- 1. Columns and rules ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.care_review_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE CHECK (code ~ '^[0-9a-hjkmnp-tv-z]{12}$'),
  subject_type  text NOT NULL CHECK (subject_type IN ('center', 'staff')),
  subject_id    uuid NOT NULL,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '180 days',
  revoked_at    timestamptz,
  uses          integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS care_review_links_subject_idx ON public.care_review_links (subject_type, subject_id) WHERE revoked_at IS NULL;
ALTER TABLE public.care_review_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.care_review_links FROM anon, authenticated;
GRANT ALL ON public.care_review_links TO service_role;

ALTER TABLE public.shift_reviews
  ADD COLUMN IF NOT EXISTS request_link_id   uuid REFERENCES public.care_review_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS context_center_id uuid REFERENCES public.centers(id) ON DELETE SET NULL;

ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_reviewer_type_check;
ALTER TABLE public.shift_reviews ADD CONSTRAINT shift_reviews_reviewer_type_check
  CHECK (reviewer_type IN ('center', 'staff', 'parent', 'peer'));
-- Shift reviews have a shift. Parent reviews never do. Peer reviews and the shiftless center/staff reviews come
-- from a link (request_link_id may later be null if a link row is ever removed, so only "no shift" is enforced).
ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_shift_required;
ALTER TABLE public.shift_reviews ADD CONSTRAINT shift_reviews_shift_required
  CHECK (CASE reviewer_type WHEN 'parent' THEN shift_id IS NULL
                            WHEN 'peer'   THEN shift_id IS NULL AND context_center_id IS NOT NULL
                            ELSE shift_id IS NOT NULL OR context_center_id IS NOT NULL END);

-- Authors read their own reviews of any kind (the older policies only cover 'staff' and 'center' reviewer types)
DROP POLICY IF EXISTS "Authors can view own reviews" ON public.shift_reviews;
CREATE POLICY "Authors can view own reviews" ON public.shift_reviews
  FOR SELECT TO authenticated USING (author_user_id = auth.uid());

-- 2. Helpers ------------------------------------------------------------------------------------
-- Who a review is about: centers and coworkers review staff; staff and parents review centers
CREATE OR REPLACE FUNCTION public.care_subject_type(p_reviewer_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_reviewer_type IN ('center', 'peer') THEN 'staff' ELSE 'center' END;
$$;
CREATE OR REPLACE FUNCTION public.care_reviewer_types(p_subject_type text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_subject_type WHEN 'staff' THEN ARRAY['center', 'peer'] ELSE ARRAY['staff', 'parent'] END;
$$;

CREATE OR REPLACE FUNCTION public.care_sub_rating_keys(p_reviewer_type text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_reviewer_type
    WHEN 'center' THEN ARRAY['punctuality', 'ratio_compliance', 'communication', 'classroom_readiness']
    WHEN 'staff'  THEN ARRAY['organization', 'support', 'onboarding', 'would_return']
    WHEN 'parent' THEN ARRAY['communication', 'safety', 'learning', 'caring_staff']
    WHEN 'peer'   THEN ARRAY['teamwork', 'reliability', 'communication', 'classroom_skills']
    ELSE '{}'::text[] END;
$$;

-- A staff member works at a center (active), or worked a confirmed shift there in the last 180 days
CREATE OR REPLACE FUNCTION public.care_staff_at_center(p_staff_id uuid, p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_staff cs WHERE cs.staff_id = p_staff_id AND cs.center_id = p_center_id AND cs.status = 'active')
      OR EXISTS (SELECT 1 FROM shift_claims sc JOIN shifts s ON s.id = sc.shift_id
                 WHERE sc.staff_id = p_staff_id AND s.center_id = p_center_id AND sc.status = 'confirmed'
                   AND s.shift_date > current_date - 180 AND (sc.check_out_time IS NOT NULL OR s.shift_date < current_date));
$$;

-- "Maria G." / "Teacher"
CREATE OR REPLACE FUNCTION public.care_staff_display(p_staff_id uuid, OUT name text, OUT role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT trim(sp.first_name || ' ' || left(COALESCE(sp.last_name, ''), 1) || CASE WHEN COALESCE(sp.last_name, '') <> '' THEN '.' ELSE '' END),
         COALESCE(initcap(sp.staff_type::text), 'Staff')
  FROM staff_profiles sp WHERE sp.id = p_staff_id;
$$;

-- The signed-in admin as shown on a center's review: name and role at that center
CREATE OR REPLACE FUNCTION public.care_center_author(p_center_id uuid, p_user_id uuid, OUT name text, OUT role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
           NULLIF(trim(sp.first_name || ' ' || left(COALESCE(sp.last_name, ''), 1) || CASE WHEN COALESCE(sp.last_name, '') <> '' THEN '.' ELSE '' END), ''),
           NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
           'Center admin'),
         COALESCE(
           CASE cs.center_role WHEN 'owner' THEN 'Owner' WHEN 'director' THEN 'Director'
                               WHEN 'assistant_director' THEN 'Assistant Director' END,
           CASE ca.role WHEN 'owner' THEN 'Owner' ELSE 'Administrator' END)
  FROM center_admins ca
  LEFT JOIN auth.users u ON u.id = ca.user_id
  LEFT JOIN staff_profiles sp ON sp.user_id = ca.user_id
  LEFT JOIN center_staff cs ON cs.staff_id = sp.id AND cs.center_id = ca.center_id
  WHERE ca.center_id = p_center_id AND ca.user_id = p_user_id
  LIMIT 1;
$$;

-- 12 characters from the parent-portal alphabet (no i, l, o, u), from random UUID bytes
CREATE OR REPLACE FUNCTION public.care_review_new_code()
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  a bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  k text := '';
  i integer;
BEGIN
  FOR i IN 0..11 LOOP
    k := k || substr('0123456789abcdefghjkmnpqrstvwxyz', 1 + (get_byte(CASE WHEN i < 6 THEN a ELSE b END, i % 6) % 32), 1);
  END LOOP;
  RETURN k;
END $$;

-- 3. Existing functions, now aware of coworker ('peer') and link reviews --------------------------
CREATE OR REPLACE FUNCTION public.guard_shift_review()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_ended     timestamptz;
  v_center_id uuid;
  v_staff_id  uuid;
  v_claim     record;
  v_counter   uuid;
BEGIN
  -- Internal reveal (from this trigger), service role / server jobs (no signed-in user) and super admins.
  -- care_review_link_submit() checks its own rules (relationship, 90 days, 48-hour edits) and sets the RPC flag.
  IF current_setting('carelocal.care_review_internal', true) = 'on'
     OR current_setting('carelocal.care_review_rpc', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF v_uid IS NULL OR public.is_super_admin() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.reveal_at := COALESCE(NEW.reveal_at, now());
      NEW.locked_at := COALESCE(NEW.locked_at, now());
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.reviewer_type = 'center' THEN
      v_center_id := NEW.reviewer_id; v_staff_id := NEW.reviewee_id;
      IF NOT public.is_center_admin(v_center_id) THEN
        RAISE EXCEPTION 'Only an admin of this center can review for it' USING ERRCODE = '42501';
      END IF;
    ELSE
      v_center_id := NEW.reviewee_id; v_staff_id := NEW.reviewer_id;
      IF NOT EXISTS (SELECT 1 FROM staff_profiles WHERE id = v_staff_id AND user_id = v_uid) THEN
        RAISE EXCEPTION 'You can only review as yourself' USING ERRCODE = '42501';
      END IF;
    END IF;

    -- The pair must have actually worked this shift together.
    SELECT sc.* INTO v_claim
    FROM shift_claims sc JOIN shifts s ON s.id = sc.shift_id
    WHERE sc.shift_id = NEW.shift_id AND sc.staff_id = v_staff_id AND s.center_id = v_center_id
      AND sc.status = 'confirmed'
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reviews are only for shifts you worked together' USING ERRCODE = '42501';
    END IF;

    v_ended := COALESCE(v_claim.check_out_time, public.shift_ends_at(NEW.shift_id));
    IF v_claim.check_out_time IS NULL AND public.shift_ends_at(NEW.shift_id) > now() THEN
      RAISE EXCEPTION 'You can review this shift once it has ended' USING ERRCODE = '22023';
    END IF;
    IF now() > v_ended + public.care_review_window() THEN
      RAISE EXCEPTION 'The review window for this shift has closed' USING ERRCODE = '22023';
    END IF;

    -- Attribution, captured at write time.
    NEW.author_user_id := v_uid;
    IF NEW.reviewer_type = 'center' THEN
      SELECT COALESCE(
               NULLIF(trim(sp.first_name || ' ' || left(COALESCE(sp.last_name, ''), 1) || CASE WHEN COALESCE(sp.last_name, '') <> '' THEN '.' ELSE '' END), ''),
               NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
               'Center admin'),
             COALESCE(
               CASE cs.center_role WHEN 'owner' THEN 'Owner' WHEN 'director' THEN 'Director'
                                   WHEN 'assistant_director' THEN 'Assistant Director' END,
               CASE ca.role WHEN 'owner' THEN 'Owner' ELSE 'Administrator' END)
        INTO NEW.author_name, NEW.author_role
      FROM center_admins ca
      LEFT JOIN auth.users u ON u.id = ca.user_id
      LEFT JOIN staff_profiles sp ON sp.user_id = ca.user_id
      LEFT JOIN center_staff cs ON cs.staff_id = sp.id AND cs.center_id = ca.center_id
      WHERE ca.center_id = v_center_id AND ca.user_id = v_uid
      LIMIT 1;
    ELSE
      SELECT trim(sp.first_name || ' ' || left(COALESCE(sp.last_name, ''), 1) || CASE WHEN COALESCE(sp.last_name, '') <> '' THEN '.' ELSE '' END),
             COALESCE(initcap(sp.staff_type::text), 'Staff')
        INTO NEW.author_name, NEW.author_role
      FROM staff_profiles sp WHERE sp.id = v_staff_id;
    END IF;

    -- Client cannot set these.
    NEW.trust := 1.00;
    NEW.hidden_at := NULL; NEW.hidden_by := NULL; NEW.hidden_reason := NULL;
    NEW.edit_history := '[]'::jsonb;
    NEW.locked_at := now() + interval '48 hours';

    -- Double-blind: hidden until the other side reviews or the window closes.
    SELECT id INTO v_counter FROM shift_reviews
    WHERE shift_id = NEW.shift_id AND reviewer_id = NEW.reviewee_id AND reviewee_id = NEW.reviewer_id
      AND reviewer_type <> NEW.reviewer_type;
    IF v_counter IS NOT NULL THEN
      NEW.reveal_at := now();
      PERFORM set_config('carelocal.care_review_internal', 'on', true);
      UPDATE shift_reviews SET reveal_at = now() WHERE id = v_counter AND reveal_at > now();
      PERFORM set_config('carelocal.care_review_internal', 'off', true);
    ELSE
      NEW.reveal_at := v_ended + public.care_review_window();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE by the author: only the content, only while unlocked.
  IF OLD.author_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the author can edit this review' USING ERRCODE = '42501';
  END IF;
  IF OLD.locked_at <= now() THEN
    RAISE EXCEPTION 'This review can no longer be edited' USING ERRCODE = '22023';
  END IF;
  IF (NEW.shift_id, NEW.reviewer_id, NEW.reviewee_id, NEW.reviewer_type) IS DISTINCT FROM
     (OLD.shift_id, OLD.reviewer_id, OLD.reviewee_id, OLD.reviewer_type) THEN
    RAISE EXCEPTION 'A review cannot be moved to another shift or person' USING ERRCODE = '22023';
  END IF;
  NEW.author_user_id := OLD.author_user_id; NEW.author_name := OLD.author_name; NEW.author_role := OLD.author_role;
  NEW.reveal_at := OLD.reveal_at; NEW.locked_at := OLD.locked_at; NEW.trust := OLD.trust;
  NEW.hidden_at := OLD.hidden_at; NEW.hidden_by := OLD.hidden_by; NEW.hidden_reason := OLD.hidden_reason;
  NEW.created_at := OLD.created_at;
  IF (NEW.rating, NEW.tags, NEW.public_comment, NEW.private_feedback, NEW.punctual, NEW.do_not_return) IS DISTINCT FROM
     (OLD.rating, OLD.tags, OLD.public_comment, OLD.private_feedback, OLD.punctual, OLD.do_not_return) THEN
    NEW.edit_history := OLD.edit_history || jsonb_build_array(jsonb_build_object(
      'edited_at', now(), 'rating', OLD.rating, 'tags', OLD.tags, 'public_comment', OLD.public_comment,
      'private_feedback', OLD.private_feedback, 'punctual', OLD.punctual, 'do_not_return', OLD.do_not_return));
  ELSE
    NEW.edit_history := OLD.edit_history;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.shift_review_pii_hold()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_center uuid := CASE NEW.reviewer_type WHEN 'center' THEN NEW.reviewer_id WHEN 'peer' THEN NEW.context_center_id ELSE NEW.reviewee_id END;
  v_found  text[];
  v_kept   text[];
BEGIN
  IF current_setting('carelocal.care_review_internal', true) = 'on' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
    NEW.held_at := NULL; NEW.held_reasons := '{}';   -- clients cannot pre-set a hold
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Moderation (service role / super admin) may set or clear the hold directly.
    IF auth.uid() IS NULL OR public.is_super_admin() THEN
      IF NEW.public_comment IS NOT DISTINCT FROM OLD.public_comment THEN RETURN NEW; END IF;
    ELSE
      NEW.held_at := OLD.held_at; NEW.held_reasons := OLD.held_reasons;
      IF NEW.public_comment IS NOT DISTINCT FROM OLD.public_comment THEN RETURN NEW; END IF;
    END IF;
  END IF;

  v_found := public.care_review_pii_reasons(NEW.public_comment, v_center);
  -- Reasons that come from reports stay until a super admin resolves them.
  v_kept := ARRAY(SELECT r FROM unnest(COALESCE(NEW.held_reasons, '{}')) r WHERE r LIKE 'reported_%');
  NEW.held_reasons := v_kept || v_found;
  IF cardinality(NEW.held_reasons) > 0 THEN
    NEW.held_at := COALESCE(NEW.held_at, now());
  ELSE
    NEW.held_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_all_care_scores()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_n integer := 0;
BEGIN
  FOR v_row IN
    SELECT DISTINCT public.care_subject_type(reviewer_type) AS subject_type, reviewee_id
    FROM shift_reviews
    UNION
    SELECT subject_type, subject_id FROM care_scores
  LOOP
    PERFORM public.recompute_care_score(v_row.subject_type, v_row.reviewee_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.shift_review_rescore()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT DISTINCT public.care_subject_type(a.reviewer_type) AS subject_type, a.reviewee_id
    FROM shift_reviews a
    WHERE (TG_OP <> 'DELETE' AND a.reviewer_type = NEW.reviewer_type AND a.reviewer_id = NEW.reviewer_id)
       OR (TG_OP <> 'INSERT' AND a.reviewer_type = OLD.reviewer_type AND a.reviewer_id = OLD.reviewer_id)
    UNION
    SELECT public.care_subject_type(NEW.reviewer_type), NEW.reviewee_id WHERE TG_OP <> 'DELETE'
    UNION
    SELECT public.care_subject_type(OLD.reviewer_type), OLD.reviewee_id WHERE TG_OP <> 'INSERT'
  LOOP
    PERFORM public.recompute_care_score(v_row.subject_type, v_row.reviewee_id);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.care_visible_review(p_review_id uuid)
RETURNS public.shift_reviews
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.* FROM shift_reviews r
  WHERE r.id = p_review_id AND r.hidden_at IS NULL AND r.held_at IS NULL AND r.reveal_at <= now()
    AND public.care_can_view_subject(public.care_subject_type(r.reviewer_type), r.reviewee_id);
$$;

CREATE OR REPLACE FUNCTION public.care_counted_reviews(p_subject_type text, p_subject_id uuid)
RETURNS SETOF public.shift_reviews
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.* FROM shift_reviews r
  WHERE r.reviewee_id = p_subject_id
    AND r.reviewer_type = ANY (public.care_reviewer_types(p_subject_type))
    AND r.hidden_at IS NULL AND r.held_at IS NULL AND r.reveal_at <= now();
$$;

CREATE OR REPLACE FUNCTION public.get_care_reviews(
  p_subject_type text, p_subject_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0,
  p_sort text DEFAULT 'recent')
RETURNS TABLE (
  id uuid, shift_id uuid, rating integer, tags text[], public_comment text, punctual boolean,
  created_at timestamptz, author_name text, author_role text, author_org text,
  response_body text, response_author_name text, response_at timestamptz, is_mine boolean,
  like_count integer, liked_by_me boolean, reported_by_me boolean,
  source text, sub_ratings jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to view reviews' USING ERRCODE = '42501';
  END IF;
  IF p_subject_type NOT IN ('staff', 'center') THEN
    RAISE EXCEPTION 'Unknown subject type %', p_subject_type;
  END IF;
  IF NOT public.care_can_view_subject(p_subject_type, p_subject_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.id, r.shift_id, r.rating, r.tags, r.public_comment,
         CASE WHEN r.reviewer_type = 'center' THEN r.punctual END,
         r.created_at, r.author_name, r.author_role,
         CASE WHEN r.reviewer_type = 'center' THEN c.name WHEN r.reviewer_type = 'peer' THEN cc.name END,
         resp.body, resp.author_name, resp.created_at,
         (r.author_user_id IS NOT NULL AND r.author_user_id = v_uid),
         COALESCE(l.n, 0)::int,
         EXISTS (SELECT 1 FROM shift_review_likes ml WHERE ml.review_id = r.id AND ml.user_id = v_uid),
         EXISTS (SELECT 1 FROM shift_review_reports mr WHERE mr.review_id = r.id AND mr.reporter_user_id = v_uid AND mr.status = 'open'),
         r.reviewer_type, r.sub_ratings
  FROM shift_reviews r
  LEFT JOIN centers c ON c.id = r.reviewer_id AND r.reviewer_type = 'center'
  LEFT JOIN centers cc ON cc.id = r.context_center_id AND r.reviewer_type = 'peer'
  LEFT JOIN shift_review_responses resp ON resp.review_id = r.id
  LEFT JOIN LATERAL (SELECT count(*) AS n FROM shift_review_likes lk WHERE lk.review_id = r.id) l ON true
  WHERE r.reviewee_id = p_subject_id
    AND r.reviewer_type = ANY (public.care_reviewer_types(p_subject_type))
    AND r.hidden_at IS NULL AND r.held_at IS NULL AND r.reveal_at <= now()
  ORDER BY CASE WHEN p_sort = 'helpful' THEN COALESCE(l.n, 0) ELSE 0 END DESC, r.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_care_review(p_review_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_r    shift_reviews%ROWTYPE;
  v_name text;
  v_role text;
  v_id   uuid;
  v_pii  text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to reply' USING ERRCODE = '42501'; END IF;
  IF p_body IS NULL OR char_length(trim(p_body)) = 0 THEN RAISE EXCEPTION 'Reply cannot be empty' USING ERRCODE = '22023'; END IF;
  IF char_length(trim(p_body)) > 1000 THEN RAISE EXCEPTION 'Reply is too long (1000 characters max)' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_r FROM shift_reviews WHERE id = p_review_id;
  IF NOT FOUND OR v_r.hidden_at IS NOT NULL OR v_r.held_at IS NOT NULL OR v_r.reveal_at > now() THEN
    RAISE EXCEPTION 'Review not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_r.reviewer_type IN ('center', 'peer') THEN
    SELECT trim(first_name || ' ' || left(COALESCE(last_name, ''), 1) || CASE WHEN COALESCE(last_name, '') <> '' THEN '.' ELSE '' END),
           COALESCE(initcap(staff_type::text), 'Staff')
      INTO v_name, v_role
    FROM staff_profiles WHERE id = v_r.reviewee_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only the person reviewed can reply' USING ERRCODE = '42501'; END IF;
  ELSE
    IF NOT public.is_center_admin(v_r.reviewee_id) THEN
      RAISE EXCEPTION 'Only an admin of this center can reply' USING ERRCODE = '42501';
    END IF;
    SELECT c.name, 'Center' INTO v_name, v_role FROM centers c WHERE c.id = v_r.reviewee_id;
  END IF;

  v_pii := public.care_review_pii_reasons(p_body, CASE v_r.reviewer_type WHEN 'center' THEN v_r.reviewer_id WHEN 'peer' THEN v_r.context_center_id ELSE v_r.reviewee_id END);
  IF cardinality(v_pii) > 0 THEN
    RAISE EXCEPTION 'Replies are public. Please remove %', array_to_string(ARRAY(
      SELECT CASE x WHEN 'phone' THEN 'phone numbers' WHEN 'email' THEN 'email addresses'
                    WHEN 'address' THEN 'street addresses' ELSE 'children''s names' END FROM unnest(v_pii) x), ', ')
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO shift_review_responses (review_id, author_user_id, author_name, author_role, body)
  VALUES (p_review_id, v_uid, v_name, v_role, trim(p_body))
  ON CONFLICT (review_id) DO UPDATE
    SET body = EXCLUDED.body, author_user_id = EXCLUDED.author_user_id, author_name = EXCLUDED.author_name,
        author_role = EXCLUDED.author_role, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 4. Links ---------------------------------------------------------------------------------------
-- The subject's active link (made if missing). p_rotate: turn off the old one and make a new code.
-- A staff member asks for their own; owners and admins ask for their center.
CREATE OR REPLACE FUNCTION public.care_review_link_get(p_subject_type text, p_subject_id uuid, p_rotate boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link care_review_links;
  v_try  integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to get your review link' USING ERRCODE = '42501'; END IF;
  IF p_subject_type = 'staff' THEN
    IF NOT EXISTS (SELECT 1 FROM staff_profiles WHERE id = p_subject_id AND user_id = auth.uid()) THEN
      RAISE EXCEPTION 'You can only ask for reviews of yourself' USING ERRCODE = '42501';
    END IF;
  ELSIF p_subject_type = 'center' THEN
    IF NOT public.can_view_confidential(p_subject_id) THEN
      RAISE EXCEPTION 'Only the owner or an admin can ask for reviews of the center' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown subject type %', p_subject_type USING ERRCODE = '22023';
  END IF;

  IF p_rotate THEN
    UPDATE care_review_links SET revoked_at = now()
    WHERE subject_type = p_subject_type AND subject_id = p_subject_id AND revoked_at IS NULL;
  END IF;

  SELECT * INTO v_link FROM care_review_links
  WHERE subject_type = p_subject_type AND subject_id = p_subject_id AND revoked_at IS NULL AND expires_at > now()
  ORDER BY created_at DESC LIMIT 1;

  WHILE v_link.id IS NULL LOOP
    v_try := v_try + 1;
    BEGIN
      INSERT INTO care_review_links (code, subject_type, subject_id, created_by)
      VALUES (public.care_review_new_code(), p_subject_type, p_subject_id, auth.uid())
      RETURNING * INTO v_link;
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('code', v_link.code, 'expires_at', v_link.expires_at, 'uses', v_link.uses);
END;
$$;

-- An active link's subject, or NULL. Safe to show before sign-in: only what the link's owner chose to share.
CREATE OR REPLACE FUNCTION public.care_review_link_subject(p_code text)
RETURNS care_review_links
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.* FROM care_review_links l
  WHERE l.code = lower(p_code) AND l.revoked_at IS NULL AND l.expires_at > now()
    AND CASE l.subject_type
          WHEN 'center' THEN EXISTS (SELECT 1 FROM centers c WHERE c.id = l.subject_id AND c.is_active)
          ELSE EXISTS (SELECT 1 FROM staff_profiles sp WHERE sp.id = l.subject_id AND COALESCE(sp.is_active, true)) END;
$$;

CREATE OR REPLACE FUNCTION public.care_review_link_info(p_code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link care_review_links;
  v_disp record;
BEGIN
  v_link := public.care_review_link_subject(p_code);
  IF v_link.id IS NULL THEN RETURN NULL; END IF;
  IF v_link.subject_type = 'center' THEN
    RETURN (SELECT jsonb_build_object('subject_type', 'center', 'name', c.name,
                                      'line', NULLIF(concat_ws(', ', c.city, c.state), ''),
                                      'parents', c.parent_portal_enabled)
            FROM centers c WHERE c.id = v_link.subject_id);
  END IF;
  v_disp := public.care_staff_display(v_link.subject_id);
  RETURN jsonb_build_object('subject_type', 'staff', 'name', v_disp.name, 'line', v_disp.role, 'parents', false);
END;
$$;

-- What the signed-in viewer can do with a link: each way they may review (as staff, as one of their centers,
-- or as a coworker at a shared center), with their latest review that way and when they may write again.
CREATE OR REPLACE FUNCTION public.care_review_link_options(p_code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_link  care_review_links;
  v_me    uuid;
  v_opts  jsonb := '[]'::jsonb;
  v_self  boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to leave a review' USING ERRCODE = '42501'; END IF;
  v_link := public.care_review_link_subject(p_code);
  IF v_link.id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_me FROM staff_profiles WHERE user_id = v_uid;

  IF v_link.subject_type = 'center' THEN
    v_self := public.is_center_admin(v_link.subject_id);
    IF v_me IS NOT NULL AND public.care_staff_at_center(v_me, v_link.subject_id) THEN
      v_opts := v_opts || jsonb_build_array(jsonb_build_object('as', 'staff', 'org_id', v_link.subject_id,
        'label', 'As someone who works here'));
    END IF;
  ELSE
    v_self := v_me IS NOT NULL AND v_me = v_link.subject_id;
    IF NOT v_self THEN
      -- As one of my centers the person works or worked at
      v_opts := v_opts || COALESCE((
        SELECT jsonb_agg(jsonb_build_object('as', 'center', 'org_id', c.id, 'label', 'As ' || c.name) ORDER BY c.name)
        FROM center_admins ca JOIN centers c ON c.id = ca.center_id
        WHERE ca.user_id = v_uid AND public.care_staff_at_center(v_link.subject_id, c.id)), '[]'::jsonb);
      -- As a coworker at a center we share
      IF v_me IS NOT NULL THEN
        v_opts := v_opts || COALESCE((
          SELECT jsonb_agg(jsonb_build_object('as', 'peer', 'org_id', c.id, 'label', 'As a coworker at ' || c.name) ORDER BY c.name)
          FROM centers c
          WHERE public.care_staff_at_center(v_me, c.id) AND public.care_staff_at_center(v_link.subject_id, c.id)), '[]'::jsonb);
      END IF;
    END IF;
  END IF;

  -- Each option's latest review by this viewer
  SELECT COALESCE(jsonb_agg(o || jsonb_build_object('existing', (
           SELECT jsonb_build_object('rating', r.rating, 'public_comment', r.public_comment, 'private_feedback', r.private_feedback,
                                     'sub_ratings', r.sub_ratings, 'editable', r.locked_at > now() AND r.hidden_at IS NULL,
                                     'next_review_at', r.created_at + interval '90 days')
           FROM shift_reviews r
           WHERE r.shift_id IS NULL AND r.reviewee_id = v_link.subject_id AND r.reviewer_type = o ->> 'as'
             AND r.reviewer_id = CASE WHEN o ->> 'as' = 'center' THEN (o ->> 'org_id')::uuid ELSE v_me END
           ORDER BY r.created_at DESC LIMIT 1))), '[]'::jsonb)
    INTO v_opts FROM jsonb_array_elements(v_opts) o;

  RETURN jsonb_build_object('subject_type', v_link.subject_type, 'is_self', v_self, 'options', v_opts);
END;
$$;

-- Write or edit a review from a link. Within 48 hours of the viewer's last review this way it edits that one;
-- otherwise a new one is allowed once 90 days have passed. At most 10 link reviews per person per day.
CREATE OR REPLACE FUNCTION public.care_review_link_submit(
  p_code text, p_as text, p_org_id uuid, p_rating integer, p_comment text DEFAULT NULL,
  p_private_feedback text DEFAULT NULL, p_sub_ratings jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_link     care_review_links;
  v_me       uuid;
  v_reviewer uuid;
  v_context  uuid;
  v_trust    numeric;
  v_name     text;
  v_role     text;
  v_last     shift_reviews;
  v_id       uuid;
  v_held     boolean;
  v_disp     record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to leave a review' USING ERRCODE = '42501'; END IF;
  v_link := public.care_review_link_subject(p_code);
  IF v_link.id IS NULL THEN RAISE EXCEPTION 'This review link is no longer active' USING ERRCODE = 'P0002'; END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Choose a rating from 1 to 5 stars' USING ERRCODE = '22023'; END IF;
  IF char_length(COALESCE(p_comment, '')) > 2000 OR char_length(COALESCE(p_private_feedback, '')) > 2000 THEN
    RAISE EXCEPTION 'Comments can be up to 2000 characters' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_me FROM staff_profiles WHERE user_id = v_uid;

  IF v_link.subject_type = 'center' AND p_as = 'staff' THEN
    IF v_me IS NULL OR NOT public.care_staff_at_center(v_me, v_link.subject_id) THEN
      RAISE EXCEPTION 'Only people who work or recently worked at this center can review it' USING ERRCODE = '42501';
    END IF;
    v_reviewer := v_me; v_context := v_link.subject_id; v_trust := 0.90;
    v_disp := public.care_staff_display(v_me); v_name := v_disp.name; v_role := v_disp.role;
  ELSIF v_link.subject_type = 'staff' AND p_as = 'center' THEN
    IF p_org_id IS NULL OR NOT public.is_center_admin(p_org_id) OR NOT public.care_staff_at_center(v_link.subject_id, p_org_id) THEN
      RAISE EXCEPTION 'You can review this person for a center they work or worked at' USING ERRCODE = '42501';
    END IF;
    v_reviewer := p_org_id; v_context := p_org_id; v_trust := 0.90;
    v_disp := public.care_center_author(p_org_id, v_uid); v_name := v_disp.name; v_role := v_disp.role;
  ELSIF v_link.subject_type = 'staff' AND p_as = 'peer' THEN
    IF v_me IS NULL OR v_me = v_link.subject_id THEN
      RAISE EXCEPTION 'You cannot review yourself' USING ERRCODE = '22023';
    END IF;
    IF p_org_id IS NULL OR NOT public.care_staff_at_center(v_me, p_org_id) OR NOT public.care_staff_at_center(v_link.subject_id, p_org_id) THEN
      RAISE EXCEPTION 'Coworker reviews are for people you work or worked with at the same center' USING ERRCODE = '42501';
    END IF;
    v_reviewer := v_me; v_context := p_org_id; v_trust := 0.70;
    v_disp := public.care_staff_display(v_me); v_name := v_disp.name; v_role := v_disp.role;
  ELSE
    RAISE EXCEPTION 'You cannot review this way' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_last FROM shift_reviews
  WHERE shift_id IS NULL AND reviewer_type = p_as AND reviewer_id = v_reviewer AND reviewee_id = v_link.subject_id
  ORDER BY created_at DESC LIMIT 1;

  PERFORM set_config('carelocal.care_review_rpc', 'on', true);
  IF v_last.id IS NOT NULL AND v_last.locked_at > now() AND v_last.hidden_at IS NULL THEN
    UPDATE shift_reviews
    SET rating = p_rating, public_comment = NULLIF(trim(p_comment), ''), private_feedback = NULLIF(trim(p_private_feedback), ''),
        sub_ratings = COALESCE(p_sub_ratings, '{}'::jsonb),
        edit_history = edit_history || jsonb_build_array(jsonb_build_object(
          'edited_at', now(), 'rating', v_last.rating, 'public_comment', v_last.public_comment,
          'private_feedback', v_last.private_feedback, 'sub_ratings', v_last.sub_ratings))
    WHERE id = v_last.id
    RETURNING id, held_at IS NOT NULL INTO v_id, v_held;
  ELSIF v_last.id IS NOT NULL AND v_last.created_at > now() - interval '90 days' THEN
    PERFORM set_config('carelocal.care_review_rpc', 'off', true);
    RAISE EXCEPTION 'You can review again on %', to_char(v_last.created_at + interval '90 days', 'Mon FMDD, YYYY')
      USING ERRCODE = '22023';
  ELSE
    IF (SELECT count(*) FROM shift_reviews WHERE author_user_id = v_uid AND request_link_id IS NOT NULL
        AND created_at > now() - interval '24 hours') >= 10 THEN
      PERFORM set_config('carelocal.care_review_rpc', 'off', true);
      RAISE EXCEPTION 'You have left 10 reviews from links today. Please try again tomorrow.' USING ERRCODE = '54000';
    END IF;
    INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating, public_comment, private_feedback,
                               sub_ratings, author_user_id, author_name, author_role, trust, reveal_at, locked_at,
                               request_link_id, context_center_id)
    VALUES (NULL, v_reviewer, v_link.subject_id, p_as, p_rating, NULLIF(trim(p_comment), ''), NULLIF(trim(p_private_feedback), ''),
            COALESCE(p_sub_ratings, '{}'::jsonb), v_uid, v_name, v_role, v_trust, now(), now() + interval '48 hours',
            v_link.id, v_context)
    RETURNING id, held_at IS NOT NULL INTO v_id, v_held;
    UPDATE care_review_links SET uses = uses + 1 WHERE id = v_link.id;
  END IF;
  PERFORM set_config('carelocal.care_review_rpc', 'off', true);
  RETURN jsonb_build_object('id', v_id, 'held', v_held);
END;
$$;

-- Parents on a center's link go to the parent portal (server only: the key is the portal link)
CREATE OR REPLACE FUNCTION public.care_review_link_parent_key(p_code text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.parent_portal_key
  FROM care_review_links l JOIN centers c ON c.id = l.subject_id
  WHERE l.id = (public.care_review_link_subject(p_code)).id AND l.subject_type = 'center' AND c.parent_portal_enabled;
$$;

-- 5. Grants ---------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.care_staff_at_center(uuid, uuid)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.care_staff_display(uuid)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.care_center_author(uuid, uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.care_review_new_code()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.care_review_link_subject(text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.care_review_link_get(text, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.care_review_link_info(text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.care_review_link_options(text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.care_review_link_submit(text, text, uuid, integer, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.care_review_link_parent_key(text)       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.care_review_link_get(text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.care_review_link_info(text)             TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.care_review_link_options(text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.care_review_link_submit(text, text, uuid, integer, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.care_review_link_parent_key(text)       TO service_role;
GRANT EXECUTE ON FUNCTION public.care_subject_type(text)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.care_reviewer_types(text)               TO authenticated, service_role;

SELECT public.recompute_all_care_scores();

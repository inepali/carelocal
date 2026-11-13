-- Rollback for 20270106000000_care_review_links.sql. Review links and coworker reviews are removed, and the
-- functions they changed go back to their 20270105000000 / 20270104000000 / 20270103000000 definitions.
-- REVIEWS LEFT FROM LINKS ARE DELETED (coworker reviews, and center/staff reviews without a shift).
DROP FUNCTION IF EXISTS public.care_review_link_submit(text, text, uuid, integer, text, text, jsonb);
DROP FUNCTION IF EXISTS public.care_review_link_options(text);
DROP FUNCTION IF EXISTS public.care_review_link_info(text);
DROP FUNCTION IF EXISTS public.care_review_link_parent_key(text);
DROP FUNCTION IF EXISTS public.care_review_link_get(text, uuid, boolean);
DROP FUNCTION IF EXISTS public.care_review_link_subject(text);
DROP FUNCTION IF EXISTS public.care_review_new_code();
DROP FUNCTION IF EXISTS public.care_center_author(uuid, uuid);
DROP FUNCTION IF EXISTS public.care_staff_display(uuid);
DROP FUNCTION IF EXISTS public.care_staff_at_center(uuid, uuid);
DROP POLICY IF EXISTS "Authors can view own reviews" ON public.shift_reviews;

DELETE FROM public.shift_reviews WHERE reviewer_type = 'peer' OR (reviewer_type IN ('center', 'staff') AND shift_id IS NULL);
ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_shift_required;
ALTER TABLE public.shift_reviews ADD CONSTRAINT shift_reviews_shift_required CHECK ((reviewer_type = 'parent') = (shift_id IS NULL));
ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_reviewer_type_check;
ALTER TABLE public.shift_reviews ADD CONSTRAINT shift_reviews_reviewer_type_check CHECK (reviewer_type IN ('center', 'staff', 'parent'));
ALTER TABLE public.shift_reviews DROP COLUMN IF EXISTS request_link_id, DROP COLUMN IF EXISTS context_center_id;
DROP TABLE IF EXISTS public.care_review_links;

CREATE OR REPLACE FUNCTION public.care_sub_rating_keys(p_reviewer_type text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_reviewer_type
    WHEN 'center' THEN ARRAY['punctuality', 'ratio_compliance', 'communication', 'classroom_readiness']
    WHEN 'staff'  THEN ARRAY['organization', 'support', 'onboarding', 'would_return']
    WHEN 'parent' THEN ARRAY['communication', 'safety', 'learning', 'caring_staff']
    ELSE '{}'::text[] END;
$$;

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
  IF current_setting('carelocal.care_review_internal', true) = 'on' THEN
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
  v_center uuid := CASE NEW.reviewer_type WHEN 'center' THEN NEW.reviewer_id ELSE NEW.reviewee_id END;
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
    SELECT DISTINCT CASE reviewer_type WHEN 'center' THEN 'staff' ELSE 'center' END AS subject_type, reviewee_id
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
    SELECT DISTINCT CASE a.reviewer_type WHEN 'center' THEN 'staff' ELSE 'center' END AS subject_type, a.reviewee_id
    FROM shift_reviews a
    WHERE (TG_OP <> 'DELETE' AND a.reviewer_type = NEW.reviewer_type AND a.reviewer_id = NEW.reviewer_id)
       OR (TG_OP <> 'INSERT' AND a.reviewer_type = OLD.reviewer_type AND a.reviewer_id = OLD.reviewer_id)
    UNION
    SELECT CASE NEW.reviewer_type WHEN 'center' THEN 'staff' ELSE 'center' END, NEW.reviewee_id WHERE TG_OP <> 'DELETE'
    UNION
    SELECT CASE OLD.reviewer_type WHEN 'center' THEN 'staff' ELSE 'center' END, OLD.reviewee_id WHERE TG_OP <> 'INSERT'
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
    AND public.care_can_view_subject(CASE r.reviewer_type WHEN 'center' THEN 'staff' ELSE 'center' END, r.reviewee_id);
$$;

CREATE OR REPLACE FUNCTION public.care_counted_reviews(p_subject_type text, p_subject_id uuid)
RETURNS SETOF public.shift_reviews
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.* FROM shift_reviews r
  WHERE r.reviewee_id = p_subject_id
    AND r.reviewer_type = ANY (CASE p_subject_type WHEN 'staff' THEN ARRAY['center'] ELSE ARRAY['staff', 'parent'] END)
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
         CASE WHEN r.reviewer_type = 'center' THEN c.name END,
         resp.body, resp.author_name, resp.created_at,
         (r.author_user_id IS NOT NULL AND r.author_user_id = v_uid),
         COALESCE(l.n, 0)::int,
         EXISTS (SELECT 1 FROM shift_review_likes ml WHERE ml.review_id = r.id AND ml.user_id = v_uid),
         EXISTS (SELECT 1 FROM shift_review_reports mr WHERE mr.review_id = r.id AND mr.reporter_user_id = v_uid AND mr.status = 'open'),
         r.reviewer_type, r.sub_ratings
  FROM shift_reviews r
  LEFT JOIN centers c ON c.id = r.reviewer_id AND r.reviewer_type = 'center'
  LEFT JOIN shift_review_responses resp ON resp.review_id = r.id
  LEFT JOIN LATERAL (SELECT count(*) AS n FROM shift_review_likes lk WHERE lk.review_id = r.id) l ON true
  WHERE r.reviewee_id = p_subject_id
    AND r.reviewer_type = ANY (CASE p_subject_type WHEN 'staff' THEN ARRAY['center'] ELSE ARRAY['staff', 'parent'] END)
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

  IF v_r.reviewer_type = 'center' THEN
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

  v_pii := public.care_review_pii_reasons(p_body, CASE v_r.reviewer_type WHEN 'center' THEN v_r.reviewer_id ELSE v_r.reviewee_id END);
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

DROP FUNCTION IF EXISTS public.care_subject_type(text);
DROP FUNCTION IF EXISTS public.care_reviewer_types(text);

SELECT public.recompute_all_care_scores();

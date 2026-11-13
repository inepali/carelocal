-- Rollback for 20270104000000_care_score_v1_1.sql. Likes, reports, personal-info holds and reminders are dropped;
-- get_care_reviews, respond_to_care_review and recompute_care_score go back to their 20270103000000 definitions.
-- Reviews that were held become visible again: check the admin review queue before rolling back.
DROP TRIGGER IF EXISTS trg_shift_review_pii ON public.shift_reviews;
DROP FUNCTION IF EXISTS public.shift_review_pii_hold();
DROP FUNCTION IF EXISTS public.release_care_review_hold(uuid);
DROP FUNCTION IF EXISTS public.resolve_care_review_report(uuid, text, text);
DROP FUNCTION IF EXISTS public.report_care_review(uuid, text, text);
DROP FUNCTION IF EXISTS public.toggle_care_review_like(uuid);
DROP FUNCTION IF EXISTS public.get_care_reviews(text, uuid, integer, integer, text);
DROP FUNCTION IF EXISTS public.care_visible_review(uuid);
DROP TABLE IF EXISTS public.shift_review_reports;
DROP TABLE IF EXISTS public.shift_review_likes;
ALTER TABLE public.shift_claims DROP COLUMN IF EXISTS review_reminded_at;
ALTER TABLE public.shift_reviews DROP COLUMN IF EXISTS held_at, DROP COLUMN IF EXISTS held_reasons;

CREATE OR REPLACE FUNCTION public.recompute_care_score(p_subject_type text, p_subject_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_prior_weight constant numeric := 5;
  c_prior_mean   constant numeric := 4.0;
  c_half_life    constant numeric := 365;
  v_reviewer_type text := CASE p_subject_type WHEN 'staff' THEN 'center' WHEN 'center' THEN 'staff' END;
BEGIN
  IF v_reviewer_type IS NULL THEN
    RAISE EXCEPTION 'Unknown subject type %', p_subject_type;
  END IF;
  INSERT INTO care_scores AS cs (subject_type, subject_id, score, average, review_count, reviewer_count, histogram, score_version, computed_at)
  SELECT p_subject_type, p_subject_id,
         CASE WHEN count(*) = 0 THEN NULL
              ELSE round((c_prior_weight * c_prior_mean + sum(w * rating)) / (c_prior_weight + sum(w)), 2) END,
         CASE WHEN count(*) = 0 THEN NULL ELSE round(avg(rating), 2) END,
         count(*), count(DISTINCT reviewer_id),
         jsonb_build_object(
           '1', count(*) FILTER (WHERE rating = 1), '2', count(*) FILTER (WHERE rating = 2),
           '3', count(*) FILTER (WHERE rating = 3), '4', count(*) FILTER (WHERE rating = 4),
           '5', count(*) FILTER (WHERE rating = 5)),
         1, now()
  FROM (
    SELECT r.rating, r.reviewer_id,
           (CASE r.rating WHEN 1 THEN 1.5 WHEN 2 THEN 1.25 WHEN 5 THEN 0.9 ELSE 1.0 END)
           * power(0.5, GREATEST(0, extract(epoch FROM now() - r.created_at) / 86400.0) / c_half_life)
           * r.trust / count(*) OVER (PARTITION BY r.reviewer_id) AS w
    FROM shift_reviews r
    WHERE r.reviewer_type = v_reviewer_type AND r.reviewee_id = p_subject_id
      AND r.hidden_at IS NULL AND r.reveal_at <= now()
  ) x
  ON CONFLICT (subject_type, subject_id) DO UPDATE
    SET score = EXCLUDED.score, average = EXCLUDED.average, review_count = EXCLUDED.review_count,
        reviewer_count = EXCLUDED.reviewer_count, histogram = EXCLUDED.histogram,
        score_version = EXCLUDED.score_version, computed_at = EXCLUDED.computed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_care_reviews(
  p_subject_type text, p_subject_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (
  id uuid, shift_id uuid, rating integer, tags text[], public_comment text, punctual boolean,
  created_at timestamptz, author_name text, author_role text, author_org text,
  response_body text, response_author_name text, response_at timestamptz, is_mine boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to view reviews' USING ERRCODE = '42501'; END IF;
  IF p_subject_type NOT IN ('staff', 'center') THEN RAISE EXCEPTION 'Unknown subject type %', p_subject_type; END IF;
  IF NOT public.care_can_view_subject(p_subject_type, p_subject_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT r.id, r.shift_id, r.rating, r.tags, r.public_comment,
         CASE WHEN r.reviewer_type = 'center' THEN r.punctual END,
         r.created_at, r.author_name, r.author_role,
         CASE WHEN r.reviewer_type = 'center' THEN c.name END,
         resp.body, resp.author_name, resp.created_at, (r.author_user_id = v_uid)
  FROM shift_reviews r
  LEFT JOIN centers c ON c.id = r.reviewer_id AND r.reviewer_type = 'center'
  LEFT JOIN shift_review_responses resp ON resp.review_id = r.id
  WHERE r.reviewer_type = CASE p_subject_type WHEN 'staff' THEN 'center' ELSE 'staff' END
    AND r.reviewee_id = p_subject_id AND r.hidden_at IS NULL AND r.reveal_at <= now()
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.get_care_reviews(text, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_care_reviews(text, uuid, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.respond_to_care_review(p_review_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_r shift_reviews%ROWTYPE; v_name text; v_role text; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to reply' USING ERRCODE = '42501'; END IF;
  IF p_body IS NULL OR char_length(trim(p_body)) = 0 THEN RAISE EXCEPTION 'Reply cannot be empty' USING ERRCODE = '22023'; END IF;
  IF char_length(trim(p_body)) > 1000 THEN RAISE EXCEPTION 'Reply is too long (1000 characters max)' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_r FROM shift_reviews WHERE id = p_review_id;
  IF NOT FOUND OR v_r.hidden_at IS NOT NULL OR v_r.reveal_at > now() THEN RAISE EXCEPTION 'Review not found' USING ERRCODE = 'P0002'; END IF;
  IF v_r.reviewer_type = 'center' THEN
    SELECT trim(first_name || ' ' || left(COALESCE(last_name, ''), 1) || CASE WHEN COALESCE(last_name, '') <> '' THEN '.' ELSE '' END),
           COALESCE(initcap(staff_type::text), 'Staff')
      INTO v_name, v_role FROM staff_profiles WHERE id = v_r.reviewee_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only the person reviewed can reply' USING ERRCODE = '42501'; END IF;
  ELSE
    IF NOT public.is_center_admin(v_r.reviewee_id) THEN RAISE EXCEPTION 'Only an admin of this center can reply' USING ERRCODE = '42501'; END IF;
    SELECT c.name, 'Center' INTO v_name, v_role FROM centers c WHERE c.id = v_r.reviewee_id;
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

DROP FUNCTION IF EXISTS public.care_review_pii_reasons(text, uuid);
-- care_can_view_subject is kept: the restored get_care_reviews uses it.
SELECT public.recompute_all_care_scores();

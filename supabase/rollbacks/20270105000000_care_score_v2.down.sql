-- Rollback for 20270105000000_care_score_v2.sql. Parent reviews, sub-ratings, calibration, rank_score and the
-- report cap are removed; recompute_care_score, shift_review_rescore, get_care_reviews and report_care_review go
-- back to their 20270104000000 / 20270103000000 definitions.
-- PARENT REVIEWS ARE DELETED (shift_reviews rows with reviewer_type 'parent'), with their likes, reports and replies.
DROP FUNCTION IF EXISTS public.parent_submit_care_review(text, integer, text, jsonb);
DROP FUNCTION IF EXISTS public.parent_care_review_status(text);
DROP FUNCTION IF EXISTS public.parent_review_author_name(uuid);
DROP FUNCTION IF EXISTS public.care_parent_review_key(uuid);
DROP TRIGGER IF EXISTS trg_shift_review_sub_ratings ON public.shift_reviews;
DROP FUNCTION IF EXISTS public.shift_review_check_sub_ratings();
DROP FUNCTION IF EXISTS public.get_care_reviews(text, uuid, integer, integer, text);

DELETE FROM public.shift_reviews WHERE reviewer_type = 'parent';
ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_shift_required;
ALTER TABLE public.shift_reviews ALTER COLUMN shift_id SET NOT NULL;
ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_reviewer_type_check;
ALTER TABLE public.shift_reviews ADD CONSTRAINT shift_reviews_reviewer_type_check CHECK (reviewer_type IN ('center', 'staff'));
DROP INDEX IF EXISTS public.shift_reviews_reviewer_idx;
ALTER TABLE public.shift_reviews DROP COLUMN IF EXISTS sub_ratings;
DROP INDEX IF EXISTS public.care_scores_rank_idx;
ALTER TABLE public.care_scores DROP COLUMN IF EXISTS rank_score, DROP COLUMN IF EXISTS sub_scores, DROP COLUMN IF EXISTS by_source;
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
         count(*),
         count(DISTINCT reviewer_id),
         jsonb_build_object(
           '1', count(*) FILTER (WHERE rating = 1), '2', count(*) FILTER (WHERE rating = 2),
           '3', count(*) FILTER (WHERE rating = 3), '4', count(*) FILTER (WHERE rating = 4),
           '5', count(*) FILTER (WHERE rating = 5)),
         1, now()
  FROM (
    SELECT r.rating, r.reviewer_id,
           (CASE r.rating WHEN 1 THEN 1.5 WHEN 2 THEN 1.25 WHEN 5 THEN 0.9 ELSE 1.0 END)
           * power(0.5, GREATEST(0, extract(epoch FROM now() - r.created_at) / 86400.0) / c_half_life)
           * r.trust
           / count(*) OVER (PARTITION BY r.reviewer_id) AS w
    FROM shift_reviews r
    WHERE r.reviewer_type = v_reviewer_type AND r.reviewee_id = p_subject_id
      AND r.hidden_at IS NULL AND r.held_at IS NULL AND r.reveal_at <= now()
  ) x
  ON CONFLICT (subject_type, subject_id) DO UPDATE
    SET score = EXCLUDED.score, average = EXCLUDED.average, review_count = EXCLUDED.review_count,
        reviewer_count = EXCLUDED.reviewer_count, histogram = EXCLUDED.histogram,
        score_version = EXCLUDED.score_version, computed_at = EXCLUDED.computed_at;
END;
$$;

DROP FUNCTION IF EXISTS public.care_counted_reviews(text, uuid);
DROP FUNCTION IF EXISTS public.care_sub_rating_keys(text);

CREATE OR REPLACE FUNCTION public.shift_review_rescore()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recompute_care_score(CASE NEW.reviewer_type WHEN 'center' THEN 'staff' ELSE 'center' END, NEW.reviewee_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.reviewee_id IS DISTINCT FROM NEW.reviewee_id) THEN
    PERFORM public.recompute_care_score(CASE OLD.reviewer_type WHEN 'center' THEN 'staff' ELSE 'center' END, OLD.reviewee_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_care_reviews(
  p_subject_type text, p_subject_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0,
  p_sort text DEFAULT 'recent')
RETURNS TABLE (
  id uuid, shift_id uuid, rating integer, tags text[], public_comment text, punctual boolean,
  created_at timestamptz, author_name text, author_role text, author_org text,
  response_body text, response_author_name text, response_at timestamptz, is_mine boolean,
  like_count integer, liked_by_me boolean, reported_by_me boolean)
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
         (r.author_user_id = v_uid),
         COALESCE(l.n, 0)::int,
         EXISTS (SELECT 1 FROM shift_review_likes ml WHERE ml.review_id = r.id AND ml.user_id = v_uid),
         EXISTS (SELECT 1 FROM shift_review_reports mr WHERE mr.review_id = r.id AND mr.reporter_user_id = v_uid AND mr.status = 'open')
  FROM shift_reviews r
  LEFT JOIN centers c ON c.id = r.reviewer_id AND r.reviewer_type = 'center'
  LEFT JOIN shift_review_responses resp ON resp.review_id = r.id
  LEFT JOIN LATERAL (SELECT count(*) AS n FROM shift_review_likes lk WHERE lk.review_id = r.id) l ON true
  WHERE r.reviewer_type = CASE p_subject_type WHEN 'staff' THEN 'center' ELSE 'staff' END
    AND r.reviewee_id = p_subject_id
    AND r.hidden_at IS NULL AND r.held_at IS NULL AND r.reveal_at <= now()
  ORDER BY CASE WHEN p_sort = 'helpful' THEN COALESCE(l.n, 0) ELSE 0 END DESC, r.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_care_reviews(text, uuid, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_care_reviews(text, uuid, integer, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.report_care_review(p_review_id uuid, p_reason text, p_details text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r  shift_reviews;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to report a review' USING ERRCODE = '42501'; END IF;
  IF p_reason NOT IN ('retaliation', 'false_information', 'child_info', 'harassment', 'other') THEN
    RAISE EXCEPTION 'Choose a reason' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(p_details, '')) > 1000 THEN RAISE EXCEPTION 'Details are too long (1000 characters max)' USING ERRCODE = '22023'; END IF;
  IF p_reason = 'other' AND char_length(trim(COALESCE(p_details, ''))) = 0 THEN
    RAISE EXCEPTION 'Tell us what is wrong with this review' USING ERRCODE = '22023';
  END IF;

  v_r := public.care_visible_review(p_review_id);
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'Review not found' USING ERRCODE = 'P0002'; END IF;
  IF v_r.author_user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot report your own review. You can edit it during the edit window.' USING ERRCODE = '22023'; END IF;

  INSERT INTO shift_review_reports (review_id, reporter_user_id, reason, details)
  VALUES (p_review_id, auth.uid(), p_reason, NULLIF(trim(p_details), ''))
  ON CONFLICT (review_id, reporter_user_id) DO UPDATE
    SET reason = EXCLUDED.reason, details = EXCLUDED.details, status = 'open',
        resolution_note = NULL, resolved_by = NULL, resolved_at = NULL, created_at = now()
  RETURNING id INTO v_id;

  -- A child's information comes down at once, pending a super admin's look.
  IF p_reason = 'child_info' THEN
    PERFORM set_config('carelocal.care_review_internal', 'on', true);
    UPDATE shift_reviews
    SET held_at = COALESCE(held_at, now()),
        held_reasons = CASE WHEN 'reported_child_info' = ANY (held_reasons) THEN held_reasons
                            ELSE held_reasons || 'reported_child_info'::text END
    WHERE id = p_review_id;
    PERFORM set_config('carelocal.care_review_internal', 'off', true);
  END IF;
  RETURN v_id;
END;
$$;

SELECT public.recompute_all_care_scores();

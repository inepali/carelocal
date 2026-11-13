-- ============================================================
-- Care Score v2 (plan: claude/care-score-plan.md)
--  * Parent -> Center reviews. A parent signed in to the parent portal (center link + 6-digit PIN, with at least
--    one enrolled child) may review the center: one review per parent per 90 days, editable for 48 hours,
--    trust 0.8, shown as "Maria G. · Parent". No blind window (one-way). Personal-info hold applies.
--    Stored in shift_reviews with reviewer_type 'parent', reviewer_id = parent_access.id, no shift.
--    Only the service role can write them (through parent_submit_care_review); there is no client policy.
--  * Sub-ratings: optional 1-5 per topic, by reviewer side. Shown as a breakdown; not in the headline score.
--  * Score v2: reviewer calibration. A reviewer who has rated more than 5 subjects with almost no spread
--    (everyone 5, or everyone 1) counts for less: 0.6 at no spread, rising to 1.0 at a 0.3 standard deviation.
--  * rank_score: Wilson lower bound (95%) of the share of 4-5 star reviews, for sorting lists. Sort only.
--  * Center scores split by source (staff, parents) in care_scores.by_source.
--  * Reports: at most 5 per person per 24 hours.
-- ============================================================

-- 1. Parent reviews in shift_reviews ---------------------------------------------------------
ALTER TABLE public.shift_reviews ALTER COLUMN shift_id DROP NOT NULL;
ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_reviewer_type_check;
ALTER TABLE public.shift_reviews ADD CONSTRAINT shift_reviews_reviewer_type_check
  CHECK (reviewer_type IN ('center', 'staff', 'parent'));
ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_shift_required;
ALTER TABLE public.shift_reviews ADD CONSTRAINT shift_reviews_shift_required
  CHECK ((reviewer_type = 'parent') = (shift_id IS NULL));
CREATE INDEX IF NOT EXISTS shift_reviews_reviewer_idx ON public.shift_reviews (reviewer_type, reviewer_id, created_at DESC);

-- 2. Sub-ratings ---------------------------------------------------------------------------
ALTER TABLE public.shift_reviews ADD COLUMN IF NOT EXISTS sub_ratings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Topics per reviewer side. Keep in step with SUB_RATING_TOPICS in src/lib/care-score.ts.
CREATE OR REPLACE FUNCTION public.care_sub_rating_keys(p_reviewer_type text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_reviewer_type
    WHEN 'center' THEN ARRAY['punctuality', 'ratio_compliance', 'communication', 'classroom_readiness']
    WHEN 'staff'  THEN ARRAY['organization', 'support', 'onboarding', 'would_return']
    WHEN 'parent' THEN ARRAY['communication', 'safety', 'learning', 'caring_staff']
    ELSE '{}'::text[] END;
$$;

CREATE OR REPLACE FUNCTION public.shift_review_check_sub_ratings()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  k text; v jsonb;
BEGIN
  IF NEW.sub_ratings IS NULL THEN NEW.sub_ratings := '{}'::jsonb; END IF;
  IF jsonb_typeof(NEW.sub_ratings) <> 'object' THEN
    RAISE EXCEPTION 'Sub-ratings must be an object' USING ERRCODE = '22023';
  END IF;
  FOR k, v IN SELECT * FROM jsonb_each(NEW.sub_ratings) LOOP
    IF NOT k = ANY (public.care_sub_rating_keys(NEW.reviewer_type)) THEN
      RAISE EXCEPTION 'Unknown rating topic %', k USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric NOT IN (1, 2, 3, 4, 5) THEN
      RAISE EXCEPTION 'Rating for % must be 1 to 5 stars', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_shift_review_sub_ratings ON public.shift_reviews;
CREATE TRIGGER trg_shift_review_sub_ratings
  BEFORE INSERT OR UPDATE OF sub_ratings ON public.shift_reviews
  FOR EACH ROW EXECUTE FUNCTION public.shift_review_check_sub_ratings();

-- 3. Scores v2 ----------------------------------------------------------------------------
ALTER TABLE public.care_scores
  ADD COLUMN IF NOT EXISTS rank_score numeric(5,4),
  ADD COLUMN IF NOT EXISTS sub_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS by_source  jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS care_scores_rank_idx ON public.care_scores (subject_type, rank_score DESC NULLS LAST);

-- Reviews that count for a subject right now
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

-- Formula v2 (keep in step with src/lib/care-score.ts):
--   w_i   = starWeight(r_i) × 0.5^(age_days/365) × trust_i × calibration_i / n_reviewer_i
--   calibration = 1, or for a reviewer who has rated more than 5 subjects: 0.6 + 0.4 × min(sd / 0.3, 1)
--   score = (C·m + Σ w_i·r_i) / (C + Σ w_i),  C = 5, m = 4.0
--   rank  = Wilson lower bound (z = 1.96) of share of 4-5★ among counted reviews
CREATE OR REPLACE FUNCTION public.recompute_care_score(p_subject_type text, p_subject_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_prior_weight constant numeric := 5;
  c_prior_mean   constant numeric := 4.0;
  c_half_life    constant numeric := 365;
  c_z            constant numeric := 1.96;
BEGIN
  IF p_subject_type NOT IN ('staff', 'center') THEN
    RAISE EXCEPTION 'Unknown subject type %', p_subject_type;
  END IF;

  INSERT INTO care_scores AS cs (subject_type, subject_id, score, average, review_count, reviewer_count, histogram,
                                 rank_score, sub_scores, by_source, score_version, computed_at)
  WITH counted AS (
    SELECT * FROM public.care_counted_reviews(p_subject_type, p_subject_id)
  ),
  calib AS (
    -- Each reviewer's spread across every subject they have visibly rated
    SELECT a.reviewer_type, a.reviewer_id,
           CASE WHEN count(DISTINCT a.reviewee_id) > 5
                THEN 0.6 + 0.4 * LEAST(COALESCE(stddev_pop(a.rating), 0) / 0.3, 1)
                ELSE 1 END AS factor
    FROM shift_reviews a
    WHERE (a.reviewer_type, a.reviewer_id) IN (SELECT reviewer_type, reviewer_id FROM counted)
      AND a.hidden_at IS NULL AND a.held_at IS NULL AND a.reveal_at <= now()
    GROUP BY a.reviewer_type, a.reviewer_id
  ),
  w AS (
    SELECT c.rating, c.reviewer_id, c.reviewer_type, c.sub_ratings,
           (CASE c.rating WHEN 1 THEN 1.5 WHEN 2 THEN 1.25 WHEN 5 THEN 0.9 ELSE 1.0 END)
           * power(0.5, GREATEST(0, extract(epoch FROM now() - c.created_at) / 86400.0) / c_half_life)
           * c.trust
           * COALESCE(k.factor, 1)
           / count(*) OVER (PARTITION BY c.reviewer_type, c.reviewer_id) AS w
    FROM counted c
    LEFT JOIN calib k ON k.reviewer_type = c.reviewer_type AND k.reviewer_id = c.reviewer_id
  ),
  agg AS (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE rating >= 4) AS pos,
           sum(w) AS wsum, sum(w * rating) AS wr,
           avg(rating) AS mean,
           count(DISTINCT (reviewer_type, reviewer_id)) AS reviewers,
           count(*) FILTER (WHERE rating = 1) AS h1, count(*) FILTER (WHERE rating = 2) AS h2,
           count(*) FILTER (WHERE rating = 3) AS h3, count(*) FILTER (WHERE rating = 4) AS h4,
           count(*) FILTER (WHERE rating = 5) AS h5
    FROM w
  ),
  subs AS (
    SELECT COALESCE(jsonb_object_agg(key, jsonb_build_object('average', round(av, 2), 'count', n)), '{}'::jsonb) AS j
    FROM (SELECT e.key, avg((e.value #>> '{}')::numeric) AS av, count(*) AS n
          FROM w CROSS JOIN LATERAL jsonb_each(w.sub_ratings) e GROUP BY e.key) s
  ),
  src AS (
    SELECT COALESCE(jsonb_object_agg(reviewer_type, jsonb_build_object('average', round(av, 2), 'count', n)), '{}'::jsonb) AS j
    FROM (SELECT reviewer_type, avg(rating) AS av, count(*) AS n FROM w GROUP BY reviewer_type) s
  )
  SELECT p_subject_type, p_subject_id,
         CASE WHEN a.n = 0 THEN NULL ELSE round((c_prior_weight * c_prior_mean + a.wr) / (c_prior_weight + a.wsum), 2) END,
         CASE WHEN a.n = 0 THEN NULL ELSE round(a.mean, 2) END,
         a.n, a.reviewers,
         jsonb_build_object('1', a.h1, '2', a.h2, '3', a.h3, '4', a.h4, '5', a.h5),
         CASE WHEN a.n = 0 THEN NULL ELSE round((
           (a.pos::numeric / a.n) + c_z * c_z / (2 * a.n)
           - c_z * sqrt(((a.pos::numeric / a.n) * (1 - a.pos::numeric / a.n) + c_z * c_z / (4 * a.n)) / a.n)
         ) / (1 + c_z * c_z / a.n), 4) END,
         subs.j, src.j, 2, now()
  FROM agg a, subs, src
  ON CONFLICT (subject_type, subject_id) DO UPDATE
    SET score = EXCLUDED.score, average = EXCLUDED.average, review_count = EXCLUDED.review_count,
        reviewer_count = EXCLUDED.reviewer_count, histogram = EXCLUDED.histogram, rank_score = EXCLUDED.rank_score,
        sub_scores = EXCLUDED.sub_scores, by_source = EXCLUDED.by_source,
        score_version = EXCLUDED.score_version, computed_at = EXCLUDED.computed_at;
END;
$$;

-- A reviewer's calibration depends on all their reviews, so every subject they rated is rescored.
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

-- 4. Reading reviews v3: sub-ratings and source ------------------------------------------------
DROP FUNCTION IF EXISTS public.get_care_reviews(text, uuid, integer, integer, text);
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

-- 5. Parent portal: read and write the parent's own review ----------------------------------------
-- Only the service role calls these (the portal's server code), with the device's session token hash,
-- like every other parent_portal_* function.

-- The parent's center, display name, latest review and whether they may write one now. NULL = signed out.
CREATE OR REPLACE FUNCTION public.parent_care_review_status(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_access uuid;
  v_center uuid;
  v_last   shift_reviews;
BEGIN
  v_access := public.parent_session_access(p_token_hash);
  IF v_access IS NULL THEN RETURN NULL; END IF;
  SELECT center_id INTO v_center FROM parent_access WHERE id = v_access;
  IF NOT EXISTS (SELECT 1 FROM child_guardians g JOIN children ch ON ch.id = g.child_id
                 WHERE g.parent_access_id = v_access AND ch.status = 'enrolled' AND ch.center_id = v_center) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_last FROM shift_reviews
  WHERE reviewer_type = 'parent' AND reviewer_id = v_access AND reviewee_id = v_center
  ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'center', (SELECT jsonb_build_object('id', c.id, 'name', c.name) FROM centers c WHERE c.id = v_center),
    'author_name', public.parent_review_author_name(v_access),
    'review', CASE WHEN v_last.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_last.id, 'rating', v_last.rating, 'public_comment', v_last.public_comment,
      'sub_ratings', v_last.sub_ratings, 'created_at', v_last.created_at,
      'editable', v_last.locked_at > now() AND v_last.hidden_at IS NULL,
      'held', v_last.held_at IS NOT NULL, 'hidden', v_last.hidden_at IS NOT NULL,
      'response', (SELECT body FROM shift_review_responses WHERE review_id = v_last.id)) END,
    'next_review_at', CASE WHEN v_last.id IS NULL THEN NULL ELSE v_last.created_at + interval '90 days' END);
END;
$$;

-- "Maria G." from the parent's contact row (first name + last initial)
CREATE OR REPLACE FUNCTION public.parent_review_author_name(p_access_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(trim(
           split_part(trim(g.name), ' ', 1)
           || CASE WHEN position(' ' IN trim(g.name)) > 0
                   THEN ' ' || left(regexp_replace(trim(g.name), '^.*\s', ''), 1) || '.' ELSE '' END), ''), 'Parent')
  FROM child_guardians g
  WHERE g.parent_access_id = p_access_id
  ORDER BY g.is_primary DESC, g.created_at
  LIMIT 1;
$$;

-- Write or edit the parent's review. Within 48 hours of their last review it edits that one; otherwise a new
-- review is allowed once 90 days have passed.
CREATE OR REPLACE FUNCTION public.parent_submit_care_review(
  p_token_hash text, p_rating integer, p_comment text, p_sub_ratings jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_access uuid;
  v_center uuid;
  v_last   shift_reviews;
  v_id     uuid;
  v_held   boolean;
BEGIN
  v_access := public.parent_session_access(p_token_hash);
  IF v_access IS NULL THEN RAISE EXCEPTION 'Please sign in again' USING ERRCODE = '42501'; END IF;
  SELECT center_id INTO v_center FROM parent_access WHERE id = v_access;
  IF NOT EXISTS (SELECT 1 FROM child_guardians g JOIN children ch ON ch.id = g.child_id
                 WHERE g.parent_access_id = v_access AND ch.status = 'enrolled' AND ch.center_id = v_center) THEN
    RAISE EXCEPTION 'Only parents of enrolled children can review the center' USING ERRCODE = '42501';
  END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Choose a rating from 1 to 5 stars' USING ERRCODE = '22023'; END IF;
  IF char_length(COALESCE(p_comment, '')) > 2000 THEN RAISE EXCEPTION 'Comments can be up to 2000 characters' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_last FROM shift_reviews
  WHERE reviewer_type = 'parent' AND reviewer_id = v_access AND reviewee_id = v_center
  ORDER BY created_at DESC LIMIT 1;

  IF v_last.id IS NOT NULL AND v_last.locked_at > now() AND v_last.hidden_at IS NULL THEN
    UPDATE shift_reviews
    SET rating = p_rating, public_comment = NULLIF(trim(p_comment), ''), sub_ratings = COALESCE(p_sub_ratings, '{}'::jsonb),
        edit_history = edit_history || jsonb_build_array(jsonb_build_object(
          'edited_at', now(), 'rating', v_last.rating, 'public_comment', v_last.public_comment, 'sub_ratings', v_last.sub_ratings))
    WHERE id = v_last.id
    RETURNING id, held_at IS NOT NULL INTO v_id, v_held;
  ELSIF v_last.id IS NOT NULL AND v_last.created_at > now() - interval '90 days' THEN
    RAISE EXCEPTION 'You can review again on %', to_char(v_last.created_at + interval '90 days', 'Mon FMDD, YYYY')
      USING ERRCODE = '22023';
  ELSE
    INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating, public_comment, sub_ratings,
                               author_name, author_role, trust, reveal_at, locked_at)
    VALUES (NULL, v_access, v_center, 'parent', p_rating, NULLIF(trim(p_comment), ''), COALESCE(p_sub_ratings, '{}'::jsonb),
            public.parent_review_author_name(v_access), 'Parent', 0.80, now(), now() + interval '48 hours')
    RETURNING id, held_at IS NOT NULL INTO v_id, v_held;
  END IF;
  RETURN jsonb_build_object('id', v_id, 'held', v_held);
END;
$$;

-- The center's parent-portal link key, for the lobby QR code (owners and admins, portal on). NULL otherwise.
CREATE OR REPLACE FUNCTION public.care_parent_review_key(p_center_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.parent_portal_key FROM centers c
  WHERE c.id = p_center_id AND c.parent_portal_enabled AND c.is_active AND public.can_view_confidential(p_center_id);
$$;

-- 6. Reports: at most 5 per person per 24 hours ------------------------------------------------
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

  IF (SELECT count(*) FROM shift_review_reports
      WHERE reporter_user_id = auth.uid() AND created_at > now() - interval '24 hours' AND review_id <> p_review_id) >= 5 THEN
    RAISE EXCEPTION 'You have sent 5 reports in the last day. We will look at those first; please try again tomorrow.'
      USING ERRCODE = '54000';
  END IF;

  INSERT INTO shift_review_reports (review_id, reporter_user_id, reason, details)
  VALUES (p_review_id, auth.uid(), p_reason, NULLIF(trim(p_details), ''))
  ON CONFLICT (review_id, reporter_user_id) DO UPDATE
    SET reason = EXCLUDED.reason, details = EXCLUDED.details, status = 'open',
        resolution_note = NULL, resolved_by = NULL, resolved_at = NULL, created_at = now()
  RETURNING id INTO v_id;

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

-- 7. Grants ----------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.care_sub_rating_keys(text)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shift_review_check_sub_ratings()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.care_counted_reviews(text, uuid)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_care_reviews(text, uuid, integer, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parent_care_review_status(text)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_review_author_name(uuid)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_submit_care_review(text, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.care_parent_review_key(uuid)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_care_review(uuid, text, text)           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.care_sub_rating_keys(text)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_care_reviews(text, uuid, integer, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.parent_care_review_status(text)                TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_submit_care_review(text, integer, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.care_parent_review_key(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_care_review(uuid, text, text)           TO authenticated;

SELECT public.recompute_all_care_scores();

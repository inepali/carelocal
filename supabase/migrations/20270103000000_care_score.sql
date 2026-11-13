-- ============================================================
-- Care Score, phase 1 (plan: claude/care-score-plan.md)
--  * Builds on shift_reviews: center -> staff and staff -> center reviews, one per shift per pair.
--  * Reviews are ATTRIBUTED: author_user_id, author_name and author_role are captured when the review is written.
--  * Double-blind reveal: neither side sees the other's review until both have reviewed the shift or the 7-day
--    window after the shift closes (reveal_at).
--  * 48-hour edit window (locked_at); every edit is kept in edit_history. Super admins can hide (never delete).
--  * The reviewed side may post one public reply (shift_review_responses). Optional, but we nudge.
--  * care_scores holds the weighted score: severity-weighted stars, 1-year half-life, per-reviewer normalisation
--    and a Bayesian prior. Recomputed on every change and nightly (recency decay and reveal windows).
--  * Closes two holes in the old policies: the reviewed side could read the author's private_feedback, and the
--    UPDATE path in submitReview silently did nothing (there was no UPDATE policy).
-- ============================================================

-- 1. Columns ------------------------------------------------------------------------
ALTER TABLE public.shift_reviews
  ADD COLUMN IF NOT EXISTS author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS author_name   text,
  ADD COLUMN IF NOT EXISTS author_role   text,
  ADD COLUMN IF NOT EXISTS reveal_at     timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at     timestamptz,
  ADD COLUMN IF NOT EXISTS edit_history  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS trust         numeric(3,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS hidden_at     timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hidden_reason text;

ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_trust_range;
ALTER TABLE public.shift_reviews ADD CONSTRAINT shift_reviews_trust_range CHECK (trust > 0 AND trust <= 1.5);
ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_public_comment_len;
ALTER TABLE public.shift_reviews ADD CONSTRAINT shift_reviews_public_comment_len CHECK (char_length(public_comment) <= 2000);
ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_private_feedback_len;
ALTER TABLE public.shift_reviews ADD CONSTRAINT shift_reviews_private_feedback_len CHECK (char_length(private_feedback) <= 2000);

-- Existing reviews were written before the blind window existed: visible now and locked.
UPDATE public.shift_reviews
SET reveal_at = COALESCE(reveal_at, created_at),
    locked_at = COALESCE(locked_at, created_at)
WHERE reveal_at IS NULL OR locked_at IS NULL;

-- When both sides were asked to review the shift (set once, so a prompt is never sent twice)
ALTER TABLE public.shift_claims ADD COLUMN IF NOT EXISTS review_prompted_at timestamptz;
-- Shifts already worked before this release are not prompted (upcoming ones will be).
UPDATE public.shift_claims sc SET review_prompted_at = now()
FROM public.shifts s
WHERE s.id = sc.shift_id AND sc.review_prompted_at IS NULL
  AND (sc.check_out_time IS NOT NULL OR s.shift_date < current_date);

-- 2. One review per shift per pair (was: one per relationship, overwritten each shift) ----
ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_reviewer_id_reviewee_id_reviewer_type_key;
ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_shift_pair_key;
ALTER TABLE public.shift_reviews ADD CONSTRAINT shift_reviews_shift_pair_key
  UNIQUE (shift_id, reviewer_id, reviewee_id, reviewer_type);

CREATE INDEX IF NOT EXISTS shift_reviews_reviewee_idx ON public.shift_reviews (reviewer_type, reviewee_id);
CREATE INDEX IF NOT EXISTS shift_reviews_reveal_idx   ON public.shift_reviews (reveal_at) WHERE hidden_at IS NULL;

-- 3. Helpers ------------------------------------------------------------------------

-- When the shift ended, in the center's time zone (overnight shifts end the next day).
CREATE OR REPLACE FUNCTION public.shift_ends_at(p_shift_id uuid)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ((s.shift_date + s.end_time + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0' END)
          AT TIME ZONE COALESCE(NULLIF(c.timezone, ''), 'America/New_York'))
  FROM shifts s JOIN centers c ON c.id = s.center_id
  WHERE s.id = p_shift_id;
$$;

-- Days after a shift ends during which either side may review it.
CREATE OR REPLACE FUNCTION public.care_review_window() RETURNS interval
LANGUAGE sql IMMUTABLE AS $$ SELECT interval '7 days' $$;

-- 4. Guard: who may write, what gets captured --------------------------------------
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

DROP TRIGGER IF EXISTS trg_guard_shift_review ON public.shift_reviews;
CREATE TRIGGER trg_guard_shift_review
  BEFORE INSERT OR UPDATE ON public.shift_reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_shift_review();

-- Reviews are never deleted by users (moderation hides them). Cascades from shift/account cleanup still work.
DROP POLICY IF EXISTS "Authors can update own reviews" ON public.shift_reviews;

-- 5. RLS: authors see their own; nobody reads the other side's raw row ----------------
DROP POLICY IF EXISTS "Staff can view reviews about themselves"   ON public.shift_reviews;
DROP POLICY IF EXISTS "Centers can view reviews about themselves" ON public.shift_reviews;

CREATE POLICY "Authors can update own reviews" ON public.shift_reviews
  FOR UPDATE TO authenticated
  USING (author_user_id = auth.uid())
  WITH CHECK (author_user_id = auth.uid());

DROP POLICY IF EXISTS "Super admins can view all reviews" ON public.shift_reviews;
CREATE POLICY "Super admins can view all reviews" ON public.shift_reviews
  FOR SELECT TO authenticated USING (public.is_super_admin());

REVOKE ALL ON public.shift_reviews FROM anon;
REVOKE DELETE, TRUNCATE ON public.shift_reviews FROM authenticated;

-- 6. Replies ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shift_review_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id      uuid NOT NULL UNIQUE REFERENCES public.shift_reviews(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name    text,
  author_role    text,
  body           text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 1000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shift_review_responses ENABLE ROW LEVEL SECURITY;
-- No direct client access: read through get_care_reviews(), write through respond_to_care_review().
REVOKE ALL ON public.shift_review_responses FROM anon, authenticated;
GRANT ALL ON public.shift_review_responses TO service_role;

-- 7. Scores -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.care_scores (
  subject_type  text NOT NULL CHECK (subject_type IN ('center', 'staff')),
  subject_id    uuid NOT NULL,
  score         numeric(3,2),                 -- weighted, Bayesian; null with no reviews
  average       numeric(3,2),                 -- plain average, for reference
  review_count  integer NOT NULL DEFAULT 0,
  reviewer_count integer NOT NULL DEFAULT 0,
  histogram     jsonb NOT NULL DEFAULT '{"1":0,"2":0,"3":0,"4":0,"5":0}'::jsonb,
  score_version integer NOT NULL DEFAULT 1,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_id)
);
ALTER TABLE public.care_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Signed-in users can read care scores" ON public.care_scores;
CREATE POLICY "Signed-in users can read care scores" ON public.care_scores
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.care_scores FROM anon, authenticated;
GRANT SELECT ON public.care_scores TO authenticated;
GRANT ALL ON public.care_scores TO service_role;

-- Formula v1 (keep in step with src/lib/care-score.ts):
--   w_i   = starWeight(r_i) × 0.5^(age_days/365) × trust_i / n_reviewer_i
--   score = (C·m + Σ w_i·r_i) / (C + Σ w_i),  C = 5, m = 4.0
--   starWeight: 1★ 1.5, 2★ 1.25, 3★ 1.0, 4★ 1.0, 5★ 0.9
-- Dividing by the reviewer's review count stops one center that books someone every week from outweighing
-- everyone else: each reviewer adds at most one review's worth of weight, at their own (recency-weighted) average.
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
      AND r.hidden_at IS NULL AND r.reveal_at <= now()
  ) x
  ON CONFLICT (subject_type, subject_id) DO UPDATE
    SET score = EXCLUDED.score, average = EXCLUDED.average, review_count = EXCLUDED.review_count,
        reviewer_count = EXCLUDED.reviewer_count, histogram = EXCLUDED.histogram,
        score_version = EXCLUDED.score_version, computed_at = EXCLUDED.computed_at;
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

DROP TRIGGER IF EXISTS trg_shift_review_rescore ON public.shift_reviews;
CREATE TRIGGER trg_shift_review_rescore
  AFTER INSERT OR UPDATE OR DELETE ON public.shift_reviews
  FOR EACH ROW EXECUTE FUNCTION public.shift_review_rescore();

-- 8. Reading reviews (safe columns only: never private_feedback or do_not_return) ------
-- Who may read: reviews of a CENTER, any signed-in user; reviews of a STAFF member, that person, any center
-- admin, or a super admin. Only revealed, visible reviews.
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to view reviews' USING ERRCODE = '42501';
  END IF;
  IF p_subject_type = 'staff' AND NOT (
       public.is_super_admin()
       OR EXISTS (SELECT 1 FROM center_admins WHERE user_id = v_uid)
       OR EXISTS (SELECT 1 FROM staff_profiles WHERE id = p_subject_id AND user_id = v_uid)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_subject_type NOT IN ('staff', 'center') THEN
    RAISE EXCEPTION 'Unknown subject type %', p_subject_type;
  END IF;

  RETURN QUERY
  SELECT r.id, r.shift_id, r.rating, r.tags, r.public_comment,
         CASE WHEN r.reviewer_type = 'center' THEN r.punctual END,
         r.created_at, r.author_name, r.author_role,
         CASE WHEN r.reviewer_type = 'center' THEN c.name END,
         resp.body, resp.author_name, resp.created_at,
         (r.author_user_id = v_uid)
  FROM shift_reviews r
  LEFT JOIN centers c ON c.id = r.reviewer_id AND r.reviewer_type = 'center'
  LEFT JOIN shift_review_responses resp ON resp.review_id = r.id
  WHERE r.reviewer_type = CASE p_subject_type WHEN 'staff' THEN 'center' ELSE 'staff' END
    AND r.reviewee_id = p_subject_id
    AND r.hidden_at IS NULL AND r.reveal_at <= now()
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0);
END;
$$;

-- 9. Replying ---------------------------------------------------------------------
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to reply' USING ERRCODE = '42501'; END IF;
  IF p_body IS NULL OR char_length(trim(p_body)) = 0 THEN RAISE EXCEPTION 'Reply cannot be empty' USING ERRCODE = '22023'; END IF;
  IF char_length(trim(p_body)) > 1000 THEN RAISE EXCEPTION 'Reply is too long (1000 characters max)' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_r FROM shift_reviews WHERE id = p_review_id;
  IF NOT FOUND OR v_r.hidden_at IS NOT NULL OR v_r.reveal_at > now() THEN
    RAISE EXCEPTION 'Review not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_r.reviewer_type = 'center' THEN
    -- Reply to a review about a staff member: that staff member.
    SELECT trim(first_name || ' ' || left(COALESCE(last_name, ''), 1) || CASE WHEN COALESCE(last_name, '') <> '' THEN '.' ELSE '' END),
           COALESCE(initcap(staff_type::text), 'Staff')
      INTO v_name, v_role
    FROM staff_profiles WHERE id = v_r.reviewee_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only the person reviewed can reply' USING ERRCODE = '42501'; END IF;
  ELSE
    -- Reply to a review about a center: an admin of that center.
    IF NOT public.is_center_admin(v_r.reviewee_id) THEN
      RAISE EXCEPTION 'Only an admin of this center can reply' USING ERRCODE = '42501';
    END IF;
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

-- 10. Moderation (super admins) -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.moderate_care_review(p_review_id uuid, p_hide boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can moderate reviews' USING ERRCODE = '42501';
  END IF;
  IF p_hide AND (p_reason IS NULL OR char_length(trim(p_reason)) = 0) THEN
    RAISE EXCEPTION 'Give a reason for hiding a review' USING ERRCODE = '22023';
  END IF;
  UPDATE shift_reviews
  SET hidden_at     = CASE WHEN p_hide THEN now() END,
      hidden_by     = CASE WHEN p_hide THEN auth.uid() END,
      hidden_reason = CASE WHEN p_hide THEN trim(p_reason) END
  WHERE id = p_review_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found' USING ERRCODE = 'P0002'; END IF;
END;
$$;

-- 11. Grants ------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.shift_ends_at(uuid)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_shift_review()                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shift_review_rescore()                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_care_score(text, uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_all_care_scores()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_care_reviews(text, uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_care_review(uuid, text)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.moderate_care_review(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_ends_at(uuid)                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_care_score(text, uuid)          TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_all_care_scores()               TO service_role;
GRANT EXECUTE ON FUNCTION public.get_care_reviews(text, uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_care_review(uuid, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_care_review(uuid, boolean, text) TO authenticated;

-- 12. Backfill scores for existing reviews -------------------------------------------
SELECT public.recompute_all_care_scores();

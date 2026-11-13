-- ============================================================
-- Care Score v1.1 (plan: claude/care-score-plan.md)
--  * Likes ("helpful"): one per user per review. Used only to sort reviews, never in the score.
--  * Reports: retaliation, false information, a child's information, harassment, other. Super admins resolve
--    them (dismiss, or hide the review). A report about a child's information holds the review straight away.
--  * Personal-info hold: a public comment with a phone number, email, street address or the first name of a
--    child at that center is held (not shown, not scored) until a super admin releases it. Replies with such
--    details are refused instead.
--  * Reminders: shift_claims.review_reminded_at, so each side gets at most one 48-hour reminder.
-- ============================================================

-- 1. Who may see a subject's reviews (same rule get_care_reviews has used since v1) -------------
CREATE OR REPLACE FUNCTION public.care_can_view_subject(p_subject_type text, p_subject_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    p_subject_type = 'center'
    OR (p_subject_type = 'staff' AND (
         public.is_super_admin()
         OR EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid())
         OR EXISTS (SELECT 1 FROM staff_profiles WHERE id = p_subject_id AND user_id = auth.uid()))));
$$;

-- 2. Personal-info detection ---------------------------------------------------------------
-- Returns the kinds of personal info found: phone, email, address, child_name. Keep the patterns in step with
-- personalInfoWarnings() in src/lib/care-score.ts (which cannot check child names).
CREATE OR REPLACE FUNCTION public.care_review_pii_reasons(p_text text, p_center_id uuid)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reasons text[] := '{}';
  v_text text := COALESCE(p_text, '');
BEGIN
  IF char_length(trim(v_text)) = 0 THEN RETURN v_reasons; END IF;
  IF v_text ~ '(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}' THEN
    v_reasons := v_reasons || 'phone'::text;
  END IF;
  IF v_text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' THEN
    v_reasons := v_reasons || 'email'::text;
  END IF;
  IF v_text ~* '\m\d{1,6}\s+([a-z0-9.]+\s+){0,3}(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|way|pl|place|cir|circle|pkwy|parkway|hwy|highway)\M' THEN
    v_reasons := v_reasons || 'address'::text;
  END IF;
  IF p_center_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM children ch
       CROSS JOIN LATERAL unnest(ARRAY[ch.first_name, ch.preferred_name]) AS n(name)
       WHERE ch.center_id = p_center_id
         AND COALESCE(ch.status, '') NOT IN ('withdrawn')
         AND char_length(trim(n.name)) >= 3
         AND v_text ~* ('\m' || regexp_replace(trim(n.name), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M')) THEN
    v_reasons := v_reasons || 'child_name'::text;
  END IF;
  RETURN v_reasons;
END;
$$;

-- 3. Hold columns + trigger ------------------------------------------------------------------
ALTER TABLE public.shift_reviews
  ADD COLUMN IF NOT EXISTS held_at      timestamptz,
  ADD COLUMN IF NOT EXISTS held_reasons text[] NOT NULL DEFAULT '{}';

-- Runs after trg_guard_shift_review (triggers fire in name order). Authors cannot change the hold themselves.
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

DROP TRIGGER IF EXISTS trg_shift_review_pii ON public.shift_reviews;
CREATE TRIGGER trg_shift_review_pii
  BEFORE INSERT OR UPDATE ON public.shift_reviews
  FOR EACH ROW EXECUTE FUNCTION public.shift_review_pii_hold();

-- Held reviews do not count (formula v1 otherwise unchanged)
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

-- 4. Likes ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shift_review_likes (
  review_id  uuid NOT NULL REFERENCES public.shift_reviews(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, user_id)
);
ALTER TABLE public.shift_review_likes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_review_likes FROM anon, authenticated;
GRANT ALL ON public.shift_review_likes TO service_role;

-- A review anyone may see right now (revealed, not hidden, not held), or null
CREATE OR REPLACE FUNCTION public.care_visible_review(p_review_id uuid)
RETURNS public.shift_reviews
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.* FROM shift_reviews r
  WHERE r.id = p_review_id AND r.hidden_at IS NULL AND r.held_at IS NULL AND r.reveal_at <= now()
    AND public.care_can_view_subject(CASE r.reviewer_type WHEN 'center' THEN 'staff' ELSE 'center' END, r.reviewee_id);
$$;

CREATE OR REPLACE FUNCTION public.toggle_care_review_like(p_review_id uuid)
RETURNS TABLE (liked boolean, like_count integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_r shift_reviews;
  v_liked boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to mark reviews helpful' USING ERRCODE = '42501'; END IF;
  v_r := public.care_visible_review(p_review_id);
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'Review not found' USING ERRCODE = 'P0002'; END IF;
  IF v_r.author_user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot mark your own review helpful' USING ERRCODE = '22023'; END IF;

  DELETE FROM shift_review_likes WHERE review_id = p_review_id AND user_id = auth.uid();
  IF FOUND THEN
    v_liked := false;
  ELSE
    INSERT INTO shift_review_likes (review_id, user_id) VALUES (p_review_id, auth.uid());
    v_liked := true;
  END IF;
  RETURN QUERY SELECT v_liked, (SELECT count(*)::int FROM shift_review_likes WHERE review_id = p_review_id);
END;
$$;

-- 5. Reports -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shift_review_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id        uuid NOT NULL REFERENCES public.shift_reviews(id) ON DELETE CASCADE,
  reporter_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason           text NOT NULL CHECK (reason IN ('retaliation', 'false_information', 'child_info', 'harassment', 'other')),
  details          text CHECK (char_length(details) <= 1000),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  resolution_note  text,
  resolved_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, reporter_user_id)
);
CREATE INDEX IF NOT EXISTS shift_review_reports_open_idx ON public.shift_review_reports (created_at) WHERE status = 'open';
ALTER TABLE public.shift_review_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_review_reports FROM anon, authenticated;
GRANT SELECT ON public.shift_review_reports TO authenticated;
GRANT ALL ON public.shift_review_reports TO service_role;
DROP POLICY IF EXISTS "Super admins can view review reports" ON public.shift_review_reports;
CREATE POLICY "Super admins can view review reports" ON public.shift_review_reports
  FOR SELECT TO authenticated USING (public.is_super_admin());

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

-- Super admins: 'dismiss' a report, or 'hide' the review (resolves every open report on it).
CREATE OR REPLACE FUNCTION public.resolve_care_review_report(p_report_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rep shift_review_reports;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Only a super admin can resolve reports' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_rep FROM shift_review_reports WHERE id = p_report_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002'; END IF;

  IF p_action = 'hide' THEN
    PERFORM public.moderate_care_review(v_rep.review_id, true, COALESCE(NULLIF(trim(p_note), ''), 'Reported: ' || v_rep.reason));
    UPDATE shift_review_reports
    SET status = 'actioned', resolution_note = NULLIF(trim(p_note), ''), resolved_by = auth.uid(), resolved_at = now()
    WHERE review_id = v_rep.review_id AND status = 'open';
  ELSIF p_action = 'dismiss' THEN
    UPDATE shift_review_reports
    SET status = 'dismissed', resolution_note = NULLIF(trim(p_note), ''), resolved_by = auth.uid(), resolved_at = now()
    WHERE id = p_report_id;
    -- Lift the report hold once no open child_info report remains (a personal-info hold stays).
    IF NOT EXISTS (SELECT 1 FROM shift_review_reports WHERE review_id = v_rep.review_id AND status = 'open' AND reason = 'child_info') THEN
      UPDATE shift_reviews
      SET held_reasons = array_remove(held_reasons, 'reported_child_info'),
          held_at = CASE WHEN cardinality(array_remove(held_reasons, 'reported_child_info')) = 0 THEN NULL ELSE held_at END
      WHERE id = v_rep.review_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown action %', p_action USING ERRCODE = '22023';
  END IF;
END;
$$;

-- Super admins: publish a held review as it is (after checking it is fine), or keep it held.
CREATE OR REPLACE FUNCTION public.release_care_review_hold(p_review_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Only a super admin can release a review' USING ERRCODE = '42501'; END IF;
  UPDATE shift_reviews SET held_at = NULL, held_reasons = '{}' WHERE id = p_review_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE shift_review_reports
  SET status = 'dismissed', resolution_note = 'Released after review', resolved_by = auth.uid(), resolved_at = now()
  WHERE review_id = p_review_id AND status = 'open' AND reason = 'child_info';
END;
$$;

-- 6. Reading reviews v2: likes, sort, held excluded ---------------------------------------
DROP FUNCTION IF EXISTS public.get_care_reviews(text, uuid, integer, integer);
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

-- Replies must not carry personal info either (refused, since the author is right there to fix it)
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

-- Super admins read likes too (for the admin page counts)
DROP POLICY IF EXISTS "Super admins can view review likes" ON public.shift_review_likes;
CREATE POLICY "Super admins can view review likes" ON public.shift_review_likes
  FOR SELECT TO authenticated USING (public.is_super_admin());
GRANT SELECT ON public.shift_review_likes TO authenticated;

-- 7. Reminders ------------------------------------------------------------------------------
ALTER TABLE public.shift_claims ADD COLUMN IF NOT EXISTS review_reminded_at timestamptz;
-- Anything already prompted (including the v1 backfill of past shifts) is not reminded.
UPDATE public.shift_claims SET review_reminded_at = now()
WHERE review_reminded_at IS NULL AND review_prompted_at IS NOT NULL AND review_prompted_at < now() - interval '1 day';

-- 8. Grants -------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.care_can_view_subject(text, uuid)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.care_review_pii_reasons(text, uuid)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shift_review_pii_hold()                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.care_visible_review(uuid)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.toggle_care_review_like(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_care_review(uuid, text, text)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_care_review_report(uuid, text, text)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_care_review_hold(uuid)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_care_reviews(text, uuid, integer, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_care_review(uuid, text)               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.care_can_view_subject(text, uuid)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.care_review_pii_reasons(text, uuid)              TO service_role;
GRANT EXECUTE ON FUNCTION public.toggle_care_review_like(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_care_review(uuid, text, text)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_care_review_report(uuid, text, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_care_review_hold(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_care_reviews(text, uuid, integer, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_care_review(uuid, text)               TO authenticated;

SELECT public.recompute_all_care_scores();

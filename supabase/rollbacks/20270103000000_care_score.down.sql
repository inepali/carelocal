-- Rollback for 20270103000000_care_score.sql.
-- Restores the old shift_reviews policies and the one-review-per-relationship rule.
-- Replies and care_scores are dropped. The new shift_reviews columns are dropped too (attribution, reveal and
-- edit history are lost). If several per-shift reviews now exist for one pair, the newest is kept so the old
-- unique constraint can be restored.
DROP TRIGGER IF EXISTS trg_shift_review_rescore ON public.shift_reviews;
DROP TRIGGER IF EXISTS trg_guard_shift_review ON public.shift_reviews;

DROP FUNCTION IF EXISTS public.moderate_care_review(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.respond_to_care_review(uuid, text);
DROP FUNCTION IF EXISTS public.get_care_reviews(text, uuid, integer, integer);
DROP FUNCTION IF EXISTS public.shift_review_rescore();
DROP FUNCTION IF EXISTS public.recompute_all_care_scores();
DROP FUNCTION IF EXISTS public.recompute_care_score(text, uuid);
DROP FUNCTION IF EXISTS public.guard_shift_review();
DROP FUNCTION IF EXISTS public.care_review_window();
DROP FUNCTION IF EXISTS public.shift_ends_at(uuid);

DROP TABLE IF EXISTS public.shift_review_responses;
DROP TABLE IF EXISTS public.care_scores;
ALTER TABLE public.shift_claims DROP COLUMN IF EXISTS review_prompted_at;

DROP POLICY IF EXISTS "Authors can update own reviews" ON public.shift_reviews;
DROP POLICY IF EXISTS "Super admins can view all reviews" ON public.shift_reviews;
CREATE POLICY "Staff can view reviews about themselves" ON public.shift_reviews FOR SELECT
  USING (reviewee_id IN (SELECT id FROM public.staff_profiles WHERE user_id = auth.uid()));
CREATE POLICY "Centers can view reviews about themselves" ON public.shift_reviews FOR SELECT
  USING (reviewee_id IN (SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()));
GRANT ALL ON public.shift_reviews TO anon, authenticated;

DELETE FROM public.shift_reviews r
USING public.shift_reviews newer
WHERE newer.reviewer_id = r.reviewer_id AND newer.reviewee_id = r.reviewee_id AND newer.reviewer_type = r.reviewer_type
  AND (newer.created_at, newer.id) > (r.created_at, r.id);

ALTER TABLE public.shift_reviews DROP CONSTRAINT IF EXISTS shift_reviews_shift_pair_key;
ALTER TABLE public.shift_reviews ADD CONSTRAINT shift_reviews_reviewer_id_reviewee_id_reviewer_type_key
  UNIQUE (reviewer_id, reviewee_id, reviewer_type);

DROP INDEX IF EXISTS public.shift_reviews_reviewee_idx;
DROP INDEX IF EXISTS public.shift_reviews_reveal_idx;
ALTER TABLE public.shift_reviews
  DROP CONSTRAINT IF EXISTS shift_reviews_trust_range,
  DROP CONSTRAINT IF EXISTS shift_reviews_public_comment_len,
  DROP CONSTRAINT IF EXISTS shift_reviews_private_feedback_len,
  DROP COLUMN IF EXISTS author_user_id, DROP COLUMN IF EXISTS author_name, DROP COLUMN IF EXISTS author_role,
  DROP COLUMN IF EXISTS reveal_at, DROP COLUMN IF EXISTS locked_at, DROP COLUMN IF EXISTS edit_history,
  DROP COLUMN IF EXISTS trust, DROP COLUMN IF EXISTS hidden_at, DROP COLUMN IF EXISTS hidden_by,
  DROP COLUMN IF EXISTS hidden_reason;

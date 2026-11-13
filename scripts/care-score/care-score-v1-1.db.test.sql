-- Care Score v1.1 database rules test (migration 20270104000000_care_score_v1_1.sql): likes, reports,
-- personal-info hold, replies without personal info.
--
-- Runs inside one transaction and ROLLS BACK, but still: use a scratch/local Postgres only, never production.
--   psql -v ON_ERROR_STOP=1 -d <scratch db> -f scripts/care-score/care-score-v1-1.db.test.sql
-- Prints "CARE SCORE V1.1 DB TESTS PASSED" at the end; any failed check raises and aborts.

BEGIN;

CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid);
GRANT ALL ON t_ids TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM t_ids WHERE k = p $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid uuid, p_super boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_uid::text, true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid, 'app_metadata', json_build_object('is_super_admin', p_super))::text, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
$$;
-- Review id by shift key and side
-- (SECURITY DEFINER: the lookup itself must not be limited by the signed-in user's row-level security)
CREATE OR REPLACE FUNCTION pg_temp.rid(p_shift text, p_type text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id FROM shift_reviews WHERE shift_id = pg_temp.id(p_shift) AND reviewer_type = p_type
$$;

-- Fixtures ---------------------------------------------------------------------------
INSERT INTO t_ids VALUES
  ('u_admin_a', gen_random_uuid()), ('u_admin_b', gen_random_uuid()), ('u_staff', gen_random_uuid()),
  ('u_staff2', gen_random_uuid()), ('u_super', gen_random_uuid()),
  ('center_a', gen_random_uuid()), ('center_b', gen_random_uuid()),
  ('staff', gen_random_uuid()), ('staff2', gen_random_uuid()),
  ('s1', gen_random_uuid()), ('s2', gen_random_uuid()), ('s3', gen_random_uuid()), ('s4', gen_random_uuid());

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (pg_temp.id('u_admin_a'), 'a@test.invalid', '{"full_name":"Priya Shah"}'),
  (pg_temp.id('u_admin_b'), 'b@test.invalid', '{}'),
  (pg_temp.id('u_staff'),   's@test.invalid', '{}'),
  (pg_temp.id('u_staff2'),  's2@test.invalid', '{}'),
  (pg_temp.id('u_super'),   'su@test.invalid', '{}');
INSERT INTO centers (id, slug, name, timezone) VALUES
  (pg_temp.id('center_a'), 'cs11-a-' || left(gen_random_uuid()::text, 8), 'Sunrise Test', 'America/New_York'),
  (pg_temp.id('center_b'), 'cs11-b-' || left(gen_random_uuid()::text, 8), 'Other Test', 'America/New_York');
INSERT INTO center_admins (center_id, user_id, role) VALUES
  (pg_temp.id('center_a'), pg_temp.id('u_admin_a'), 'owner'),
  (pg_temp.id('center_b'), pg_temp.id('u_admin_b'), 'admin');
INSERT INTO staff_profiles (id, user_id, first_name, last_name, email, staff_type) VALUES
  (pg_temp.id('staff'),  pg_temp.id('u_staff'),  'Maria', 'Gomez', 's@test.invalid', 'teacher'),
  (pg_temp.id('staff2'), pg_temp.id('u_staff2'), 'Sam', 'Lee', 's2@test.invalid', 'floater');
-- Children at center A: Aiden (enrolled), "Bo" (too short to match), Zara (withdrawn)
INSERT INTO children (center_id, first_name, last_name, date_of_birth, status, enrolled_on, withdrawn_on) VALUES
  (pg_temp.id('center_a'), 'Aiden', 'Park', '2022-03-01', 'enrolled', '2025-01-01', NULL),
  (pg_temp.id('center_a'), 'Bo', 'Chen', '2022-03-01', 'enrolled', '2025-01-01', NULL),
  (pg_temp.id('center_a'), 'Zara', 'Ali', '2022-03-01', 'withdrawn', '2024-01-01', '2025-06-01');

INSERT INTO shifts (id, center_id, shift_date, start_time, end_time, status)
SELECT pg_temp.id(k), pg_temp.id('center_a'), current_date - 1, '08:00', '12:00', 'filled' FROM unnest(ARRAY['s1','s2','s3','s4']) k;
INSERT INTO shift_claims (shift_id, staff_id, status, check_in_time, check_out_time)
SELECT pg_temp.id(k), pg_temp.id('staff'), 'confirmed', now() - interval '28 hours', now() - interval '24 hours' FROM unnest(ARRAY['s1','s2','s3','s4']) k;

SET LOCAL ROLE authenticated;

-- 1. Personal-info hold ---------------------------------------------------------------------
-- Center reviews first (stays blind), then staff reviews (reveals both).
SELECT pg_temp.as_user(pg_temp.id('u_admin_a'));
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating, public_comment)
VALUES (pg_temp.id('s1'), pg_temp.id('center_a'), pg_temp.id('staff'), 'center', 5, 'Aiden loved her circle time!'),
       (pg_temp.id('s2'), pg_temp.id('center_a'), pg_temp.id('staff'), 'center', 4, 'Call me at (704) 555-0199 anytime'),
       (pg_temp.id('s3'), pg_temp.id('center_a'), pg_temp.id('staff'), 'center', 5, 'Bo and Zara were happy. Great job, very bold.'),
       (pg_temp.id('s4'), pg_temp.id('center_a'), pg_temp.id('staff'), 'center', 3, 'Fine shift');
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating, public_comment)
SELECT pg_temp.id(k), pg_temp.id('staff'), pg_temp.id('center_a'), 'staff', 4, 'Email me: maria@example.com'
FROM unnest(ARRAY['s1']) k;
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating, public_comment)
SELECT pg_temp.id(k), pg_temp.id('staff'), pg_temp.id('center_a'), 'staff', 5, 'Lovely team at 123 Main Street'
FROM unnest(ARRAY['s2']) k;
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating, public_comment, held_reasons, held_at)
SELECT pg_temp.id(k), pg_temp.id('staff'), pg_temp.id('center_a'), 'staff', 5, 'Great place', '{reported_child_info}', now()
FROM unnest(ARRAY['s3','s4']) k;

RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT held_reasons FROM shift_reviews WHERE id = pg_temp.rid('s1', 'center')) = '{child_name}', 'child first name held';
  ASSERT (SELECT held_reasons FROM shift_reviews WHERE id = pg_temp.rid('s2', 'center')) = '{phone}', 'phone held';
  ASSERT (SELECT held_at FROM shift_reviews WHERE id = pg_temp.rid('s3', 'center')) IS NULL, 'short and withdrawn names, and "bold", do not match';
  ASSERT (SELECT held_reasons FROM shift_reviews WHERE id = pg_temp.rid('s1', 'staff')) = '{email}', 'email held';
  ASSERT (SELECT held_reasons FROM shift_reviews WHERE id = pg_temp.rid('s2', 'staff')) = '{address}', 'street address held';
  ASSERT (SELECT held_at FROM shift_reviews WHERE id = pg_temp.rid('s4', 'center')) IS NULL, 'clean review not held';
  ASSERT (SELECT held_at IS NULL AND held_reasons = '{}' FROM shift_reviews WHERE id = pg_temp.rid('s3', 'staff')), 'client cannot pre-set a hold';
  ASSERT (SELECT review_count FROM care_scores WHERE subject_type = 'staff' AND subject_id = pg_temp.id('staff')) = 2, 'held reviews unscored';
END $$;
SET LOCAL ROLE authenticated;

SELECT pg_temp.as_user(pg_temp.id('u_staff'));
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM get_care_reviews('staff', pg_temp.id('staff'))) = 2, 'held reviews not listed';
END $$;

-- The author cannot lift a hold by hand, but fixing the comment lifts it.
SELECT pg_temp.as_user(pg_temp.id('u_admin_a'));
UPDATE shift_reviews SET held_at = NULL, held_reasons = '{}' WHERE id = pg_temp.rid('s2', 'center');
DO $$ BEGIN
  ASSERT (SELECT held_at FROM shift_reviews WHERE id = pg_temp.rid('s2', 'center')) IS NOT NULL, 'author cannot clear hold';
END $$;
UPDATE shift_reviews SET public_comment = 'Reliable and kind' WHERE id = pg_temp.rid('s2', 'center');
DO $$ BEGIN
  ASSERT (SELECT held_at FROM shift_reviews WHERE id = pg_temp.rid('s2', 'center')) IS NULL, 'edit without personal info releases';
END $$;

-- Super admin releases a held review as is.
SELECT pg_temp.as_user(pg_temp.id('u_admin_a'));
DO $$ BEGIN
  BEGIN PERFORM release_care_review_hold(pg_temp.rid('s1', 'center')); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_super'), true);
SELECT release_care_review_hold(pg_temp.rid('s2', 'staff'));
DO $$ BEGIN
  ASSERT (SELECT held_at FROM shift_reviews WHERE id = pg_temp.rid('s2', 'staff')) IS NULL, 'released';
  ASSERT (SELECT count(*) FROM get_care_reviews('center', pg_temp.id('center_a'))) = 3, 'released review listed';
END $$;

-- 2. Likes --------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('u_admin_b'));
DO $$ DECLARE v record; BEGIN
  SELECT * INTO v FROM toggle_care_review_like(pg_temp.rid('s4', 'center'));
  ASSERT v.liked AND v.like_count = 1, 'like';
  ASSERT (SELECT liked_by_me AND like_count = 1 FROM get_care_reviews('staff', pg_temp.id('staff')) WHERE id = pg_temp.rid('s4', 'center')), 'liked_by_me';
  SELECT * INTO v FROM toggle_care_review_like(pg_temp.rid('s4', 'center'));
  ASSERT NOT v.liked AND v.like_count = 0, 'unlike';
  PERFORM toggle_care_review_like(pg_temp.rid('s4', 'center'));
  BEGIN PERFORM toggle_care_review_like(pg_temp.rid('s1', 'center')); RAISE EXCEPTION 'expected not found';
  EXCEPTION WHEN no_data_found THEN NULL; END;  -- held
  ASSERT (SELECT count(*) FROM shift_review_likes) = 0, 'no direct read of likes';
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_admin_a'));
DO $$ BEGIN
  BEGIN PERFORM toggle_care_review_like(pg_temp.rid('s4', 'center')); RAISE EXCEPTION 'expected own-review denial';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_staff2'));
DO $$ BEGIN
  BEGIN PERFORM toggle_care_review_like(pg_temp.rid('s4', 'center')); RAISE EXCEPTION 'expected not found for non-viewer';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM toggle_care_review_like(pg_temp.rid('s3', 'staff'));  -- center reviews: anyone signed in
END $$;
-- Helpful sort puts the liked review first; recent sort is newest first.
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
DO $$ BEGIN
  ASSERT (SELECT id FROM get_care_reviews('staff', pg_temp.id('staff'), 20, 0, 'helpful') LIMIT 1) = pg_temp.rid('s4', 'center'), 'helpful first';
END $$;

-- 3. Reports -------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('u_staff2'));
SELECT report_care_review(pg_temp.rid('s3', 'staff'), 'harassment', 'Rude');
SELECT report_care_review(pg_temp.rid('s3', 'staff'), 'false_information', 'Actually untrue');  -- updates, no duplicate
DO $$ BEGIN
  ASSERT (SELECT reported_by_me FROM get_care_reviews('center', pg_temp.id('center_a')) WHERE id = pg_temp.rid('s3', 'staff')), 'reported_by_me';
  ASSERT (SELECT count(*) FROM shift_review_reports) = 0, 'reporters cannot read reports';
  BEGIN PERFORM report_care_review(pg_temp.rid('s4', 'staff'), 'other', '  '); RAISE EXCEPTION 'expected details required';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM report_care_review(pg_temp.rid('s4', 'staff'), 'spam'); RAISE EXCEPTION 'expected bad reason';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM resolve_care_review_report((SELECT id FROM shift_review_reports WHERE false), 'dismiss'); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
DO $$ BEGIN
  BEGIN PERFORM report_care_review(pg_temp.rid('s3', 'staff'), 'harassment'); RAISE EXCEPTION 'expected own-review denial';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
-- Reporting a child's information holds the review at once.
SELECT pg_temp.as_user(pg_temp.id('u_admin_b'));
SELECT report_care_review(pg_temp.rid('s4', 'center'), 'child_info', 'Names a child in the second sentence');
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM get_care_reviews('staff', pg_temp.id('staff')) WHERE id = pg_temp.rid('s4', 'center')), 'child_info report holds';
END $$;

-- Super admin: dismiss the child_info report (hold lifts), hide via the other report.
SELECT pg_temp.as_user(pg_temp.id('u_super'), true);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM shift_review_reports WHERE status = 'open') = 2, 'admin sees reports';
END $$;
SELECT resolve_care_review_report((SELECT id FROM shift_review_reports WHERE reason = 'child_info'), 'dismiss', 'No child named');
DO $$ BEGIN
  ASSERT (SELECT held_at FROM shift_reviews WHERE id = pg_temp.rid('s4', 'center')) IS NULL, 'dismiss lifts report hold';
  ASSERT (SELECT like_count FROM get_care_reviews('staff', pg_temp.id('staff')) WHERE id = pg_temp.rid('s4', 'center')) = 1, 'likes survive hold';
END $$;
SELECT resolve_care_review_report((SELECT id FROM shift_review_reports WHERE review_id = pg_temp.rid('s3', 'staff')), 'hide', 'False claim');
DO $$ BEGIN
  ASSERT (SELECT hidden_reason FROM shift_reviews WHERE id = pg_temp.rid('s3', 'staff')) = 'False claim', 'hidden via report';
  ASSERT (SELECT status FROM shift_review_reports WHERE review_id = pg_temp.rid('s3', 'staff')) = 'actioned', 'report actioned';
END $$;

-- A personal-info hold survives dismissing an unrelated report (reported_ reasons only are lifted).
RESET ROLE;
SELECT pg_temp.as_service();
DO $$ BEGIN
  ASSERT (SELECT held_reasons FROM shift_reviews WHERE id = pg_temp.rid('s1', 'center')) = '{child_name}', 'personal-info hold intact';
END $$;

-- 4. Replies refuse personal info -------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
DO $$ BEGIN
  BEGIN PERFORM respond_to_care_review(pg_temp.rid('s4', 'center'), 'Thanks! Text me at 704-555-0199'); RAISE EXCEPTION 'expected refusal';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM respond_to_care_review(pg_temp.rid('s4', 'center'), 'Aiden was a joy'); RAISE EXCEPTION 'expected refusal';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM respond_to_care_review(pg_temp.rid('s4', 'center'), 'Thank you, it was a joy!');
END $$;

-- 5. Grants ----------------------------------------------------------------------------------
DO $$ BEGIN
  BEGIN PERFORM care_review_pii_reasons('x', NULL); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM care_visible_review(pg_temp.rid('s4', 'center')); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM toggle_care_review_like(gen_random_uuid()); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM report_care_review(gen_random_uuid(), 'other', 'x'); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'CARE SCORE V1.1 DB TESTS PASSED'; END $$;
ROLLBACK;

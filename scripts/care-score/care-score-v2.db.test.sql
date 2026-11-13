-- Care Score v2 database rules test (migration 20270105000000_care_score_v2.sql): parent reviews, sub-ratings,
-- reviewer calibration, rank_score, score by source, report cap.
--
-- Runs inside one transaction and ROLLS BACK, but still: use a scratch/local Postgres only, never production.
--   psql -v ON_ERROR_STOP=1 -d <scratch db> -f scripts/care-score/care-score-v2.db.test.sql
-- Prints "CARE SCORE V2 DB TESTS PASSED" at the end; any failed check raises and aborts.

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
CREATE OR REPLACE FUNCTION pg_temp.tok(p text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

-- Fixtures ---------------------------------------------------------------------------
INSERT INTO t_ids VALUES
  ('u_admin_a', gen_random_uuid()), ('u_admin_b', gen_random_uuid()), ('u_staff', gen_random_uuid()), ('u_super', gen_random_uuid()),
  ('center_a', gen_random_uuid()), ('center_b', gen_random_uuid()), ('staff', gen_random_uuid()),
  ('child', gen_random_uuid()), ('child_w', gen_random_uuid()), ('access', gen_random_uuid()), ('access_w', gen_random_uuid()),
  ('shift', gen_random_uuid());

INSERT INTO auth.users (id, email) VALUES
  (pg_temp.id('u_admin_a'), 'a@test.invalid'), (pg_temp.id('u_admin_b'), 'b@test.invalid'),
  (pg_temp.id('u_staff'), 's@test.invalid'), (pg_temp.id('u_super'), 'su@test.invalid');
INSERT INTO centers (id, slug, name, timezone, parent_portal_enabled) VALUES
  (pg_temp.id('center_a'), 'cs2-a-' || left(gen_random_uuid()::text, 8), 'Sunrise Test', 'America/New_York', true),
  (pg_temp.id('center_b'), 'cs2-b-' || left(gen_random_uuid()::text, 8), 'Other Test', 'America/New_York', false);
INSERT INTO center_admins (center_id, user_id, role) VALUES
  (pg_temp.id('center_a'), pg_temp.id('u_admin_a'), 'owner'), (pg_temp.id('center_b'), pg_temp.id('u_admin_b'), 'admin');
INSERT INTO staff_profiles (id, user_id, first_name, last_name, email, staff_type) VALUES
  (pg_temp.id('staff'), pg_temp.id('u_staff'), 'Maria', 'Gomez', 's@test.invalid', 'teacher');

-- One parent with an enrolled child; one whose only child was withdrawn.
INSERT INTO children (id, center_id, first_name, last_name, date_of_birth, status, enrolled_on, withdrawn_on) VALUES
  (pg_temp.id('child'),   pg_temp.id('center_a'), 'Leo', 'Ng', '2022-03-01', 'enrolled', '2025-01-01', NULL),
  (pg_temp.id('child_w'), pg_temp.id('center_a'), 'Ivy', 'Ro', '2022-03-01', 'withdrawn', '2024-01-01', '2025-06-01');
INSERT INTO parent_access (id, center_id, code_hash) VALUES
  (pg_temp.id('access'),   pg_temp.id('center_a'), repeat('a', 64)),
  (pg_temp.id('access_w'), pg_temp.id('center_a'), repeat('b', 64));
INSERT INTO child_guardians (center_id, child_id, name, is_primary, parent_access_id) VALUES
  (pg_temp.id('center_a'), pg_temp.id('child'),   'Dana Ng Rivera', true, pg_temp.id('access')),
  (pg_temp.id('center_a'), pg_temp.id('child_w'), 'Sam Ro', true, pg_temp.id('access_w'));
INSERT INTO parent_sessions (access_id, token_hash, expires_at) VALUES
  (pg_temp.id('access'),   pg_temp.tok('parent-1'), now() + interval '30 days'),
  (pg_temp.id('access_w'), pg_temp.tok('parent-w'), now() + interval '30 days');

-- 1. Parent reviews ---------------------------------------------------------------------------
SELECT pg_temp.as_service();
DO $$ DECLARE s jsonb; r jsonb; BEGIN
  s := parent_care_review_status(pg_temp.tok('parent-1'));
  ASSERT s ->> 'author_name' = 'Dana R.', 'parent display name: ' || (s ->> 'author_name');
  ASSERT s -> 'review' = 'null'::jsonb AND s -> 'center' ->> 'name' = 'Sunrise Test', 'no review yet';
  ASSERT parent_care_review_status(pg_temp.tok('parent-w')) IS NULL, 'no enrolled child: no review';
  ASSERT parent_care_review_status(pg_temp.tok('nope')) IS NULL, 'signed out';

  r := parent_submit_care_review(pg_temp.tok('parent-1'), 4, 'Warm teachers, great updates', '{"communication":5,"safety":4}');
  ASSERT (r ->> 'held')::boolean = false, 'not held';
  ASSERT (SELECT trust FROM shift_reviews WHERE id = (r ->> 'id')::uuid) = 0.80, 'parent trust 0.8';
  ASSERT (SELECT reveal_at <= now() AND shift_id IS NULL AND author_role = 'Parent' AND author_user_id IS NULL
          FROM shift_reviews WHERE id = (r ->> 'id')::uuid), 'one-way, visible now, no shift';

  -- Within 48h: edits the same review, history kept
  r := parent_submit_care_review(pg_temp.tok('parent-1'), 5, 'Warm teachers, great updates!', '{"communication":5}');
  ASSERT (SELECT count(*) FROM shift_reviews WHERE reviewer_type = 'parent') = 1, 'edit, not a second review';
  ASSERT (SELECT rating = 5 AND jsonb_array_length(edit_history) = 1 FROM shift_reviews WHERE reviewer_type = 'parent'), 'edited with history';

  BEGIN PERFORM parent_submit_care_review(pg_temp.tok('parent-w'), 1, 'x'); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM parent_submit_care_review(pg_temp.tok('parent-1'), 6, 'x'); RAISE EXCEPTION 'expected bad rating';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM parent_submit_care_review(pg_temp.tok('parent-1'), 5, 'x', '{"punctuality":5}'); RAISE EXCEPTION 'expected bad topic';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

-- After the edit window, a second review waits 90 days
UPDATE shift_reviews SET locked_at = now() - interval '1 minute' WHERE reviewer_type = 'parent';
DO $$ BEGIN
  BEGIN PERFORM parent_submit_care_review(pg_temp.tok('parent-1'), 3, 'again'); RAISE EXCEPTION 'expected 90-day wait';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  ASSERT (parent_care_review_status(pg_temp.tok('parent-1')) -> 'review' ->> 'editable')::boolean = false, 'not editable';
END $$;
UPDATE shift_reviews SET created_at = now() - interval '91 days' WHERE reviewer_type = 'parent';
DO $$ BEGIN
  PERFORM parent_submit_care_review(pg_temp.tok('parent-1'), 3, 'Second visit: fine');
  ASSERT (SELECT count(*) FROM shift_reviews WHERE reviewer_type = 'parent') = 2, 'new review after 90 days';
  -- Personal info is held for parents too
  UPDATE shift_reviews SET locked_at = now() + interval '1 hour' WHERE reviewer_type = 'parent' AND created_at > now() - interval '1 day';
  ASSERT (parent_submit_care_review(pg_temp.tok('parent-1'), 3, 'Leo loved it, call 704-555-0199') ->> 'held')::boolean, 'held';
  PERFORM parent_submit_care_review(pg_temp.tok('parent-1'), 3, 'Second visit: fine');
END $$;

-- Only the service role may call the parent functions; clients cannot write parent reviews at all
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
DO $$ BEGIN
  BEGIN PERFORM parent_submit_care_review(pg_temp.tok('parent-1'), 5, 'x'); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM parent_care_review_status(pg_temp.tok('parent-1')); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
        VALUES (NULL, pg_temp.id('access'), pg_temp.id('center_a'), 'parent', 1);
        RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
END $$;

-- Parent reviews show on the center, attributed, with source and sub-ratings; the center may reply
DO $$ DECLARE v record; BEGIN
  SELECT * INTO v FROM get_care_reviews('center', pg_temp.id('center_a')) WHERE source = 'parent' ORDER BY created_at LIMIT 1;
  ASSERT v.author_name = 'Dana R.' AND v.author_role = 'Parent' AND v.author_org IS NULL, 'parent attribution';
  ASSERT v.sub_ratings = '{"communication":5}'::jsonb, 'sub-ratings returned';
  ASSERT NOT v.is_mine, 'not mine';
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_admin_a'));
SELECT respond_to_care_review((SELECT id FROM get_care_reviews('center', pg_temp.id('center_a')) WHERE source = 'parent' LIMIT 1), 'Thank you, Dana!');
DO $$ BEGIN
  ASSERT care_parent_review_key(pg_temp.id('center_a')) ~ '^[0-9a-z]{8}$', 'owner gets the QR key';
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_admin_b'));
DO $$ BEGIN
  ASSERT care_parent_review_key(pg_temp.id('center_a')) IS NULL, 'other center gets nothing';
  ASSERT care_parent_review_key(pg_temp.id('center_b')) IS NULL, 'portal off: nothing';
END $$;
RESET ROLE;

-- Score by source: staff and parents
SELECT pg_temp.as_service();
INSERT INTO shifts (id, center_id, shift_date, start_time, end_time, status)
VALUES (pg_temp.id('shift'), pg_temp.id('center_a'), current_date - 1, '08:00', '12:00', 'filled');
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating, sub_ratings)
VALUES (pg_temp.id('shift'), pg_temp.id('staff'), pg_temp.id('center_a'), 'staff', 2, '{"support":2,"would_return":1}');
DO $$ DECLARE c care_scores; BEGIN
  SELECT * INTO c FROM care_scores WHERE subject_type = 'center' AND subject_id = pg_temp.id('center_a');
  ASSERT c.review_count = 3 AND c.score_version = 2, 'staff + parent reviews counted (held one excluded)';
  ASSERT (c.by_source -> 'parent' ->> 'count')::int = 2 AND (c.by_source -> 'staff' ->> 'average')::numeric = 2, 'by source';
  ASSERT (c.sub_scores -> 'support' ->> 'average')::numeric = 2 AND (c.sub_scores -> 'communication' ->> 'count')::int = 1, 'sub scores';
END $$;

-- 2. Sub-ratings validated for clients too ------------------------------------------------------
DO $$ BEGIN
  BEGIN UPDATE shift_reviews SET sub_ratings = '{"support":7}' WHERE reviewer_type = 'staff' AND reviewee_id = pg_temp.id('center_a');
        RAISE EXCEPTION 'expected bad value';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN UPDATE shift_reviews SET sub_ratings = '{"punctuality":4}' WHERE reviewer_type = 'staff' AND reviewee_id = pg_temp.id('center_a');
        RAISE EXCEPTION 'expected wrong side topic';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN UPDATE shift_reviews SET sub_ratings = '[]' WHERE reviewer_type = 'staff' AND reviewee_id = pg_temp.id('center_a');
        RAISE EXCEPTION 'expected not an object';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

-- 3. Calibration --------------------------------------------------------------------------------
-- A center that gives every one of 8 staff 5★ (no spread) counts 0.6 as much as one with spread.
INSERT INTO t_ids VALUES ('flat_center', gen_random_uuid()), ('spread_center', gen_random_uuid()), ('target', gen_random_uuid());
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
SELECT pg_temp.id('shift'), pg_temp.id('flat_center'), gen_random_uuid(), 'center', 5 FROM generate_series(1, 7);
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
VALUES (pg_temp.id('shift'), pg_temp.id('flat_center'), pg_temp.id('target'), 'center', 5);
DO $$ BEGIN
  -- 8 subjects, sd 0 -> factor 0.6: (20 + 0.9*0.6*5) / (5 + 0.9*0.6) = 22.7/5.54 = 4.10 (uncalibrated it would be 4.15)
  ASSERT (SELECT score FROM care_scores WHERE subject_id = pg_temp.id('target')) = 4.10,
    'calibrated, got ' || (SELECT score FROM care_scores WHERE subject_id = pg_temp.id('target'));
END $$;
-- Giving one low rating adds spread; every subject that center rated is rescored straight away.
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
VALUES (pg_temp.id('shift'), pg_temp.id('flat_center'), gen_random_uuid(), 'center', 1),
       (pg_temp.id('shift'), pg_temp.id('flat_center'), gen_random_uuid(), 'center', 2);
DO $$ BEGIN
  -- 10 ratings (8×5, 1, 2): sd ≈ 1.39 > 0.3 -> factor 1 -> 4.15
  ASSERT (SELECT score FROM care_scores WHERE subject_id = pg_temp.id('target')) = 4.15, 'spread restores full weight';
END $$;

-- 4. rank_score (Wilson lower bound) -------------------------------------------------------------
INSERT INTO t_ids VALUES ('one_five', gen_random_uuid()), ('forty', gen_random_uuid());
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
VALUES (pg_temp.id('shift'), gen_random_uuid(), pg_temp.id('one_five'), 'center', 5);
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
SELECT pg_temp.id('shift'), gen_random_uuid(), pg_temp.id('forty'), 'center', CASE WHEN g <= 38 THEN 5 ELSE 3 END FROM generate_series(1, 40) g;
DO $$ DECLARE a numeric; b numeric; BEGIN
  SELECT rank_score INTO a FROM care_scores WHERE subject_id = pg_temp.id('one_five');
  SELECT rank_score INTO b FROM care_scores WHERE subject_id = pg_temp.id('forty');
  ASSERT a = 0.2065, 'one 5★: ' || a;          -- Wilson LB for 1/1
  ASSERT b = 0.8350, 'forty mostly 5★: ' || b;  -- Wilson LB for 38/40
  ASSERT b > a, 'forty good reviews outrank one';
END $$;

-- 5. Report cap ---------------------------------------------------------------------------------
INSERT INTO t_ids VALUES ('reporter', gen_random_uuid());
INSERT INTO auth.users (id, email) VALUES (pg_temp.id('reporter'), 'r@test.invalid');
INSERT INTO center_admins (center_id, user_id, role) VALUES (pg_temp.id('center_b'), pg_temp.id('reporter'), 'admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('reporter'));
DO $$ DECLARE ids uuid[]; BEGIN
  ids := ARRAY(SELECT id FROM get_care_reviews('staff', pg_temp.id('forty'), 7));
  FOR i IN 1..5 LOOP PERFORM report_care_review(ids[i], 'false_information', 'test'); END LOOP;
  PERFORM report_care_review(ids[5], 'harassment', 'changing my mind is fine');  -- updating an existing report is not a new one
  BEGIN PERFORM report_care_review(ids[6], 'false_information', 'test'); RAISE EXCEPTION 'expected cap';
  EXCEPTION WHEN program_limit_exceeded THEN NULL; END;
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'CARE SCORE V2 DB TESTS PASSED'; END $$;
ROLLBACK;

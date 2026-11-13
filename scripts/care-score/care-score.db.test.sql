-- Care Score database rules test (migration 20270103000000_care_score.sql).
--
-- Runs inside one transaction and ROLLS BACK, but still: use a scratch/local Postgres only, never production.
--   psql -v ON_ERROR_STOP=1 -d <scratch db> -f scripts/care-score/care-score.db.test.sql
-- Expects the CareLocal schema plus Supabase's auth.uid()/auth.jwt() reading request.jwt.claim.sub / request.jwt.claims.
-- Prints "CARE SCORE DB TESTS PASSED" at the end; any failed check raises and aborts.

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

-- Fixtures ---------------------------------------------------------------------------
INSERT INTO t_ids VALUES
  ('u_admin_a', gen_random_uuid()), ('u_admin_b', gen_random_uuid()), ('u_staff', gen_random_uuid()),
  ('u_staff2', gen_random_uuid()), ('u_super', gen_random_uuid()),
  ('center_a', gen_random_uuid()), ('center_b', gen_random_uuid()),
  ('staff', gen_random_uuid()), ('staff2', gen_random_uuid()),
  ('shift_done', gen_random_uuid()), ('shift_future', gen_random_uuid()), ('shift_old', gen_random_uuid()),
  ('shift_done2', gen_random_uuid());

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (pg_temp.id('u_admin_a'), 'a@test.invalid', '{"full_name":"Priya Shah"}'),
  (pg_temp.id('u_admin_b'), 'b@test.invalid', '{}'),
  (pg_temp.id('u_staff'),   's@test.invalid', '{}'),
  (pg_temp.id('u_staff2'),  's2@test.invalid', '{}'),
  (pg_temp.id('u_super'),   'su@test.invalid', '{}');

INSERT INTO centers (id, slug, name, timezone) VALUES
  (pg_temp.id('center_a'), 'cs-test-a-' || left(gen_random_uuid()::text, 8), 'Sunrise Test', 'America/New_York'),
  (pg_temp.id('center_b'), 'cs-test-b-' || left(gen_random_uuid()::text, 8), 'Other Test', 'America/New_York');
INSERT INTO center_admins (center_id, user_id, role) VALUES
  (pg_temp.id('center_a'), pg_temp.id('u_admin_a'), 'owner'),
  (pg_temp.id('center_b'), pg_temp.id('u_admin_b'), 'admin');
INSERT INTO staff_profiles (id, user_id, first_name, last_name, email, staff_type) VALUES
  (pg_temp.id('staff'),  pg_temp.id('u_staff'),  'Maria', 'Gomez', 's@test.invalid', 'teacher'),
  (pg_temp.id('staff2'), pg_temp.id('u_staff2'), 'Sam', 'Lee', 's2@test.invalid', 'floater');

-- shift_done: yesterday, worked and checked out. shift_future: tomorrow. shift_old: 10 days ago.
INSERT INTO shifts (id, center_id, shift_date, start_time, end_time, status) VALUES
  (pg_temp.id('shift_done'),   pg_temp.id('center_a'), current_date - 1,  '08:00', '12:00', 'filled'),
  (pg_temp.id('shift_done2'),  pg_temp.id('center_a'), current_date - 2,  '08:00', '12:00', 'filled'),
  (pg_temp.id('shift_future'), pg_temp.id('center_a'), current_date + 1,  '08:00', '12:00', 'filled'),
  (pg_temp.id('shift_old'),    pg_temp.id('center_a'), current_date - 10, '08:00', '12:00', 'filled');
INSERT INTO shift_claims (shift_id, staff_id, status, check_in_time, check_out_time) VALUES
  (pg_temp.id('shift_done'),   pg_temp.id('staff'), 'confirmed', now() - interval '28 hours', now() - interval '24 hours'),
  (pg_temp.id('shift_done2'),  pg_temp.id('staff'), 'confirmed', now() - interval '52 hours', now() - interval '48 hours'),
  (pg_temp.id('shift_future'), pg_temp.id('staff'), 'confirmed', NULL, NULL),
  (pg_temp.id('shift_old'),    pg_temp.id('staff'), 'confirmed', now() - interval '10 days', now() - interval '10 days' + interval '4 hours');

SET LOCAL ROLE authenticated;

-- 1. Staff reviews the center: stored, attributed, hidden (blind) ------------------------
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating, public_comment, private_feedback, trust, reveal_at, author_name)
VALUES (pg_temp.id('shift_done'), pg_temp.id('staff'), pg_temp.id('center_a'), 'staff', 2, 'Chaotic morning', 'Ratios were off', 1.5, now() - interval '1 year', 'Forged Name');

DO $$ DECLARE r shift_reviews; BEGIN
  SELECT * INTO r FROM shift_reviews WHERE reviewer_type = 'staff' AND shift_id = pg_temp.id('shift_done');
  ASSERT r.author_user_id = pg_temp.id('u_staff'), 'author captured';
  ASSERT r.author_name = 'Maria G.', 'author name derived, not client-supplied: ' || r.author_name;
  ASSERT r.author_role = 'Teacher', 'author role derived';
  ASSERT r.trust = 1.00, 'client cannot set trust';
  ASSERT r.reveal_at > now() + interval '5 days', 'blind until window closes';
  ASSERT r.locked_at > now() + interval '47 hours', '48h edit window';
END $$;

-- Center cannot see it yet; score not affected.
SELECT pg_temp.as_user(pg_temp.id('u_admin_a'));
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM get_care_reviews('center', pg_temp.id('center_a'))) = 0, 'blind: center sees nothing yet';
  ASSERT (SELECT count(*) FROM shift_reviews WHERE reviewee_id = pg_temp.id('center_a')) = 0, 'no raw access to reviews about you';
  ASSERT COALESCE((SELECT review_count FROM care_scores WHERE subject_type = 'center' AND subject_id = pg_temp.id('center_a')), 0) = 0, 'unrevealed not scored';
END $$;

-- 2. Center reviews the staff member: both sides revealed --------------------------------
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating, public_comment, private_feedback, do_not_return)
VALUES (pg_temp.id('shift_done'), pg_temp.id('center_a'), pg_temp.id('staff'), 'center', 5, 'Great with toddlers', 'Consider for lead role', false);

DO $$ BEGIN
  ASSERT (SELECT author_name FROM shift_reviews WHERE reviewer_type = 'center' AND shift_id = pg_temp.id('shift_done')) = 'Priya Shah', 'admin name from auth metadata';
  ASSERT (SELECT author_role FROM shift_reviews WHERE reviewer_type = 'center' AND shift_id = pg_temp.id('shift_done')) = 'Owner', 'admin role';
  ASSERT (SELECT count(*) FROM get_care_reviews('center', pg_temp.id('center_a'))) = 1, 'counter-review revealed';
  ASSERT (SELECT review_count FROM care_scores WHERE subject_type = 'center' AND subject_id = pg_temp.id('center_a')) = 1, 'center scored after reveal';
  ASSERT (SELECT review_count FROM care_scores WHERE subject_type = 'staff' AND subject_id = pg_temp.id('staff')) = 1, 'staff scored after reveal';
END $$;

-- 3. Staff sees the center's review of them, but never private feedback -------------------
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
DO $$ DECLARE v record; BEGIN
  SELECT * INTO v FROM get_care_reviews('staff', pg_temp.id('staff'));
  ASSERT v.rating = 5 AND v.author_org = 'Sunrise Test' AND v.author_role = 'Owner', 'attributed review visible to subject';
  ASSERT (SELECT count(*) FROM shift_reviews WHERE reviewee_id = pg_temp.id('staff')) = 0, 'subject cannot read raw row (private_feedback)';
  ASSERT (SELECT count(*) FROM shift_reviews WHERE reviewer_id = pg_temp.id('staff')) = 1, 'author still reads own review';
END $$;

-- Another staff member cannot read staff reviews; any signed-in user can read center reviews.
SELECT pg_temp.as_user(pg_temp.id('u_staff2'));
DO $$ BEGIN
  BEGIN PERFORM * FROM get_care_reviews('staff', pg_temp.id('staff')); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM get_care_reviews('center', pg_temp.id('center_a'))) = 1, 'center reviews readable by staff';
END $$;
-- Admin of a different center can read staff reviews (platform-wide visibility).
SELECT pg_temp.as_user(pg_temp.id('u_admin_b'));
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM get_care_reviews('staff', pg_temp.id('staff'))) = 1, 'other centers see staff reviews';
  ASSERT (SELECT count(*) FROM care_scores WHERE subject_id = pg_temp.id('staff')) = 1, 'other centers see staff score';
END $$;

-- 4. Who may review what --------------------------------------------------------------
-- Duplicate for the same shift
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
DO $$ BEGIN
  BEGIN INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
        VALUES (pg_temp.id('shift_done'), pg_temp.id('staff'), pg_temp.id('center_a'), 'staff', 5);
        RAISE EXCEPTION 'expected duplicate';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- future shift
  BEGIN INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
        VALUES (pg_temp.id('shift_future'), pg_temp.id('staff'), pg_temp.id('center_a'), 'staff', 5);
        RAISE EXCEPTION 'expected not-ended';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- window closed
  BEGIN INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
        VALUES (pg_temp.id('shift_old'), pg_temp.id('staff'), pg_temp.id('center_a'), 'staff', 5);
        RAISE EXCEPTION 'expected window closed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- center they did not work with on that shift
  BEGIN INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
        VALUES (pg_temp.id('shift_done'), pg_temp.id('staff'), pg_temp.id('center_b'), 'staff', 1);
        RAISE EXCEPTION 'expected not-worked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- impersonating another staff member
  BEGIN INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
        VALUES (pg_temp.id('shift_done2'), pg_temp.id('staff2'), pg_temp.id('center_a'), 'staff', 1);
        RAISE EXCEPTION 'expected impersonation denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- Admin of center B cannot review for center A
SELECT pg_temp.as_user(pg_temp.id('u_admin_b'));
DO $$ BEGIN
  BEGIN INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
        VALUES (pg_temp.id('shift_done2'), pg_temp.id('center_a'), pg_temp.id('staff'), 'center', 1);
        RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
END $$;

-- 5. Editing: author only, history kept, locked after 48h -------------------------------
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
UPDATE shift_reviews SET rating = 3, public_comment = 'Better by noon', reveal_at = now() + interval '30 days', trust = 1.5
WHERE shift_id = pg_temp.id('shift_done') AND reviewer_type = 'staff';
DO $$ DECLARE r shift_reviews; BEGIN
  SELECT * INTO r FROM shift_reviews WHERE shift_id = pg_temp.id('shift_done') AND reviewer_type = 'staff';
  ASSERT r.rating = 3, 'author edit applied';
  ASSERT jsonb_array_length(r.edit_history) = 1 AND (r.edit_history -> 0 ->> 'rating')::int = 2, 'history kept';
  ASSERT r.reveal_at <= now() AND r.trust = 1.00, 'protected fields unchanged';
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_admin_a'));
DO $$ DECLARE n int; BEGIN
  UPDATE shift_reviews SET rating = 1 WHERE shift_id = pg_temp.id('shift_done') AND reviewer_type = 'staff';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'non-author cannot edit (not even visible)';
END $$;
RESET ROLE;
SELECT pg_temp.as_service();
UPDATE shift_reviews SET locked_at = now() - interval '1 minute' WHERE shift_id = pg_temp.id('shift_done') AND reviewer_type = 'staff';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
DO $$ BEGIN
  BEGIN UPDATE shift_reviews SET rating = 1 WHERE shift_id = pg_temp.id('shift_done') AND reviewer_type = 'staff';
        RAISE EXCEPTION 'expected locked';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN DELETE FROM shift_reviews WHERE reviewer_id = pg_temp.id('staff'); RAISE EXCEPTION 'expected no delete';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 6. Replies ----------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
SELECT respond_to_care_review((SELECT id FROM get_care_reviews('staff', pg_temp.id('staff')) LIMIT 1), 'Thank you, loved the class!');
DO $$ BEGIN
  ASSERT (SELECT response_body FROM get_care_reviews('staff', pg_temp.id('staff')) LIMIT 1) = 'Thank you, loved the class!', 'reply shown';
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_staff2'));
DO $$ BEGIN
  BEGIN PERFORM respond_to_care_review((SELECT id FROM shift_reviews WHERE false), 'x'); RAISE EXCEPTION 'expected not found';
  EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
-- Center admin replies to the staff review about the center; another center's admin cannot.
SELECT pg_temp.as_user(pg_temp.id('u_admin_b'));
DO $$ BEGIN
  BEGIN PERFORM respond_to_care_review((SELECT id FROM get_care_reviews('center', pg_temp.id('center_a')) LIMIT 1), 'Not ours');
        RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_admin_a'));
SELECT respond_to_care_review((SELECT id FROM get_care_reviews('center', pg_temp.id('center_a')) LIMIT 1), 'Thanks Maria, we added a floater.');

-- 7. Moderation -------------------------------------------------------------------------
DO $$ BEGIN
  BEGIN PERFORM moderate_care_review((SELECT id FROM get_care_reviews('center', pg_temp.id('center_a')) LIMIT 1), true, 'x');
        RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_super'), true);
SELECT moderate_care_review((SELECT id FROM shift_reviews WHERE reviewer_type = 'staff' AND shift_id = pg_temp.id('shift_done')), true, 'Contains a child''s name');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM get_care_reviews('center', pg_temp.id('center_a'))) = 0, 'hidden review gone from list';
  ASSERT (SELECT review_count FROM care_scores WHERE subject_type = 'center' AND subject_id = pg_temp.id('center_a')) = 0, 'hidden review unscored';
  ASSERT (SELECT count(*) FROM shift_reviews WHERE reviewer_type = 'staff' AND shift_id = pg_temp.id('shift_done')) = 1, 'never deleted';
END $$;

-- 8. Scoring math -----------------------------------------------------------------------
RESET ROLE;
SELECT pg_temp.as_service();
-- Fresh staff subject: nine 5★ and one 1★ from ten different centers, today. Expected 4.25 (plan's worked example).
INSERT INTO t_ids VALUES ('math_staff', gen_random_uuid());
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
SELECT pg_temp.id('shift_done'), gen_random_uuid(), pg_temp.id('math_staff'), 'center', CASE WHEN g = 10 THEN 1 ELSE 5 END
FROM generate_series(1, 10) g;
DO $$ DECLARE c care_scores; BEGIN
  SELECT * INTO c FROM care_scores WHERE subject_type = 'staff' AND subject_id = pg_temp.id('math_staff');
  ASSERT c.score = 4.25, 'worked example score 4.25, got ' || c.score;
  ASSERT c.average = 4.60, 'plain average 4.60';
  ASSERT c.review_count = 10 AND c.reviewer_count = 10, 'counts';
  ASSERT c.histogram = '{"1":1,"2":0,"3":0,"4":0,"5":9}'::jsonb, 'histogram';
END $$;
-- One center reviewing 20 times at 1★ counts like one reviewer, not twenty.
INSERT INTO t_ids VALUES ('heavy_center', gen_random_uuid()), ('heavy_staff', gen_random_uuid());
INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
SELECT pg_temp.id('shift_done'), gen_random_uuid(), pg_temp.id('heavy_staff'), 'center', 5 FROM generate_series(1, 4);
DO $$ DECLARE s0 numeric; s1 numeric; BEGIN
  SELECT score INTO s0 FROM care_scores WHERE subject_id = pg_temp.id('heavy_staff');
  -- 20 separate shifts from the same center
  CREATE TEMP TABLE heavy_shifts AS SELECT gen_random_uuid() AS id FROM generate_series(1, 20);
  INSERT INTO shifts (id, center_id, shift_date, start_time, end_time, status)
    SELECT id, pg_temp.id('center_a'), current_date - 1, '08:00', '12:00', 'filled' FROM heavy_shifts;
  INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating)
    SELECT id, pg_temp.id('heavy_center'), pg_temp.id('heavy_staff'), 'center', 1 FROM heavy_shifts;
  SELECT score INTO s1 FROM care_scores WHERE subject_id = pg_temp.id('heavy_staff');
  -- Expected: (5*4 + 4*0.9*5 + 1.5*1) / (5 + 3.6 + 1.5) = 39.5/10.1 = 3.91
  ASSERT s1 = 3.91, 'per-reviewer normalisation, got ' || s1;
  ASSERT s1 < s0, 'still hurts';
END $$;
-- Recency: a year-old 1★ weighs half.
UPDATE shift_reviews SET created_at = now() - interval '365 days' WHERE reviewer_id = pg_temp.id('heavy_center');
SELECT recompute_care_score('staff', pg_temp.id('heavy_staff'));
DO $$ BEGIN
  -- (20 + 18 + 0.75) / (5 + 3.6 + 0.75) = 38.75/9.35 = 4.14
  ASSERT (SELECT score FROM care_scores WHERE subject_id = pg_temp.id('heavy_staff')) = 4.14, 'half-life applied';
END $$;

-- 9. Grants: clients cannot run the recompute functions ------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('u_staff'));
DO $$ BEGIN
  BEGIN PERFORM recompute_all_care_scores(); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO care_scores (subject_type, subject_id, score) VALUES ('staff', pg_temp.id('staff'), 5); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM shift_reviews; RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM care_scores; RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'CARE SCORE DB TESTS PASSED'; END $$;
ROLLBACK;

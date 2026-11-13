-- "Ask for a review" links database rules test (migration 20270106000000_care_review_links.sql).
--
-- Runs inside one transaction and ROLLS BACK, but still: use a scratch/local Postgres only, never production.
--   psql -v ON_ERROR_STOP=1 -d <scratch db> -f scripts/care-score/care-review-links.db.test.sql
-- Prints "CARE REVIEW LINKS DB TESTS PASSED" at the end; any failed check raises and aborts.

BEGIN;

CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE t_codes (k text PRIMARY KEY, v text);
GRANT ALL ON t_ids, t_codes TO authenticated, anon;
CREATE OR REPLACE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM t_ids WHERE k = p $$;
CREATE OR REPLACE FUNCTION pg_temp.code(p text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM t_codes WHERE k = p $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_uid::text, true),
         set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.review(p_type text, p_reviewee text) RETURNS shift_reviews LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM shift_reviews WHERE reviewer_type = p_type AND reviewee_id = pg_temp.id(p_reviewee) AND shift_id IS NULL
  ORDER BY created_at DESC LIMIT 1
$$;

-- Fixtures: center A (Teacher T and Floater S both work there), center B (admin B only), outsider staff O.
INSERT INTO t_ids VALUES
  ('u_admin_a', gen_random_uuid()), ('u_admin_b', gen_random_uuid()),
  ('u_t', gen_random_uuid()), ('u_s', gen_random_uuid()), ('u_o', gen_random_uuid()),
  ('center_a', gen_random_uuid()), ('center_b', gen_random_uuid()),
  ('t', gen_random_uuid()), ('s', gen_random_uuid()), ('o', gen_random_uuid());
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (pg_temp.id('u_admin_a'), 'a@test.invalid', '{"full_name":"Priya Shah"}'), (pg_temp.id('u_admin_b'), 'b@test.invalid', '{}'),
  (pg_temp.id('u_t'), 't@test.invalid', '{}'), (pg_temp.id('u_s'), 's@test.invalid', '{}'), (pg_temp.id('u_o'), 'o@test.invalid', '{}');
INSERT INTO centers (id, slug, name, city, state, timezone, parent_portal_enabled) VALUES
  (pg_temp.id('center_a'), 'crl-a-' || left(gen_random_uuid()::text, 8), 'Sunrise Test', 'Charlotte', 'NC', 'America/New_York', true),
  (pg_temp.id('center_b'), 'crl-b-' || left(gen_random_uuid()::text, 8), 'Other Test', 'Raleigh', 'NC', 'America/New_York', false);
INSERT INTO center_admins (center_id, user_id, role) VALUES
  (pg_temp.id('center_a'), pg_temp.id('u_admin_a'), 'owner'), (pg_temp.id('center_b'), pg_temp.id('u_admin_b'), 'admin');
INSERT INTO staff_profiles (id, user_id, first_name, last_name, email, staff_type) VALUES
  (pg_temp.id('t'), pg_temp.id('u_t'), 'Maria', 'Gomez', 't@test.invalid', 'teacher'),
  (pg_temp.id('s'), pg_temp.id('u_s'), 'Sam', 'Lee', 's@test.invalid', 'floater'),
  (pg_temp.id('o'), pg_temp.id('u_o'), 'Olu', 'Ade', 'o@test.invalid', 'teacher');
INSERT INTO center_staff (center_id, staff_id, status) VALUES
  (pg_temp.id('center_a'), pg_temp.id('t'), 'active'),
  (pg_temp.id('center_a'), pg_temp.id('s'), 'active');
INSERT INTO children (center_id, first_name, last_name, date_of_birth, status, enrolled_on) VALUES
  (pg_temp.id('center_a'), 'Aiden', 'Park', '2022-03-01', 'enrolled', '2025-01-01');

SET LOCAL ROLE authenticated;

-- 1. Getting links ------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('u_t'));
INSERT INTO t_codes SELECT 'teacher', care_review_link_get('staff', pg_temp.id('t')) ->> 'code';
DO $$ BEGIN
  ASSERT pg_temp.code('teacher') ~ '^[0-9a-hjkmnp-tv-z]{12}$', 'code format';
  ASSERT care_review_link_get('staff', pg_temp.id('t')) ->> 'code' = pg_temp.code('teacher'), 'same link until rotated';
  BEGIN PERFORM care_review_link_get('staff', pg_temp.id('s')); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM care_review_link_get('center', pg_temp.id('center_a')); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_admin_a'));
INSERT INTO t_codes SELECT 'center', care_review_link_get('center', pg_temp.id('center_a')) ->> 'code';

-- 2. Info before sign-in --------------------------------------------------------------------------
RESET ROLE; SET LOCAL ROLE anon; SELECT pg_temp.as_anon();
DO $$ BEGIN
  ASSERT care_review_link_info(pg_temp.code('teacher')) = '{"subject_type":"staff","name":"Maria G.","line":"Teacher","parents":false}'::jsonb, 'staff info';
  ASSERT care_review_link_info(pg_temp.code('center')) ->> 'name' = 'Sunrise Test'
     AND (care_review_link_info(pg_temp.code('center')) ->> 'parents')::boolean, 'center info';
  ASSERT care_review_link_info('zzzzzzzzzzzz') IS NULL, 'unknown code';
  BEGIN PERFORM care_review_link_options(pg_temp.code('teacher')); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM care_review_link_parent_key(pg_temp.code('center')); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE; SET LOCAL ROLE authenticated;

-- 3. A teacher's link: center admin, coworker, outsider, self --------------------------------------
SELECT pg_temp.as_user(pg_temp.id('u_admin_a'));
DO $$ DECLARE o jsonb; BEGIN
  o := care_review_link_options(pg_temp.code('teacher'));
  ASSERT NOT (o ->> 'is_self')::boolean AND jsonb_array_length(o -> 'options') = 1 AND o -> 'options' -> 0 ->> 'as' = 'center', 'admin option';
  PERFORM care_review_link_submit(pg_temp.code('teacher'), 'center', pg_temp.id('center_a'), 5, 'Our strongest pre-K teacher',
    'Ready for lead', '{"communication":5}');
  ASSERT (pg_temp.review('center', 't')).author_name = 'Priya Shah' AND (pg_temp.review('center', 't')).trust = 0.90, 'center link review';
  ASSERT (care_review_link_options(pg_temp.code('teacher')) -> 'options' -> 0 -> 'existing' ->> 'editable')::boolean, 'editable 48h';
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_admin_b'));
DO $$ BEGIN
  ASSERT jsonb_array_length(care_review_link_options(pg_temp.code('teacher')) -> 'options') = 0, 'no relationship, no options';
  BEGIN PERFORM care_review_link_submit(pg_temp.code('teacher'), 'center', pg_temp.id('center_b'), 1, 'x'); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM care_review_link_submit(pg_temp.code('teacher'), 'center', pg_temp.id('center_a'), 1, 'x'); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;  -- not an admin of A
END $$;

SELECT pg_temp.as_user(pg_temp.id('u_s'));
DO $$ DECLARE o jsonb; BEGIN
  o := care_review_link_options(pg_temp.code('teacher'));
  ASSERT o -> 'options' -> 0 ->> 'as' = 'peer' AND o -> 'options' -> 0 ->> 'label' = 'As a coworker at Sunrise Test', 'peer option';
  PERFORM care_review_link_submit(pg_temp.code('teacher'), 'peer', pg_temp.id('center_a'), 4, 'Always helps in the toddler room',
    NULL, '{"teamwork":5,"reliability":4}');
  BEGIN PERFORM care_review_link_submit(pg_temp.code('teacher'), 'peer', pg_temp.id('center_a'), 4, 'x', NULL, '{"punctuality":5}');
        RAISE EXCEPTION 'expected bad topic';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_t'));
DO $$ DECLARE v record; BEGIN
  ASSERT (care_review_link_options(pg_temp.code('teacher')) ->> 'is_self')::boolean
     AND jsonb_array_length(care_review_link_options(pg_temp.code('teacher')) -> 'options') = 0, 'self: no options';
  BEGIN PERFORM care_review_link_submit(pg_temp.code('teacher'), 'peer', pg_temp.id('center_a'), 5, 'me'); RAISE EXCEPTION 'expected self denial';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- The teacher sees both, attributed; the coworker's shows the shared center; private feedback never shows
  SELECT * INTO v FROM get_care_reviews('staff', pg_temp.id('t')) WHERE source = 'peer';
  ASSERT v.author_name = 'Sam L.' AND v.author_role = 'Floater' AND v.author_org = 'Sunrise Test', 'peer attribution';
  ASSERT (SELECT count(*) FROM get_care_reviews('staff', pg_temp.id('t'))) = 2, 'both listed';
  PERFORM respond_to_care_review(v.id, 'Thanks Sam!');
  ASSERT (SELECT review_count FROM care_scores WHERE subject_type = 'staff' AND subject_id = pg_temp.id('t')) = 2, 'both scored';
  ASSERT (SELECT (by_source -> 'peer' ->> 'count')::int FROM care_scores WHERE subject_type = 'staff' AND subject_id = pg_temp.id('t')) = 1, 'peer source';
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_o'));
DO $$ BEGIN
  ASSERT jsonb_array_length(care_review_link_options(pg_temp.code('teacher')) -> 'options') = 0, 'outsider: no options';
  BEGIN PERFORM care_review_link_submit(pg_temp.code('teacher'), 'peer', pg_temp.id('center_a'), 1, 'x'); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- and no direct insert of coworker reviews
  BEGIN INSERT INTO shift_reviews (shift_id, reviewer_id, reviewee_id, reviewer_type, rating, context_center_id)
        VALUES (NULL, pg_temp.id('o'), pg_temp.id('t'), 'peer', 1, pg_temp.id('center_a'));
        RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
END $$;

-- 4. A center's link: its staff can review; others cannot ------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('u_s'));
DO $$ BEGIN
  ASSERT care_review_link_options(pg_temp.code('center')) -> 'options' -> 0 ->> 'as' = 'staff', 'staff option';
  -- Personal info is held here too (child at the center)
  ASSERT (care_review_link_submit(pg_temp.code('center'), 'staff', pg_temp.id('center_a'), 3, 'Aiden''s room is understaffed') ->> 'held')::boolean, 'held';
  -- 48h: edit the same review, which releases the hold
  ASSERT NOT (care_review_link_submit(pg_temp.code('center'), 'staff', pg_temp.id('center_a'), 3, 'The toddler room is understaffed') ->> 'held')::boolean, 'edit releases';
  ASSERT jsonb_array_length((pg_temp.review('staff', 'center_a')).edit_history) = 1, 'history kept';
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_o'));
DO $$ BEGIN
  BEGIN PERFORM care_review_link_submit(pg_temp.code('center'), 'staff', pg_temp.id('center_a'), 1, 'x'); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_admin_a'));
DO $$ BEGIN
  ASSERT (care_review_link_options(pg_temp.code('center')) ->> 'is_self')::boolean, 'center admin is self on own link';
  BEGIN PERFORM care_review_link_submit(pg_temp.code('center'), 'center', pg_temp.id('center_a'), 5, 'x'); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

-- 5. After 48 hours: one review per 90 days ---------------------------------------------------------
RESET ROLE; SELECT pg_temp.as_anon();
UPDATE shift_reviews SET locked_at = now() - interval '1 minute' WHERE shift_id IS NULL;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('u_s'));
DO $$ BEGIN
  BEGIN PERFORM care_review_link_submit(pg_temp.code('teacher'), 'peer', pg_temp.id('center_a'), 1, 'changed my mind'); RAISE EXCEPTION 'expected wait';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- Author cannot edit a locked review directly either
  BEGIN UPDATE shift_reviews SET rating = 1 WHERE reviewer_type = 'peer' AND reviewer_id = pg_temp.id('s'); RAISE EXCEPTION 'expected locked';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE; SELECT pg_temp.as_anon();
UPDATE shift_reviews SET created_at = now() - interval '91 days' WHERE shift_id IS NULL;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('u_s'));
DO $$ BEGIN
  PERFORM care_review_link_submit(pg_temp.code('teacher'), 'peer', pg_temp.id('center_a'), 5, 'Even better this term');
  ASSERT (SELECT count(*) FROM shift_reviews WHERE reviewer_type = 'peer' AND reviewer_id = pg_temp.id('s')) = 2, 'second peer review after 90 days (author sees own)';
  BEGIN PERFORM get_care_reviews('staff', pg_temp.id('t')); RAISE EXCEPTION 'expected denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;  -- coworkers do not browse each other's reviews
END $$;

-- 6. Rotating turns the old link off ----------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('u_t'));
INSERT INTO t_codes SELECT 'teacher2', care_review_link_get('staff', pg_temp.id('t'), true) ->> 'code';
DO $$ BEGIN
  ASSERT pg_temp.code('teacher2') <> pg_temp.code('teacher'), 'new code';
  ASSERT care_review_link_info(pg_temp.code('teacher')) IS NULL, 'old link off';
END $$;
SELECT pg_temp.as_user(pg_temp.id('u_admin_a'));
DO $$ BEGIN
  BEGIN PERFORM care_review_link_submit(pg_temp.code('teacher'), 'center', pg_temp.id('center_a'), 5, 'x'); RAISE EXCEPTION 'expected inactive';
  EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;

-- 7. Shift reviews still work as before, and the parent key is server-only --------------------------
RESET ROLE;
DO $$ BEGIN
  ASSERT care_review_link_parent_key(pg_temp.code('center')) ~ '^[0-9a-z]{8}$', 'service role gets parent key';
  ASSERT care_review_link_parent_key(pg_temp.code('teacher2')) IS NULL, 'not for staff links';
  ASSERT care_subject_type('peer') = 'staff' AND care_subject_type('parent') = 'center', 'subject mapping';
END $$;

DO $$ BEGIN RAISE NOTICE 'CARE REVIEW LINKS DB TESTS PASSED'; END $$;
ROLLBACK;

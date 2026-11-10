-- Database tests for the staff schedule, phase 3 (20270101020000_schedule_teacher.sql), on a throwaway local Postgres:
--   createdb steach && psql -q -d steach -f scripts/schedule/stub.sql -f scripts/schedule/daily-stub.sql \
--     -f supabase/migrations/20270101000000_staff_schedules.sql -f supabase/migrations/20270101010000_schedule_days.sql \
--     -f supabase/migrations/20270101020000_schedule_teacher.sql -f scripts/schedule/teacher.test.sql
-- It prints ALL PASSED or stops at the first failed check.
\set ON_ERROR_STOP on

CREATE FUNCTION pg_temp.ok(cond boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', what; END IF; END $$;
CREATE FUNCTION pg_temp.fails(q text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RAISE EXCEPTION 'FAIL: expected an error like "%" from: %', pat, q;
EXCEPTION WHEN others THEN
  IF SQLERRM LIKE 'FAIL:%' OR SQLERRM NOT ILIKE '%' || pat || '%' THEN RAISE EXCEPTION 'FAIL: % (got: %)', q, SQLERRM; END IF;
END $$;
CREATE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(u, ''), false), set_config('request.jwt.claims', '{}', false) $$;
CREATE FUNCTION pg_temp.d() RETURNS date LANGUAGE sql AS $$
  SELECT t + ((8 - extract(dow FROM t)::int) % 7) FROM (SELECT public.roster_today('10000000-0000-0000-0000-000000000001') t) x $$;
CREATE FUNCTION pg_temp.ver() RETURNS integer LANGUAGE sql AS $$
  SELECT version FROM schedule_days WHERE center_id = '10000000-0000-0000-0000-000000000001' AND service_date = pg_temp.d() $$;
CREATE FUNCTION pg_temp.mine() RETURNS jsonb LANGUAGE sql AS $$ SELECT public.my_schedule(pg_temp.d() - 1, pg_temp.d() + 7) $$;
CREATE FUNCTION pg_temp.unnotified() RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(sp.first_name, ',' ORDER BY sp.first_name), '')
  FROM jsonb_array_elements_text(schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d()) -> 'unnotified') u JOIN staff_profiles sp ON sp.id = u::uuid $$;
CREATE FUNCTION pg_temp.ana_block() RETURNS uuid LANGUAGE sql AS $$
  SELECT b.id FROM schedule_blocks b JOIN schedule_days dd ON dd.id = b.day_id
  WHERE dd.service_date = pg_temp.d() AND b.staff_id = 'c0000000-0000-0000-0000-000000000001' ORDER BY b.start_time LIMIT 1 $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- Center A: Ana (regular, Mon 7-3 Infant A), Bo (regular, Mon 9-6 floater), Sam (substitute, confirmed Toddler shift)
INSERT INTO auth.users (id) SELECT ('a0000000-0000-0000-0000-0000000000' || x)::uuid FROM unnest(ARRAY['0a', '0b', '01', '02', '04']) x;
INSERT INTO centers (id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A'), ('10000000-0000-0000-0000-000000000002', 'Center B');
UPDATE centers SET schedule_enabled = true;
INSERT INTO center_admins VALUES ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'owner'),
                                 ('a0000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000002', 'admin');
INSERT INTO work_areas (id, center_id, name, sort_order, ratio_children) VALUES
  ('b0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Infant A', 1, 4),
  ('b0000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', 'Toddler', 2, 6);
INSERT INTO children (center_id, classroom_id) VALUES ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000a1');
INSERT INTO staff_profiles (id, user_id, first_name, last_name) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Ana', 'Lee'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Bo', 'Kim'),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'Sam', 'Sub');
INSERT INTO center_staff (id, center_id, staff_id, status, employment_class) VALUES
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'active', 'regular'),
  ('d0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'active', 'regular');
INSERT INTO shifts (id, center_id, work_area_id, shift_date, start_time, end_time, status) VALUES
  ('e0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000a2', pg_temp.d(), '08:00', '12:00', 'filled');
INSERT INTO shift_claims (shift_id, staff_id, status) VALUES ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'confirmed');

SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', public.roster_today('10000000-0000-0000-0000-000000000001'),
  '[{"weekday":1,"start":"07:00","end":"15:00","room_id":"b0000000-0000-0000-0000-0000000000a1"}]');
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000002', public.roster_today('10000000-0000-0000-0000-000000000001'),
  '[{"weekday":1,"start":"09:00","end":"18:00","room_id":null}]');
SELECT schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d());
SELECT pg_temp.ok(pg_temp.unnotified() = '', 'draft day: nobody to notify');
RESET ROLE;

-- 1. A draft is invisible to teachers ---------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT pg_temp.ok(pg_temp.mine() = '[]'::jsonb, 'draft: nothing in my_schedule');
SELECT pg_temp.ok((SELECT schedule_board('10000000-0000-0000-0000-000000000001', pg_temp.d()) ->> 'published' = 'false'), 'draft: board says not published');
SELECT pg_temp.ok((SELECT NOT (schedule_board('10000000-0000-0000-0000-000000000001', pg_temp.d()) ? 'blocks')), 'draft: no boxes leak');
SELECT my_schedule_seen('10000000-0000-0000-0000-000000000001', pg_temp.d());   -- no-op on a draft
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) = 0 FROM schedule_person_notices), 'seen on a draft records nothing');

-- 2. Bo is out sick; the day is published ------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT schedule_call_out('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000002', 'sick', NULL, NULL, 'flu, back Weds');
SELECT schedule_publish('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver());
SELECT pg_temp.ok(pg_temp.unnotified() = 'Ana,Sam', 'published: Ana and Sam to tell (Bo has nothing on the board)');
RESET ROLE;

-- 3. Each person's own day --------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT jsonb_array_length(pg_temp.mine()) = 1), 'Ana: one published day');
SELECT pg_temp.ok((SELECT pg_temp.mine() -> 0 @> '{"center_name":"Center A","seen":false,"off":null,"blocks":[{"room_name":"Infant A","start":"07:00","end":"15:00","sub":false}]}'), 'Ana: her boxes, not seen yet');
SELECT pg_temp.ok((SELECT jsonb_array_length(pg_temp.mine() -> 0 -> 'blocks') = 1), 'Ana: only her own boxes');
SELECT pg_temp.fails($$SELECT my_schedule(current_date, current_date + 40)$$, 'up to a month');
RESET ROLE;

SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT pg_temp.mine() -> 0 @> '{"blocks":[],"off":{"start":null,"end":null}}'), 'Bo: day off, no reason or note shown');
SELECT pg_temp.ok((SELECT pg_temp.mine()::text NOT LIKE '%flu%' AND pg_temp.mine()::text NOT LIKE '%sick%'), 'Bo: call-out reason and note stay with admins');
RESET ROLE;

SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT pg_temp.mine() -> 0 @> '{"blocks":[{"room_name":"Toddler","start":"08:00","end":"12:00","sub":true}]}'), 'Sam (substitute): his shift day');
SELECT pg_temp.fails($$SELECT schedule_board('10000000-0000-0000-0000-000000000001', pg_temp.d())$$, 'do not have access');
RESET ROLE;

-- 4. The read-only board ------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT b ->> 'published' = 'true' AND b ->> 'me' = 'c0000000-0000-0000-0000-000000000001'
                   FROM schedule_board('10000000-0000-0000-0000-000000000001', pg_temp.d()) b), 'board: published, knows who is looking');
SELECT pg_temp.ok((SELECT jsonb_array_length(b -> 'blocks') = 2 AND (SELECT array_agg(p ->> 'first_name' || ':' || (p ->> 'kind') ORDER BY p ->> 'first_name') FROM jsonb_array_elements(b -> 'people') p) = ARRAY['Ana:regular', 'Sam:sub']
                   FROM schedule_board('10000000-0000-0000-0000-000000000001', pg_temp.d()) b), 'board: everyone on it (Bo is off, not listed)');
SELECT pg_temp.ok((SELECT b::text NOT LIKE '%flu%' AND b::text NOT LIKE '%sick%' AND b -> 'rooms' -> 0 ->> 'ratio' IS NULL AND (b -> 'rooms' -> 0 ->> 'enrolled')::int = 0
                     AND b -> 'blocks' -> 0 ->> 'center_staff_id' IS NULL
                   FROM schedule_board('10000000-0000-0000-0000-000000000001', pg_temp.d()) b), 'board: no call-outs, ratios, children or staff ids');
SELECT pg_temp.ok((SELECT bool_and(x ->> 'shift_claim_id' IS NULL OR x ->> 'shift_claim_id' = 'sub') FROM jsonb_array_elements(schedule_board('10000000-0000-0000-0000-000000000001', pg_temp.d()) -> 'blocks') x),
                  'board: substitute claim ids hidden');
-- Teachers still can't change anything
SELECT pg_temp.fails($$SELECT schedule_notice_targets('10000000-0000-0000-0000-000000000001', pg_temp.d())$$, 'cannot change it');
SELECT pg_temp.fails($$SELECT schedule_notice_mark('10000000-0000-0000-0000-000000000001', pg_temp.d(), '[]')$$, 'cannot change it');
SELECT pg_temp.fails($$SELECT * FROM schedule_person_notices$$, 'permission denied');
RESET ROLE;

SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
SET ROLE authenticated;
SELECT pg_temp.fails($$SELECT schedule_board('10000000-0000-0000-0000-000000000001', pg_temp.d())$$, 'do not have access');
SELECT pg_temp.ok(pg_temp.mine() = '[]'::jsonb, 'an admin with no staff profile has no own schedule');
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SET ROLE anon;
SELECT pg_temp.fails($$SELECT schedule_board('10000000-0000-0000-0000-000000000001', pg_temp.d())$$, 'permission denied');
SELECT pg_temp.fails($$SELECT my_schedule(current_date, current_date)$$, 'permission denied');
RESET ROLE;

-- 5. Seen and Updated -------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT my_schedule_seen('10000000-0000-0000-0000-000000000001', pg_temp.d());
SELECT pg_temp.ok((SELECT (pg_temp.mine() -> 0 ->> 'seen')::boolean), 'Ana has seen her day');
RESET ROLE;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), jsonb_build_array(jsonb_build_object('op', 'update', 'id', pg_temp.ana_block(), 'note', 'bring the sign-in sheet')));
RESET ROLE;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT (pg_temp.mine() -> 0 ->> 'seen')::boolean), 'a note change alone is not an "Updated"');
RESET ROLE;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  jsonb_build_array(jsonb_build_object('op', 'update', 'id', pg_temp.ana_block(), 'room_id', 'b0000000-0000-0000-0000-0000000000a2')));
RESET ROLE;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT NOT (pg_temp.mine() -> 0 ->> 'seen')::boolean), 'room change: Updated again');
RESET ROLE;

-- 6. Notices --------------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT array_agg(first_name || '|' || summary || '|' || first_notice ORDER BY first_name) = ARRAY['Ana|Toddler 07:00-15:00|true', 'Sam|Toddler 08:00-12:00|true']
                   FROM schedule_notice_targets('10000000-0000-0000-0000-000000000001', pg_temp.d())), 'targets with a summary of each day');
SELECT pg_temp.ok((SELECT schedule_notice_mark('10000000-0000-0000-0000-000000000001', pg_temp.d(),
                     (SELECT jsonb_agg(jsonb_build_object('staff_id', staff_id, 'hash', hash)) FROM schedule_notice_targets('10000000-0000-0000-0000-000000000001', pg_temp.d()))) = 2), 'marked 2');
SELECT pg_temp.ok(pg_temp.unnotified() = '', 'everyone told');
SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  jsonb_build_array(jsonb_build_object('op', 'update', 'id', pg_temp.ana_block(), 'end', '14:00')));
SELECT pg_temp.ok(pg_temp.unnotified() = 'Ana', 'Ana changed after her notice');
SELECT pg_temp.ok((SELECT NOT first_notice FROM schedule_notice_targets('10000000-0000-0000-0000-000000000001', pg_temp.d())), 'it is a change notice now');
SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  jsonb_build_array(jsonb_build_object('op', 'remove', 'id', pg_temp.ana_block())));
SELECT pg_temp.ok((SELECT summary = '' FROM schedule_notice_targets('10000000-0000-0000-0000-000000000001', pg_temp.d())), 'taken off the board after a notice: still to tell, nothing scheduled');
-- Marking with an old fingerprint leaves them listed
SELECT schedule_notice_mark('10000000-0000-0000-0000-000000000001', pg_temp.d(), jsonb_build_array(jsonb_build_object('staff_id', 'c0000000-0000-0000-0000-000000000001', 'hash', 'old')));
SELECT pg_temp.ok(pg_temp.unnotified() = 'Ana', 'stale mark does not hide a change');
-- Someone not on the day can't be marked
SELECT pg_temp.ok((SELECT schedule_notice_mark('10000000-0000-0000-0000-000000000001', pg_temp.d(), jsonb_build_array(jsonb_build_object('staff_id', 'c0000000-0000-0000-0000-000000000002', 'hash', 'x'))) = 0), 'Bo is not on the day');
SELECT pg_temp.ok((SELECT count(*) > 0 FROM schedule_changes WHERE action = 'notify'), 'notices are logged');
RESET ROLE;

-- 7. The admin's day still works and the switch still closes everything ------------------------------------------
SELECT pg_temp.ok((SELECT count(*) = 1 FROM schedule_days), 'one day');
SELECT pg_temp.as_user(NULL);   -- the service role (an owner's update would be ignored by the super admin guard)
UPDATE centers SET schedule_enabled = false WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT NOT schedule_enabled FROM centers WHERE id = '10000000-0000-0000-0000-000000000001'), 'switched off');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT pg_temp.ok(pg_temp.mine() = '[]'::jsonb, 'switch off: teachers see nothing');
SELECT pg_temp.fails($$SELECT schedule_board('10000000-0000-0000-0000-000000000001', pg_temp.d())$$, 'not turned on');
RESET ROLE;

\echo ALL PASSED

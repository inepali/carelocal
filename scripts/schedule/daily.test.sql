-- Database tests for the daily schedule board (20270101010000_schedule_days.sql), on a throwaway local Postgres:
--   createdb sday && psql -q -d sday -f scripts/schedule/stub.sql -f scripts/schedule/daily-stub.sql \
--     -f supabase/migrations/20270101000000_staff_schedules.sql -f supabase/migrations/20270101010000_schedule_days.sql \
--     -f scripts/schedule/daily.test.sql
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
CREATE FUNCTION pg_temp.as_user(u text, super boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(u, ''), false),
         set_config('request.jwt.claims', CASE WHEN super THEN '{"app_metadata":{"is_super_admin":true}}' ELSE '{}' END, false);
$$;
-- The next Monday on or after the center's today (the fixed schedules below are for Mondays)
CREATE FUNCTION pg_temp.d() RETURNS date LANGUAGE sql AS $$
  SELECT t + ((8 - extract(dow FROM t)::int) % 7) FROM (SELECT public.roster_today('10000000-0000-0000-0000-000000000001') t) x $$;
CREATE FUNCTION pg_temp.ver() RETURNS integer LANGUAGE sql AS $$
  SELECT version FROM schedule_days WHERE center_id = '10000000-0000-0000-0000-000000000001' AND service_date = pg_temp.d() $$;
-- 'Ana' -> 'HH:MI-HH:MI room' list of their boxes, in time order
CREATE FUNCTION pg_temp.boxes(who text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(to_char(b.start_time, 'HH24:MI') || '-' || to_char(b.end_time, 'HH24:MI') || ' ' || COALESCE(w.name, 'Floater'), ', ' ORDER BY b.start_time), '')
  FROM schedule_blocks b JOIN schedule_days dd ON dd.id = b.day_id JOIN staff_profiles sp ON sp.id = b.staff_id LEFT JOIN work_areas w ON w.id = b.work_area_id
  WHERE dd.center_id = '10000000-0000-0000-0000-000000000001' AND dd.service_date = pg_temp.d() AND sp.first_name = who $$;
CREATE FUNCTION pg_temp.block(who text, at text) RETURNS uuid LANGUAGE sql AS $$
  SELECT b.id FROM schedule_blocks b JOIN schedule_days dd ON dd.id = b.day_id JOIN staff_profiles sp ON sp.id = b.staff_id
  WHERE dd.center_id = '10000000-0000-0000-0000-000000000001' AND dd.service_date = pg_temp.d() AND sp.first_name = who AND b.start_time = at::time $$;
-- One change as JSON
CREATE FUNCTION pg_temp.op(j text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_array(j::jsonb) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- Center A: two rooms with ratios, five infants; Ana (Mon 7-3 Infant A), Bo (Mon 9-6 fixed floater), Cy (no fixed
-- schedule), and Sam, a substitute with a confirmed shift in Toddler and a pending one
INSERT INTO auth.users (id) SELECT ('a0000000-0000-0000-0000-0000000000' || x)::uuid FROM unnest(ARRAY['0a', '0b', '01', '02', '03', '04']) x;
INSERT INTO centers (id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A'), ('10000000-0000-0000-0000-000000000002', 'Center B');
UPDATE centers SET schedule_enabled = true;
INSERT INTO center_admins VALUES ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'owner'),
                                 ('a0000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000002', 'admin');
INSERT INTO work_areas (id, center_id, name, sort_order, ratio_children) VALUES
  ('b0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Infant A', 1, 4),
  ('b0000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', 'Toddler', 2, 6),
  ('b0000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000002', 'B room', 1, 4);
INSERT INTO children (center_id, classroom_id) SELECT '10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000a1' FROM generate_series(1, 5);
INSERT INTO children (center_id, classroom_id, status) VALUES ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000a1', 'withdrawn');
INSERT INTO staff_profiles (id, user_id, first_name, last_name) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Ana', 'Lee'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Bo', 'Kim'),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'Cy', 'Ray'),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'Sam', 'Sub');
INSERT INTO center_staff (id, center_id, staff_id, status, employment_class, home_work_area_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'active', 'regular', 'b0000000-0000-0000-0000-0000000000a1'),
  ('d0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'active', 'regular', NULL),
  ('d0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'active', 'regular', NULL);
INSERT INTO shifts (id, center_id, work_area_id, shift_date, start_time, end_time, status) VALUES
  ('e0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000a2', pg_temp.d(), '07:10', '12:50', 'filled'),
  ('e0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000a2', pg_temp.d(), '13:00', '17:00', 'open');
INSERT INTO shift_claims (id, shift_id, staff_id, status) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'confirmed'),
  ('f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004', 'pending');

SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', public.roster_today('10000000-0000-0000-0000-000000000001'),
  '[{"weekday":1,"start":"07:00","end":"15:00","room_id":"b0000000-0000-0000-0000-0000000000a1"}]');
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000002', public.roster_today('10000000-0000-0000-0000-000000000001'),
  '[{"weekday":1,"start":"09:00","end":"18:00","room_id":null}]');

-- 1. Opening builds the day -------------------------------------------------------------------------------------
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), 1, '[{"op":"remove","id":"00000000-0000-0000-0000-000000000000"}]')$$, 'Open this day first');
SELECT pg_temp.ok((SELECT p -> 'day' @> '{"status":"draft","version":1,"weekday":1}' FROM schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d()) p), 'new draft day');
SELECT pg_temp.ok(pg_temp.boxes('Ana') = '07:00-15:00 Infant A', 'Ana from her fixed schedule');
SELECT pg_temp.ok(pg_temp.boxes('Bo') = '09:00-18:00 Floater', 'Bo as a fixed floater');
SELECT pg_temp.ok(pg_temp.boxes('Cy') = '', 'Cy has no fixed schedule: not on the board');
SELECT pg_temp.ok(pg_temp.boxes('Sam') = '07:00-13:00 Toddler', 'confirmed sub shift, rounded out to 15 minutes; pending one left out');
SELECT pg_temp.ok((SELECT (SELECT array_agg(x ->> 'first_name' || ':' || (x ->> 'kind') ORDER BY x ->> 'first_name') FROM jsonb_array_elements(p -> 'people') x)
                     = ARRAY['Ana:regular', 'Bo:regular', 'Cy:regular', 'Sam:sub']
                   FROM schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d()) p), 'people: regulars + the sub');
SELECT pg_temp.ok((SELECT p -> 'rooms' -> 0 @> '{"name":"Infant A","ratio":4,"enrolled":5}' FROM schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d()) p),
                  'room ratio and enrolled children (withdrawn not counted)');
SELECT pg_temp.ok(pg_temp.ver() = 1, 'reopening changes nothing');
SELECT pg_temp.ok((SELECT count(*) = 3 FROM schedule_blocks), 'no duplicates on reopen');
SELECT pg_temp.fails($$SELECT schedule_day_open('10000000-0000-0000-0000-000000000001', public.roster_today('10000000-0000-0000-0000-000000000001') + 100)$$, 'two months ahead');

-- 2. Changing boxes ---------------------------------------------------------------------------------------------
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), 99, pg_temp.op('{"op":"remove","id":"' || pg_temp.block('Ana', '07:00') || '"}'))$$, 'Someone else');
SELECT pg_temp.ok((SELECT (p -> 'day' ->> 'version')::int = 2 FROM schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  pg_temp.op('{"op":"update","id":"' || pg_temp.block('Ana', '07:00') || '","start":"08:00","end":"16:00","room_id":"b0000000-0000-0000-0000-0000000000a2"}')) p), 'move + resize, version up');
SELECT pg_temp.ok(pg_temp.boxes('Ana') = '08:00-16:00 Toddler', 'Ana moved to Toddler 8-4');
-- Only the keys sent change
SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), pg_temp.op('{"op":"update","id":"' || pg_temp.block('Ana', '08:00') || '","end":"16:30"}'));
SELECT pg_temp.ok(pg_temp.boxes('Ana') = '08:00-16:30 Toddler', 'end only');
SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), pg_temp.op('{"op":"update","id":"' || pg_temp.block('Ana', '08:00') || '","end":"16:00"}'));

SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  '[{"op":"add","center_staff_id":"d0000000-0000-0000-0000-000000000003","start":"07:00","end":"12:00","room_id":"b0000000-0000-0000-0000-0000000000a1","note":"cover"}]');
SELECT pg_temp.ok(pg_temp.boxes('Cy') = '07:00-12:00 Infant A', 'Cy added from the tray');
SELECT pg_temp.ok((SELECT source = 'added' AND note = 'cover' FROM schedule_blocks WHERE id = pg_temp.block('Cy', '07:00')), 'added block');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  '[{"op":"add","center_staff_id":"d0000000-0000-0000-0000-000000000003","start":"11:00","end":"13:00","room_id":null}]')$$, 'already on the schedule');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  '[{"op":"add","center_staff_id":"d0000000-0000-0000-0000-000000000003","start":"06:00","end":"06:45"}]')$$, 'outside the center');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  '[{"op":"add","center_staff_id":"d0000000-0000-0000-0000-000000000003","start":"13:10","end":"14:00"}]')$$, '15-minute');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  '[{"op":"add","center_staff_id":"d0000000-0000-0000-0000-000000000003","start":"14:00","end":"13:00"}]')$$, 'end after it starts');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  '[{"op":"add","center_staff_id":"d0000000-0000-0000-0000-000000000003","start":"13:00","end":"14:00","room_id":"b0000000-0000-0000-0000-0000000000b1"}]')$$, 'active rooms');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  '[{"op":"add","center_staff_id":"d0000000-0000-0000-0000-0000000000ff","start":"13:00","end":"14:00"}]')$$, 'regular staff');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), '[{"op":"swap"}]')$$, 'Unknown change');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), '[]')$$, 'Nothing to change');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), '[{"op":"remove","id":"00000000-0000-0000-0000-000000000000"}]')$$, 'no longer on this day');
-- All or nothing: a good change followed by a bad one saves neither
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  ('[{"op":"update","id":"' || pg_temp.block('Cy', '07:00') || '","end":"11:00"},{"op":"add","center_staff_id":"d0000000-0000-0000-0000-000000000003","start":"06:00","end":"07:00"}]')::jsonb)$$, 'outside');
SELECT pg_temp.ok(pg_temp.boxes('Cy') = '07:00-12:00 Infant A', 'nothing saved from a failed batch');

-- Move from 12: Ana's 8-4 becomes 8-12 Toddler, 12-4 Infant A
SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  pg_temp.op('{"op":"split","id":"' || pg_temp.block('Ana', '08:00') || '","at":"12:00","room_id":"b0000000-0000-0000-0000-0000000000a1"}'));
SELECT pg_temp.ok(pg_temp.boxes('Ana') = '08:00-12:00 Toddler, 12:00-16:00 Infant A', 'split');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  pg_temp.op('{"op":"split","id":"' || pg_temp.block('Ana', '08:00') || '","at":"12:00","room_id":null}'))$$, 'between');

-- Substitutes: room yes, hours no, removal no
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  pg_temp.op('{"op":"update","id":"' || pg_temp.block('Sam', '07:00') || '","end":"14:00"}'))$$, 'substitute shift');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  pg_temp.op('{"op":"remove","id":"' || pg_temp.block('Sam', '07:00') || '"}'))$$, 'substitute shift');
SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  pg_temp.op('{"op":"update","id":"' || pg_temp.block('Sam', '07:00') || '","room_id":"b0000000-0000-0000-0000-0000000000a1","start":"07:00"}'));
SELECT pg_temp.ok(pg_temp.boxes('Sam') = '07:00-13:00 Infant A', 'sub moved rooms (same hours allowed)');
SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  pg_temp.op('{"op":"split","id":"' || pg_temp.block('Sam', '07:00') || '","at":"10:00","room_id":"b0000000-0000-0000-0000-0000000000a2"}'));
SELECT pg_temp.ok(pg_temp.boxes('Sam') = '07:00-10:00 Infant A, 10:00-13:00 Toddler', 'sub split');
SELECT pg_temp.ok((SELECT count(*) = 2 FROM schedule_blocks WHERE shift_claim_id = 'f0000000-0000-0000-0000-000000000001' AND source = 'sub'), 'both parts stay the sub''s');

SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), pg_temp.op('{"op":"remove","id":"' || pg_temp.block('Cy', '07:00') || '"}'));
SELECT pg_temp.ok(pg_temp.boxes('Cy') = '', 'removed: Cy back in the tray');

-- 3. Call-outs ----------------------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT p -> 'people' @> '[{"first_name":"Bo","absence":{"kind":"sick","start":null,"note":"flu"}}]'
                   FROM schedule_call_out('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000002', 'sick', NULL, NULL, 'flu') p),
                  'Bo out sick all day');
SELECT pg_temp.ok(pg_temp.boxes('Bo') = '', 'his boxes are cleared');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  '[{"op":"add","center_staff_id":"d0000000-0000-0000-0000-000000000002","start":"13:00","end":"14:00"}]')$$, 'off all day');
SELECT schedule_call_out_undo('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000002');
SELECT pg_temp.ok(pg_temp.boxes('Bo') = '09:00-18:00 Floater', 'undo puts his fixed schedule back');
SELECT pg_temp.fails($$SELECT schedule_call_out_undo('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000002')$$, 'no call-out');

-- Ana out 10-11 (an appointment): 8-12 is trimmed around the hole, 12-4 untouched
SELECT schedule_call_out('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000001', 'other', '10:00', '11:00', NULL);
SELECT pg_temp.ok(pg_temp.boxes('Ana') = '08:00-10:00 Toddler, 11:00-12:00 Toddler, 12:00-16:00 Infant A', 'partial call-out splits the block');
SELECT pg_temp.fails($$SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  '[{"op":"add","center_staff_id":"d0000000-0000-0000-0000-000000000001","start":"10:15","end":"10:45"}]')$$, 'off from 10:00');
-- Leaving early: out from 3 trims the end
SELECT schedule_call_out('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000001', 'other', '15:00', '18:00', 'leaving early');
SELECT pg_temp.ok(pg_temp.boxes('Ana') = '08:00-10:00 Toddler, 11:00-12:00 Toddler, 12:00-15:00 Infant A', 'leaving early trims the end (and replaces the earlier call-out)');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM schedule_absences WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000001'), 'one call-out per person per day');
SELECT pg_temp.fails($$SELECT schedule_call_out('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000001', 'nap', NULL, NULL, NULL)$$, 'reason');
SELECT pg_temp.fails($$SELECT schedule_call_out('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000001', 'sick', '10:00', NULL, NULL)$$, 'both');
SELECT pg_temp.fails($$SELECT schedule_call_out('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000001', 'sick', '11:00', '10:00', NULL)$$, 'after from');
-- Late arrival: out until 9 on a reset day trims the start of her fixed 7-3
SELECT schedule_call_out('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000001', 'called_out', '07:00', '09:00', 'late');
SELECT schedule_reset_person('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000001');
SELECT pg_temp.ok(pg_temp.boxes('Ana') = '09:00-15:00 Infant A', 'reset to fixed, minus the late start');

-- 4. Fixed schedule changes after the day is built don't rewrite it; reset picks them up ---------------------------------
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000002', public.roster_today('10000000-0000-0000-0000-000000000001'),
  '[{"weekday":1,"start":"10:00","end":"14:00","room_id":"b0000000-0000-0000-0000-0000000000a2"}]');
SELECT schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d());
SELECT pg_temp.ok(pg_temp.boxes('Bo') = '09:00-18:00 Floater', 'built day keeps Bo''s old hours');
SELECT schedule_reset_person('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000002');
SELECT pg_temp.ok(pg_temp.boxes('Bo') = '10:00-14:00 Toddler', 'reset brings in the new fixed schedule');
RESET ROLE;

-- 5. Substitute changes are picked up when the day is opened ---------------------------------------------------------
UPDATE shift_claims SET status = 'cancelled' WHERE id = 'f0000000-0000-0000-0000-000000000001';
UPDATE shift_claims SET status = 'confirmed' WHERE id = 'f0000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT v_before < (p -> 'day' ->> 'version')::int FROM (SELECT pg_temp.ver() v_before) x,
                   LATERAL schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d()) p), 'sub sync bumps the version');
SELECT pg_temp.ok(pg_temp.boxes('Sam') = '13:00-17:00 Toddler', 'cancelled claim gone (both parts), newly confirmed one added');
SELECT pg_temp.ok((SELECT v = pg_temp.ver() FROM (SELECT pg_temp.ver() v) x, LATERAL schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d()) p), 'no change, no bump');

-- 6. Publish -------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT p -> 'day' ->> 'status' = 'published' AND p -> 'day' ->> 'published_at' IS NOT NULL
                   FROM schedule_publish('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver()) p), 'published');
SELECT pg_temp.ok((SELECT p -> 'day' ->> 'status' = 'published' FROM schedule_publish('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver()) p), 'publishing twice is fine');
SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(),
  '[{"op":"add","center_staff_id":"d0000000-0000-0000-0000-000000000003","start":"07:00","end":"09:00","room_id":null}]');
SELECT pg_temp.ok((SELECT status = 'published' FROM schedule_days WHERE service_date = pg_temp.d()), 'edits after publish stay published (live)');
SELECT pg_temp.ok((SELECT array_agg(DISTINCT action ORDER BY action) @> ARRAY['add', 'build', 'call_out', 'call_out_undo', 'publish', 'remove', 'reset', 'split', 'sub_sync', 'update']
                   FROM schedule_changes), 'every kind of change is logged');

-- Nobody writes the tables directly
SELECT pg_temp.fails($$DELETE FROM schedule_blocks$$, 'permission denied');
SELECT pg_temp.fails($$UPDATE schedule_days SET status = 'draft'$$, 'permission denied');
SELECT pg_temp.fails($$INSERT INTO schedule_absences (day_id, center_id, service_date, center_staff_id, kind) SELECT id, center_id, service_date, 'd0000000-0000-0000-0000-000000000003', 'sick' FROM schedule_days$$, 'permission denied');
RESET ROLE;

-- 7. Other people ----------------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) = 0 FROM schedule_blocks) AND (SELECT count(*) = 0 FROM schedule_days) AND (SELECT count(*) = 0 FROM schedule_changes), 'RLS: other center sees nothing');
SELECT pg_temp.fails($$SELECT schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d())$$, 'do not have access');
SELECT pg_temp.fails($$SELECT schedule_publish('10000000-0000-0000-0000-000000000001', pg_temp.d(), 1)$$, 'cannot change it');
RESET ROLE;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');   -- Ana, a regular teacher
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) = 0 FROM schedule_blocks), 'teacher reads no rows directly (her view comes in phase 3)');
SELECT pg_temp.fails($$SELECT schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d())$$, 'do not have access');
SELECT pg_temp.fails($$SELECT schedule_call_out('10000000-0000-0000-0000-000000000001', pg_temp.d(), 1, 'd0000000-0000-0000-0000-000000000003', 'sick')$$, 'cannot change it');
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SET ROLE anon;
SELECT pg_temp.fails($$SELECT schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d())$$, 'permission denied');
RESET ROLE;

-- 8. Backstops (service role) and the switch -------------------------------------------------------------------------
SELECT pg_temp.fails($$INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, start_time, end_time, source)
  SELECT id, center_id, service_date, 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '10:00', '11:00', 'added' FROM schedule_days$$, 'overlaps');
SELECT pg_temp.fails($$INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, start_time, end_time, source)
  SELECT id, center_id, service_date, 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', '16:00', '17:00', 'added' FROM schedule_days$$, 'another center');
SELECT pg_temp.fails($$INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, start_time, end_time, source)
  SELECT id, center_id, service_date, 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '16:00', '17:00', 'sub' FROM schedule_days$$, 'sub_source');
UPDATE centers SET schedule_enabled = false WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.fails($$SELECT schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d())$$, 'not turned on');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) > 0 FROM schedule_blocks), 'switching off deletes nothing');

\echo ALL PASSED

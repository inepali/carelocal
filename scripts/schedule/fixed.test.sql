-- Database tests for the staff schedule, phase 1 (20270101000000_staff_schedules.sql), on a throwaway local Postgres:
--   createdb sched && psql -q -d sched -f scripts/schedule/stub.sql \
--     -f supabase/migrations/20270101000000_staff_schedules.sql -f scripts/schedule/fixed.test.sql
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
CREATE FUNCTION pg_temp.today() RETURNS date LANGUAGE sql AS $$ SELECT public.roster_today('10000000-0000-0000-0000-000000000001') $$;
CREATE FUNCTION pg_temp.week(room text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('weekday', d, 'start', '07:00', 'end', '15:00', 'room_id', room)) FROM generate_series(1, 5) d
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- Two centers; center A has two rooms, an old inactive room, and four people
INSERT INTO auth.users (id) SELECT ('a0000000-0000-0000-0000-0000000000' || x)::uuid FROM unnest(ARRAY['0a', '0b', '01', '02', '03', '04', '0f']) x;
INSERT INTO centers (id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A'), ('10000000-0000-0000-0000-000000000002', 'Center B');
INSERT INTO center_admins VALUES ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'owner'),
                                 ('a0000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000002', 'admin');
INSERT INTO work_areas (id, center_id, name, sort_order, is_active) VALUES
  ('b0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Infant A', 1, true),
  ('b0000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', 'Toddler', 2, true),
  ('b0000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-000000000001', 'Old room', 3, false),
  ('b0000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000002', 'B room', 1, true);
INSERT INTO staff_profiles (id, user_id, first_name, last_name) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Ana', 'Lee'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Sam', 'Sub'),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'Ina', 'Gone'),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'Bo', 'Kim');
INSERT INTO center_staff (id, center_id, staff_id, status, employment_class, home_work_area_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'active', 'regular', 'b0000000-0000-0000-0000-0000000000a1'),
  ('d0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'active', 'substitute', NULL),
  ('d0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'inactive', 'regular', NULL),
  ('d0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'active', 'regular', NULL),
  ('d0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'active', 'regular', NULL);

-- 1. Defaults and the super admin guard -----------------------------------------------------------------------
SELECT pg_temp.ok((SELECT NOT schedule_enabled AND schedule_slot_minutes = 15 AND schedule_day_start = '07:00' AND schedule_day_end = '18:00' AND NOT schedule_weekends
                   FROM centers WHERE id = '10000000-0000-0000-0000-000000000001'), 'defaults: off, 15 min, 7-6, no weekends');

SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
UPDATE centers SET schedule_enabled = true, schedule_slot_minutes = 30 WHERE id = '10000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT pg_temp.ok((SELECT NOT schedule_enabled AND schedule_slot_minutes = 15 FROM centers WHERE id = '10000000-0000-0000-0000-000000000001'),
                  'a center owner cannot turn the schedule on or change the snap');

SET ROLE authenticated;
SELECT pg_temp.fails($$SELECT schedule_fixed_list('10000000-0000-0000-0000-000000000001')$$, 'not turned on');
RESET ROLE;

SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000f', true);
SET ROLE authenticated;
UPDATE centers SET schedule_enabled = true, schedule_slot_minutes = 30 WHERE id = '10000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT pg_temp.ok((SELECT schedule_enabled AND schedule_slot_minutes = 30 FROM centers WHERE id = '10000000-0000-0000-0000-000000000001'),
                  'a super admin turns it on and sets the snap');
SELECT pg_temp.fails($$UPDATE centers SET schedule_slot_minutes = 45 WHERE id = '10000000-0000-0000-0000-000000000001'$$, 'slot_minutes_check');
UPDATE centers SET schedule_slot_minutes = 15 WHERE id = '10000000-0000-0000-0000-000000000001';   -- service role (no user) may
SELECT pg_temp.ok((SELECT schedule_slot_minutes = 15 FROM centers WHERE id = '10000000-0000-0000-0000-000000000001'), 'service role changes the snap');
UPDATE centers SET schedule_enabled = true WHERE id = '10000000-0000-0000-0000-000000000002';

-- 2. Owner A: the list --------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT jsonb_array_length(schedule_fixed_list('10000000-0000-0000-0000-000000000001') -> 'rooms') = 2), 'active rooms only');
SELECT pg_temp.ok((SELECT schedule_fixed_list('10000000-0000-0000-0000-000000000001') -> 'rooms' -> 0 ->> 'name' = 'Infant A'), 'rooms in sort order');
SELECT pg_temp.ok((SELECT array_agg(s ->> 'first_name' ORDER BY s ->> 'first_name') = ARRAY['Ana', 'Bo']
                   FROM jsonb_array_elements(schedule_fixed_list('10000000-0000-0000-0000-000000000001') -> 'staff') s),
                  'active regular staff only (no substitute, no inactive)');
SELECT pg_temp.ok((SELECT schedule_fixed_list('10000000-0000-0000-0000-000000000001') -> 'staff' -> 0 ->> 'home_room_id' = 'b0000000-0000-0000-0000-0000000000a1'), 'home room included');
SELECT pg_temp.ok((SELECT (schedule_fixed_list('10000000-0000-0000-0000-000000000001') -> 'settings' ->> 'can_manage')::boolean), 'settings say can_manage');

-- 3. Saving -------------------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), pg_temp.week('b0000000-0000-0000-0000-0000000000a1')) = 5), 'Mon-Fri saved');
SELECT pg_temp.ok((SELECT jsonb_array_length(schedule_fixed_list('10000000-0000-0000-0000-000000000001') -> 'staff' -> 0 -> 'blocks') = 5), 'five blocks listed');
SELECT pg_temp.ok((SELECT (schedule_fixed_list('10000000-0000-0000-0000-000000000001') -> 'staff' -> 0 -> 'blocks' -> 0) @>
                   '{"weekday":1,"start":"07:00","end":"15:00","room_id":"b0000000-0000-0000-0000-0000000000a1"}'::jsonb), 'block shape');
SELECT pg_temp.ok((SELECT schedule_fixed_list('10000000-0000-0000-0000-000000000001') -> 'staff' -> 0 ->> 'next_change' IS NULL), 'no next change');

-- Split day and a fixed floater (no room) are fine; saving again on the same day replaces it
SELECT pg_temp.ok((SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(),
  '[{"weekday":1,"start":"07:00","end":"13:00","room_id":"b0000000-0000-0000-0000-0000000000a1"},
    {"weekday":1,"start":"13:00","end":"15:00","room_id":"b0000000-0000-0000-0000-0000000000a2","notes":"nap cover"},
    {"weekday":2,"start":"09:00","end":"18:00","room_id":null}]') = 3), 'split day + floater');
SELECT pg_temp.ok((SELECT count(*) = 3 FROM staff_fixed_schedules WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000001'), 'same-day save replaced the old pattern');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM staff_fixed_schedules WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000001' AND work_area_id IS NULL), 'floater block has no room');

-- Refusals
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(),
  '[{"weekday":1,"start":"07:00","end":"13:00"},{"weekday":1,"start":"12:00","end":"15:00"}]')$$, 'overlap');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"weekday":1,"start":"13:00","end":"13:00"}]')$$, 'end after it starts');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"weekday":1,"start":"07:10","end":"13:00"}]')$$, '15-minute');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"weekday":1,"start":"06:30","end":"13:00"}]')$$, 'outside the center');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"weekday":6,"start":"08:00","end":"13:00"}]')$$, 'Monday to Friday');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"weekday":7,"start":"08:00","end":"13:00"}]')$$, 'no day');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"weekday":1,"start":"soon","end":"13:00"}]')$$, 'can''t be read');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(),
  '[{"weekday":1,"start":"08:00","end":"13:00","room_id":"b0000000-0000-0000-0000-0000000000b1"}]')$$, 'active rooms');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(),
  '[{"weekday":1,"start":"08:00","end":"13:00","room_id":"b0000000-0000-0000-0000-0000000000a3"}]')$$, 'active rooms');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '{"weekday":1}')$$, 'must be a list');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today() - 1, '[]')$$, 'today or later');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today() + 400, '[]')$$, 'next year');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000002', pg_temp.today(), '[]')$$, 'Substitutes');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000003', pg_temp.today(), '[]')$$, 'active regular');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000005', pg_temp.today(), '[]')$$, 'can''t change');   -- center B's row
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-0000000000ff', pg_temp.today(), '[]')$$, 'can''t change');   -- no such row
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(),
  (SELECT jsonb_agg(jsonb_build_object('weekday', 1, 'start', to_char(time '07:00' + make_interval(mins => 15 * n), 'HH24:MI'),
                                       'end', to_char(time '07:15' + make_interval(mins => 15 * n), 'HH24:MI'))) FROM generate_series(0, 6) n))$$, '6 blocks');

-- Nobody writes the table directly
SELECT pg_temp.fails($$INSERT INTO staff_fixed_schedules (center_id, center_staff_id, weekday, start_time, end_time, effective_from)
  VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 1, '07:00', '08:00', current_date)$$, 'permission denied');
SELECT pg_temp.fails($$DELETE FROM staff_fixed_schedules$$, 'permission denied');
RESET ROLE;

-- 4. Effective dates ------------------------------------------------------------------------------------------
SET ROLE authenticated;
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000004', pg_temp.today(), pg_temp.week('b0000000-0000-0000-0000-0000000000a2'));
-- From next week Bo moves to Infant A
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000004', pg_temp.today() + 7, pg_temp.week('b0000000-0000-0000-0000-0000000000a1'));
SELECT pg_temp.ok((SELECT s -> 'blocks' -> 0 ->> 'room_id' = 'b0000000-0000-0000-0000-0000000000a2' AND (s ->> 'next_change')::date = pg_temp.today() + 7
                   FROM jsonb_array_elements(schedule_fixed_list('10000000-0000-0000-0000-000000000001') -> 'staff') s WHERE s ->> 'first_name' = 'Bo'),
                  'today: Toddler, changes next week');
SELECT pg_temp.ok((SELECT s -> 'blocks' -> 0 ->> 'room_id' = 'b0000000-0000-0000-0000-0000000000a1' AND s ->> 'next_change' IS NULL
                   FROM jsonb_array_elements(schedule_fixed_list('10000000-0000-0000-0000-000000000001', pg_temp.today() + 7) -> 'staff') s WHERE s ->> 'first_name' = 'Bo'),
                  'next week: Infant A');
SELECT pg_temp.ok((SELECT (s -> 'blocks' -> 0 ->> 'to')::date = pg_temp.today() + 6
                   FROM jsonb_array_elements(schedule_fixed_list('10000000-0000-0000-0000-000000000001') -> 'staff') s WHERE s ->> 'first_name' = 'Bo'),
                  'the current pattern ends the day before');
-- A change from day 3 replaces the one saved for day 7
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000004', pg_temp.today() + 3, '[{"weekday":3,"start":"10:00","end":"14:00","room_id":null}]');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM staff_fixed_schedules WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000004' AND effective_from = pg_temp.today() + 7),
                  'later version replaced');
SELECT pg_temp.ok((SELECT count(*) = 5 FROM staff_fixed_schedules WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000004' AND effective_to = pg_temp.today() + 2),
                  'first version now ends on day 2');
-- An empty pattern from day 10: a floater from then on
SELECT pg_temp.ok((SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000004', pg_temp.today() + 10, '[]') = 0), 'empty save');
SELECT pg_temp.ok((SELECT jsonb_array_length(s -> 'blocks') = 0
                   FROM jsonb_array_elements(schedule_fixed_list('10000000-0000-0000-0000-000000000001', pg_temp.today() + 10) -> 'staff') s WHERE s ->> 'first_name' = 'Bo'),
                  'no blocks from day 10');
SELECT pg_temp.ok((SELECT (s ->> 'next_change')::date = pg_temp.today() + 10
                   FROM jsonb_array_elements(schedule_fixed_list('10000000-0000-0000-0000-000000000001', pg_temp.today() + 5) -> 'staff') s WHERE s ->> 'first_name' = 'Bo'),
                  'next_change shows when a pattern ends');
RESET ROLE;

-- 5. Settings ---------------------------------------------------------------------------------------------------
SET ROLE authenticated;
SELECT pg_temp.fails($$SELECT schedule_settings_save('10000000-0000-0000-0000-000000000001', '08:00', '18:00', false)$$, 'fall outside');
SELECT pg_temp.fails($$SELECT schedule_settings_save('10000000-0000-0000-0000-000000000001', '07:00', '06:00', false)$$, 'end after it starts');
SELECT pg_temp.fails($$SELECT schedule_settings_save('10000000-0000-0000-0000-000000000001', '07:05', '18:00', false)$$, 'quarter');
SELECT pg_temp.ok((SELECT schedule_settings_save('10000000-0000-0000-0000-000000000001', '06:30', '18:30', true) @>
                   '{"day_start":"06:30","day_end":"18:30","weekends":true}'::jsonb), 'wider day + weekends saved');
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"weekday":6,"start":"06:30","end":"12:00","room_id":null}]');
SELECT pg_temp.fails($$SELECT schedule_settings_save('10000000-0000-0000-0000-000000000001', '06:30', '18:30', false)$$, 'Saturday or Sunday');
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), pg_temp.week('b0000000-0000-0000-0000-0000000000a1'));
SELECT pg_temp.ok((SELECT schedule_settings_save('10000000-0000-0000-0000-000000000001', '07:00', '18:00', false) ->> 'weekends' = 'false'), 'back to Mon-Fri');
-- The owner still cannot touch the switch through the settings
SELECT pg_temp.ok((SELECT schedule_enabled AND schedule_slot_minutes = 15 FROM centers WHERE id = '10000000-0000-0000-0000-000000000001'), 'switch untouched');
RESET ROLE;

-- 6. Other people -------------------------------------------------------------------------------------------------
-- Center B's admin sees none of A's rows and can't call A's functions
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) = 0 FROM staff_fixed_schedules), 'RLS: other center sees nothing');
SELECT pg_temp.fails($$SELECT schedule_fixed_list('10000000-0000-0000-0000-000000000001')$$, 'do not have access');
SELECT pg_temp.fails($$SELECT schedule_settings('10000000-0000-0000-0000-000000000001')$$, 'do not have access');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[]')$$, 'can''t change');
SELECT pg_temp.ok((SELECT jsonb_array_length(schedule_fixed_list('10000000-0000-0000-0000-000000000002') -> 'staff') = 1), 'B sees its own teacher');
RESET ROLE;

-- A regular teacher reads the settings but not the list, and can't save
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT schedule_settings('10000000-0000-0000-0000-000000000001') @> '{"enabled":true,"slot_minutes":15,"can_manage":false}'::jsonb), 'teacher reads settings');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM staff_fixed_schedules), 'teacher reads no rows directly');
SELECT pg_temp.fails($$SELECT schedule_fixed_list('10000000-0000-0000-0000-000000000001')$$, 'do not have access');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[]')$$, 'can''t change');
SELECT pg_temp.fails($$SELECT schedule_settings_save('10000000-0000-0000-0000-000000000001', '07:00', '18:00', false)$$, 'cannot change it');
RESET ROLE;

-- A substitute and anonymous visitors get nothing
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SET ROLE authenticated;
SELECT pg_temp.fails($$SELECT schedule_settings('10000000-0000-0000-0000-000000000001')$$, 'do not have access');
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SET ROLE anon;
SELECT pg_temp.fails($$SELECT schedule_settings('10000000-0000-0000-0000-000000000001')$$, 'permission denied');
SELECT pg_temp.fails($$SELECT * FROM staff_fixed_schedules$$, 'permission denied');
RESET ROLE;

-- 7. Backstops (service role, no checks in the way) --------------------------------------------------------------
SELECT pg_temp.fails($$INSERT INTO staff_fixed_schedules (center_id, center_staff_id, weekday, start_time, end_time, effective_from)
  VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 1, '08:00', '09:00', current_date)$$, 'overlaps');
SELECT pg_temp.fails($$INSERT INTO staff_fixed_schedules (center_id, center_staff_id, weekday, start_time, end_time, effective_from)
  VALUES ('10000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 1, '16:00', '17:00', current_date)$$, 'another center');
SELECT pg_temp.fails($$INSERT INTO staff_fixed_schedules (center_id, center_staff_id, weekday, start_time, end_time, effective_from, work_area_id)
  VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 1, '16:00', '17:00', current_date, 'b0000000-0000-0000-0000-0000000000b1')$$, 'another center');
SELECT pg_temp.fails($$INSERT INTO staff_fixed_schedules (center_id, center_staff_id, weekday, start_time, end_time, effective_from)
  VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 1, '16:20', '17:00', current_date)$$, 'staff_fixed_schedules_times');
-- A room that is deleted turns its blocks into floater blocks; a teacher who leaves takes their pattern along
DELETE FROM work_areas WHERE id = 'b0000000-0000-0000-0000-0000000000a2';
SELECT pg_temp.ok((SELECT count(*) = 0 FROM staff_fixed_schedules WHERE work_area_id = 'b0000000-0000-0000-0000-0000000000a2'), 'room delete sets NULL');
DELETE FROM center_staff WHERE id = 'd0000000-0000-0000-0000-000000000004';
SELECT pg_temp.ok((SELECT count(*) = 0 FROM staff_fixed_schedules WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000004'), 'staff delete cascades');

-- 8. Switching it off closes it again (rows are kept)
UPDATE centers SET schedule_enabled = false WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT pg_temp.fails($$SELECT schedule_fixed_list('10000000-0000-0000-0000-000000000001')$$, 'not turned on');
SELECT pg_temp.ok((SELECT schedule_settings('10000000-0000-0000-0000-000000000001') @> '{"enabled":false,"can_manage":false}'::jsonb), 'settings say off');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) > 0 FROM staff_fixed_schedules), 'turning it off deletes nothing');

\echo ALL PASSED

-- Database tests for the Time Clock (20270120000000_time_clock.sql). Run: sh scripts/timeclock/run.sh
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
CREATE FUNCTION pg_temp.h(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;
CREATE FUNCTION pg_temp.today() RETURNS date LANGUAGE sql AS $$ SELECT public.roster_today('10000000-0000-0000-0000-000000000001') $$;
-- The Monday 2 weeks from now (time off and schedule days)
CREATE FUNCTION pg_temp.mon() RETURNS date LANGUAGE sql AS $$ SELECT pg_temp.today() + 14 + ((8 - extract(dow FROM pg_temp.today())::int) % 7) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- Center A (owner Olive), Center B (owner Bea). Ana and Bo regular at A, Sam substitute at A, Lou left A.
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'olive@a.test'), ('a0000000-0000-0000-0000-00000000000b', 'bea@b.test'),
  ('a0000000-0000-0000-0000-000000000001', 'ana@a.test'), ('a0000000-0000-0000-0000-000000000002', 'bo@a.test'),
  ('a0000000-0000-0000-0000-000000000004', 'sam@a.test'), ('a0000000-0000-0000-0000-000000000005', 'lou@a.test');
INSERT INTO centers (id, name, timezone) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Center A', 'America/New_York'), ('10000000-0000-0000-0000-000000000002', 'Center B', 'America/Chicago');
UPDATE centers SET schedule_enabled = true;
INSERT INTO center_admins VALUES ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'owner'),
                                 ('a0000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000002', 'owner');
INSERT INTO work_areas (id, center_id, name) VALUES ('b0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Infant A');
INSERT INTO staff_profiles (id, user_id, first_name, last_name) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Ana', 'Lee'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Bo', 'Kim'),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'Sam', 'Sub'),
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', 'Lou', 'Left');
INSERT INTO center_staff (id, center_id, staff_id, status, employment_class, employment_start_date) VALUES
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'active', 'regular', DATE '2020-03-15'),
  ('d0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'active', 'regular', DATE '2024-02-29'),
  ('d0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'active', 'substitute', NULL),
  ('d0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'active', 'regular', NULL);

-- 1. Module switch and admin access ---------------------------------------------------------------------------------
SET ROLE authenticated;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
UPDATE centers SET timeclock_enabled = true WHERE id = '10000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT pg_temp.ok(NOT (SELECT timeclock_enabled FROM centers WHERE id = '10000000-0000-0000-0000-000000000001'), 'an owner cannot turn the module on');
SET ROLE authenticated;
SELECT pg_temp.fails($$SELECT timeclock_overview('10000000-0000-0000-0000-000000000001')$$, 'not turned on');
RESET ROLE;
SELECT pg_temp.as_user(NULL);
UPDATE centers SET timeclock_enabled = true, roster_enabled = true WHERE id = '10000000-0000-0000-0000-000000000001';
UPDATE centers SET timeclock_enabled = true WHERE id = '10000000-0000-0000-0000-000000000002';

SET ROLE authenticated;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SELECT pg_temp.ok(jsonb_array_length(timeclock_overview('10000000-0000-0000-0000-000000000001') -> 'staff') = 4, 'overview lists the staff');
SELECT pg_temp.ok((timeclock_overview('10000000-0000-0000-0000-000000000001') #>> '{settings,pay_period}') = 'weekly', 'default pay period');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
SELECT pg_temp.fails($$SELECT timeclock_overview('10000000-0000-0000-0000-000000000001')$$, 'Only the owner');
SELECT pg_temp.fails($$SELECT timeclock_pin_set('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', pg_temp.h('x'))$$, 'Only the owner');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SELECT pg_temp.fails($$SELECT timeclock_overview('10000000-0000-0000-0000-000000000001')$$, 'Only the owner');
SELECT pg_temp.fails($$SELECT timeclock_device('x')$$, 'permission denied');
SELECT pg_temp.fails($$SELECT timeclock_punch('x', 'y', 'in')$$, 'permission denied');
SELECT pg_temp.fails($$SELECT * FROM staff_time_pins$$, 'permission denied');
SELECT pg_temp.fails($$INSERT INTO time_entries (center_id, center_staff_id, clock_in) VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', now())$$, 'permission denied');

-- 2. PINs and devices ------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SELECT timeclock_pin_set('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', pg_temp.h('A:2580'));
SELECT timeclock_pin_set('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', pg_temp.h('A:3691'));
SELECT timeclock_pin_set('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', pg_temp.h('A:4702'));
SELECT timeclock_pin_set('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005', pg_temp.h('A:5813'));
SELECT pg_temp.fails($$SELECT timeclock_pin_set('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', pg_temp.h('A:2580'))$$, 'Someone else');
SELECT pg_temp.fails($$SELECT timeclock_pin_set('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'nothex')$$, 'Bad PIN');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(timeclock_overview('10000000-0000-0000-0000-000000000001') -> 'staff') s WHERE (s ->> 'has_pin')::boolean) = 4, 'four PINs set');
SELECT pg_temp.fails($$SELECT timeclock_device_register('10000000-0000-0000-0000-000000000001', pg_temp.h('tok1'), '  ')$$, 'Give the tablet a name');
SELECT timeclock_device_register('10000000-0000-0000-0000-000000000001', pg_temp.h('tok1'), 'Front desk');
SELECT timeclock_device_register('10000000-0000-0000-0000-000000000001', pg_temp.h('tok2'), 'Old tablet');
SELECT pg_temp.ok(jsonb_array_length(timeclock_overview('10000000-0000-0000-0000-000000000001') -> 'devices') = 2, 'two tablets');
SELECT pg_temp.ok(NOT (timeclock_overview('10000000-0000-0000-0000-000000000001') -> 'devices' -> 0 ? 'token_hash'), 'token hash never shown');
RESET ROLE;
SELECT id AS old_dev FROM timeclock_devices WHERE name = 'Old tablet' \gset
SET ROLE authenticated;
SELECT timeclock_device_revoke('10000000-0000-0000-0000-000000000001', :'old_dev');
RESET ROLE;
-- Lou leaves the center
UPDATE center_staff SET status = 'inactive' WHERE id = 'd0000000-0000-0000-0000-000000000005';

-- 3. The tablet -------------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user(NULL);
SET ROLE service_role;
SELECT pg_temp.ok((timeclock_device(pg_temp.h('tok1')) ->> 'device_name') = 'Front desk', 'device found');
SELECT pg_temp.ok((timeclock_device(pg_temp.h('tok1')) #>> '{center,name}') = 'Center A', 'device center');
SELECT pg_temp.ok(timeclock_device(pg_temp.h('tok2')) IS NULL, 'revoked device is not a Time Clock');
SELECT pg_temp.ok(timeclock_device(pg_temp.h('nope')) IS NULL, 'unknown device');
SELECT pg_temp.ok((timeclock_identify(pg_temp.h('tok2'), pg_temp.h('A:2580')) ->> 'status') = 'no_device', 'PIN on a revoked device');
SELECT pg_temp.ok((timeclock_identify(pg_temp.h('tok1'), pg_temp.h('A:2580')) #>> '{person,name}') = 'Ana Lee', 'PIN finds Ana');
SELECT pg_temp.ok((timeclock_identify(pg_temp.h('tok1'), pg_temp.h('A:2580')) #>> '{person,clocked_in_at}') IS NULL, 'not clocked in yet');
SELECT pg_temp.ok((timeclock_identify(pg_temp.h('tok1'), pg_temp.h('A:5813')) ->> 'status') = 'invalid', 'a PIN of someone who left does not work');

-- Clock in and out
SELECT pg_temp.ok((timeclock_punch(pg_temp.h('tok1'), pg_temp.h('A:2580'), 'in') ->> 'action') = 'in', 'Ana clocks in');
SELECT pg_temp.ok((timeclock_punch(pg_temp.h('tok1'), pg_temp.h('A:2580'), 'in') ->> 'status') = 'already_in', 'second clock-in is refused');
SELECT pg_temp.ok((timeclock_identify(pg_temp.h('tok1'), pg_temp.h('A:2580')) #>> '{person,clocked_in_at}') IS NOT NULL, 'shows clocked in');
SELECT pg_temp.ok((timeclock_punch(pg_temp.h('tok1'), pg_temp.h('A:3691'), 'out') ->> 'status') = 'not_in', 'Bo cannot clock out before in');
SELECT pg_temp.ok((timeclock_punch(pg_temp.h('tok1'), pg_temp.h('A:2580'), 'out') ->> 'action') = 'out', 'Ana clocks out');
SELECT pg_temp.ok((SELECT count(*) FROM time_entries WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000001' AND clock_out IS NOT NULL) = 1, 'one closed period');
SELECT pg_temp.ok((SELECT array_agg(action ORDER BY id) FROM time_entry_log) = ARRAY['clock_in', 'clock_out'], 'punches logged');
SELECT pg_temp.ok((SELECT in_device_id IS NOT NULL AND out_device_id IS NOT NULL FROM time_entries LIMIT 1), 'device on the entry');
SELECT pg_temp.fails($$SELECT timeclock_punch(pg_temp.h('tok1'), pg_temp.h('A:2580'), 'sideways')$$, 'Bad punch');
RESET ROLE;

-- A period left open overnight becomes a missed clock-out; the person can clock in again
INSERT INTO time_entries (center_id, center_staff_id, clock_in) VALUES
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', now() - interval '20 hours');
SET ROLE service_role;
SELECT pg_temp.ok((timeclock_identify(pg_temp.h('tok1'), pg_temp.h('A:3691')) #>> '{person,clocked_in_at}') IS NULL, 'stale period is not "clocked in"');
SELECT pg_temp.ok((timeclock_identify(pg_temp.h('tok1'), pg_temp.h('A:3691')) #>> '{person,missed}')::boolean, 'missed clock-out flagged');
SELECT pg_temp.ok((timeclock_punch(pg_temp.h('tok1'), pg_temp.h('A:3691'), 'in') ->> 'status') = 'ok', 'Bo clocks in after a missed clock-out');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM time_entries WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000002' AND missed_out) = 1, 'missed one kept');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM time_entry_log WHERE action = 'missed_out'), 'missed clock-out logged');

-- Wrong PINs lock the tablet (5 per 15 minutes), even for a right PIN afterwards
DELETE FROM timeclock_attempts;
SET ROLE service_role;
SELECT timeclock_identify(pg_temp.h('tok1'), pg_temp.h('A:000' || n)) FROM generate_series(1, 4) n;
SELECT pg_temp.ok((timeclock_identify(pg_temp.h('tok1'), pg_temp.h('A:0009')) ->> 'left') = '0', 'fifth wrong PIN: none left');
SELECT pg_temp.ok((timeclock_identify(pg_temp.h('tok1'), pg_temp.h('A:2580')) ->> 'status') = 'locked', 'locked after 5 wrong PINs');
SELECT pg_temp.ok((timeclock_punch(pg_temp.h('tok1'), pg_temp.h('A:2580'), 'in') ->> 'status') = 'locked', 'punch also locked');
RESET ROLE;
DELETE FROM timeclock_attempts;

-- 4. My Room by PIN ---------------------------------------------------------------------------------------------------
SET ROLE service_role;
SELECT pg_temp.ok((timeclock_room_user(pg_temp.h('tok1'), pg_temp.h('A:2580')) ->> 'email') = 'ana@a.test', 'regular teacher gets My Room');
SELECT pg_temp.ok((timeclock_room_user(pg_temp.h('tok1'), pg_temp.h('A:4702')) ->> 'status') = 'no_room', 'substitute does not');
RESET ROLE;
UPDATE centers SET roster_enabled = false WHERE id = '10000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT pg_temp.ok((timeclock_room_user(pg_temp.h('tok1'), pg_temp.h('A:2580')) ->> 'status') = 'no_room', 'no Live Roster: no My Room');
SELECT pg_temp.ok(NOT (timeclock_identify(pg_temp.h('tok1'), pg_temp.h('A:2580')) #>> '{person,room}')::boolean, 'person shows no room');
RESET ROLE;
UPDATE centers SET roster_enabled = true WHERE id = '10000000-0000-0000-0000-000000000001';

-- 5. Admin fixes --------------------------------------------------------------------------------------------------------
SET ROLE authenticated;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SELECT pg_temp.ok(jsonb_array_length(timeclock_entries('10000000-0000-0000-0000-000000000001', pg_temp.today() - 2, pg_temp.today())) = 3, 'three entries');
SELECT pg_temp.ok((SELECT count(*) FROM time_entries) = 3, 'admin reads entries (RLS)');
SELECT pg_temp.fails($$SELECT timeclock_entry_save('10000000-0000-0000-0000-000000000001', (SELECT id FROM time_entries WHERE missed_out), NULL,
  now() - interval '20 hours', now() - interval '12 hours', '')$$, 'Say why');
SELECT timeclock_entry_save('10000000-0000-0000-0000-000000000001', (SELECT id FROM time_entries WHERE missed_out), NULL,
  now() - interval '20 hours', now() - interval '12 hours', 'Forgot to clock out');
SELECT pg_temp.ok((SELECT count(*) FROM time_entries WHERE missed_out) = 0, 'missed clock-out fixed');
SELECT pg_temp.ok((SELECT before ->> 'missed_out' FROM time_entry_log WHERE action = 'edit') = 'true', 'edit logged with the row before');
SELECT pg_temp.fails($$SELECT timeclock_entry_save('10000000-0000-0000-0000-000000000001', NULL, 'd0000000-0000-0000-0000-000000000002',
  now() - interval '13 hours', now() - interval '11 hours', 'Added')$$, 'overlaps');
SELECT pg_temp.fails($$SELECT timeclock_entry_save('10000000-0000-0000-0000-000000000001', NULL, 'd0000000-0000-0000-0000-000000000002',
  now() + interval '1 hour', NULL, 'Future')$$, 'future');
SELECT pg_temp.fails($$SELECT timeclock_entry_save('10000000-0000-0000-0000-000000000001', NULL, 'd0000000-0000-0000-0000-000000000002',
  now() - interval '50 hours', now() - interval '20 hours', 'Too long')$$, '24 hours');
SELECT timeclock_entry_save('10000000-0000-0000-0000-000000000001', NULL, 'd0000000-0000-0000-0000-000000000004',
  now() - interval '30 hours', now() - interval '26 hours', 'Paper timesheet');
SELECT pg_temp.ok((SELECT source FROM time_entries WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000004') = 'admin', 'admin-added period');
SELECT timeclock_entry_delete('10000000-0000-0000-0000-000000000001', (SELECT id FROM time_entries WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000004'), 'Duplicate');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM time_entry_log WHERE action = 'delete' AND reason = 'Duplicate'), 'delete logged');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000b');
SELECT pg_temp.ok((SELECT count(*) FROM time_entries) = 0, 'other center owner reads none');
SELECT pg_temp.fails($$SELECT timeclock_entry_delete('10000000-0000-0000-0000-000000000002', (SELECT id FROM time_entries LIMIT 1), 'Nope')$$, 'gone');
RESET ROLE;

-- 6. PTO years, balance and carry-over ----------------------------------------------------------------------------------
SELECT pg_temp.ok(timeclock_pto_year('d0000000-0000-0000-0000-000000000001', DATE '2027-05-01') = daterange(DATE '2027-01-01', DATE '2028-01-01'), 'calendar year');
INSERT INTO timeclock_settings (center_id, pto_year, carryover_max_hours) VALUES ('10000000-0000-0000-0000-000000000001', 'anniversary', 10);
SELECT pg_temp.ok(timeclock_pto_year('d0000000-0000-0000-0000-000000000001', DATE '2027-03-14') = daterange(DATE '2026-03-15', DATE '2027-03-15'), 'anniversary year (day before)');
SELECT pg_temp.ok(timeclock_pto_year('d0000000-0000-0000-0000-000000000001', DATE '2027-03-15') = daterange(DATE '2027-03-15', DATE '2028-03-15'), 'anniversary year (on the day)');
SELECT pg_temp.ok(timeclock_pto_year('d0000000-0000-0000-0000-000000000002', DATE '2025-02-28') = daterange(DATE '2025-02-28', DATE '2026-02-28'), 'Feb 29 start, Feb 28');
SELECT pg_temp.ok(timeclock_pto_year('d0000000-0000-0000-0000-000000000002', DATE '2025-02-27') = daterange(DATE '2024-02-29', DATE '2025-02-28'), 'Feb 29 start, first year');
SELECT pg_temp.ok(timeclock_pto_year('d0000000-0000-0000-0000-000000000002', DATE '2024-01-01') = daterange(DATE '2023-02-28', DATE '2024-02-29'), 'before the start date');
-- Ana: 40 h a year; last PTO year she used 24, so 16 unused, capped at 10
INSERT INTO staff_pto_allowances (center_staff_id, center_id, yearly_hours) VALUES ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 40);
INSERT INTO time_off_requests (center_id, center_staff_id, kind, start_date, end_date, hours, status, via)
SELECT '10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'pto', lower(y) + 10, lower(y) + 12, 24, 'approved', 'admin'
  FROM (SELECT timeclock_pto_year('d0000000-0000-0000-0000-000000000001', lower(timeclock_pto_year('d0000000-0000-0000-0000-000000000001', pg_temp.today())) - 1) y) x;
SELECT pg_temp.ok((timeclock_pto_balance('d0000000-0000-0000-0000-000000000001', pg_temp.today()) ->> 'carry_over')::numeric = 10, 'carry-over capped at 10');
SELECT pg_temp.ok((timeclock_pto_balance('d0000000-0000-0000-0000-000000000001', pg_temp.today()) ->> 'remaining')::numeric = 50, '40 + 10 left');
UPDATE timeclock_settings SET carryover_max_hours = 0;
SELECT pg_temp.ok((timeclock_pto_balance('d0000000-0000-0000-0000-000000000001', pg_temp.today()) ->> 'carry_over')::numeric = 0, 'no carry-over when the cap is 0');
UPDATE timeclock_settings SET pto_year = 'calendar', carryover_max_hours = 10;
-- Bo has no allowance: remaining 0
SELECT pg_temp.ok((timeclock_pto_balance('d0000000-0000-0000-0000-000000000002', pg_temp.today()) ->> 'remaining')::numeric = 0, 'no PTO hours');

-- 7. Time off -------------------------------------------------------------------------------------------------------------
-- Ana's fixed schedule on Mondays and Tuesdays; the Monday is opened on the Daily Schedule before the approval
SET ROLE authenticated;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(),
  '[{"weekday":1,"start":"08:00","end":"16:00","room_id":"b0000000-0000-0000-0000-0000000000a1"},{"weekday":2,"start":"08:00","end":"16:00","room_id":"b0000000-0000-0000-0000-0000000000a1"}]');
SELECT schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.mon());
SELECT pg_temp.ok((SELECT count(*) FROM schedule_blocks WHERE service_date = pg_temp.mon() AND center_staff_id = 'd0000000-0000-0000-0000-000000000001') = 1, 'Ana scheduled Monday');
RESET ROLE;

SET ROLE service_role;
SELECT pg_temp.as_user(NULL);
-- Bo has no PTO: refused; Unpaid is fine
SELECT pg_temp.fails($$SELECT timeclock_request_off(pg_temp.h('tok1'), pg_temp.h('A:3691'), 'pto', pg_temp.mon(), pg_temp.mon(), true, NULL)$$, 'are left this year');
SELECT pg_temp.ok((timeclock_request_off(pg_temp.h('tok1'), pg_temp.h('A:3691'), 'unpaid', pg_temp.mon(), pg_temp.mon(), true, 'Moving') ->> 'status') = 'ok', 'unpaid request');
SELECT pg_temp.fails($$SELECT timeclock_request_off(pg_temp.h('tok1'), pg_temp.h('A:3691'), 'sick', pg_temp.mon(), pg_temp.mon() + 1, true, NULL)$$, 'already a time off');
SELECT pg_temp.fails($$SELECT timeclock_request_off(pg_temp.h('tok1'), pg_temp.h('A:3691'), 'sick', pg_temp.mon() + 5, pg_temp.mon() + 6, true, NULL)$$, 'weekend');
SELECT pg_temp.fails($$SELECT timeclock_request_off(pg_temp.h('tok1'), pg_temp.h('A:3691'), 'sick', pg_temp.mon() + 8, pg_temp.mon() + 9, false, NULL)$$, 'half day is one day');
SELECT pg_temp.fails($$SELECT timeclock_request_off(pg_temp.h('tok1'), pg_temp.h('A:3691'), 'sick', pg_temp.today() - 10, pg_temp.today() - 10, true, NULL)$$, 'a week ago');
-- Ana: Monday and Tuesday PTO = 16 h, then a half day
SELECT pg_temp.ok((timeclock_request_off(pg_temp.h('tok1'), pg_temp.h('A:2580'), 'pto', pg_temp.mon(), pg_temp.mon() + 1, true, 'Trip') #>> '{person,pto,pending}')::numeric = 16, 'pending 16 h');
SELECT timeclock_request_off(pg_temp.h('tok1'), pg_temp.h('A:2580'), 'pto', pg_temp.mon() + 3, pg_temp.mon() + 3, false, NULL);
SELECT pg_temp.ok((SELECT hours FROM time_off_requests WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000001' AND NOT full_day) = 4, 'half day = 4 h');
SELECT pg_temp.ok((timeclock_identify(pg_temp.h('tok1'), pg_temp.h('A:2580')) #>> '{person,pto,remaining}')::numeric = 40 + 10 - 20, 'remaining counts pending');
-- Cancel the half day on the tablet; Bo cannot cancel Ana's
SELECT pg_temp.fails($$SELECT timeclock_cancel_off(pg_temp.h('tok1'), pg_temp.h('A:3691'), (SELECT id FROM time_off_requests WHERE NOT full_day))$$, 'Only a request');
SELECT timeclock_cancel_off(pg_temp.h('tok1'), pg_temp.h('A:2580'), (SELECT id FROM time_off_requests WHERE NOT full_day));
SELECT pg_temp.ok((SELECT status FROM time_off_requests WHERE NOT full_day) = 'cancelled', 'half day cancelled');
RESET ROLE;

-- The owner approves Ana's 2 days: Monday (already opened) is marked off; Tuesday is built later without her boxes
SET ROLE authenticated;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(timeclock_off_list('10000000-0000-0000-0000-000000000001', pg_temp.today(), pg_temp.today())) r
                   WHERE r ->> 'status' = 'pending') = 2, 'two requests waiting');
SELECT timeclock_off_decide('10000000-0000-0000-0000-000000000001',
  (SELECT id FROM time_off_requests WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000001' AND status = 'pending'), 'approved', NULL, 'Have fun');
SELECT pg_temp.fails($$SELECT timeclock_off_decide('10000000-0000-0000-0000-000000000001',
  (SELECT id FROM time_off_requests WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000001' AND status = 'approved' AND kind = 'pto' AND start_date = pg_temp.mon()), 'denied', NULL, NULL)$$, 'already answered');
SELECT pg_temp.ok((SELECT count(*) FROM schedule_blocks WHERE service_date = pg_temp.mon() AND center_staff_id = 'd0000000-0000-0000-0000-000000000001') = 0, 'Monday boxes gone');
SELECT pg_temp.ok((SELECT kind FROM schedule_absences WHERE service_date = pg_temp.mon() AND center_staff_id = 'd0000000-0000-0000-0000-000000000001') = 'pto', 'Monday marked PTO');
SELECT schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.mon() + 1);
SELECT pg_temp.ok((SELECT count(*) FROM schedule_blocks WHERE service_date = pg_temp.mon() + 1 AND center_staff_id = 'd0000000-0000-0000-0000-000000000001') = 0, 'Tuesday built without her');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM schedule_absences WHERE service_date = pg_temp.mon() + 1 AND time_off_id IS NOT NULL), 'Tuesday marked off');
SELECT pg_temp.ok((timeclock_overview('10000000-0000-0000-0000-000000000001') -> 'staff' -> 0 #>> '{pto,used}')::numeric = 16, 'used 16 h');
-- Deny Bo's unpaid day
SELECT timeclock_off_decide('10000000-0000-0000-0000-000000000001',
  (SELECT id FROM time_off_requests WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000002'), 'denied', NULL, 'We are short that day');
-- Cancel Ana's approved time off: both days get her fixed schedule back
SELECT timeclock_off_decide('10000000-0000-0000-0000-000000000001',
  (SELECT id FROM time_off_requests WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000001' AND status = 'approved' AND start_date = pg_temp.mon()), 'cancelled', NULL, 'Trip moved');
SELECT pg_temp.ok((SELECT count(*) FROM schedule_blocks WHERE service_date IN (pg_temp.mon(), pg_temp.mon() + 1) AND center_staff_id = 'd0000000-0000-0000-0000-000000000001') = 2, 'boxes back on both days');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM schedule_absences WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000001'), 'absences gone');
-- The owner records a sick day for Sam: approved right away, no balance check
SELECT timeclock_off_add('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'sick', pg_temp.today() - 20, pg_temp.today() - 20, true, 6, 'Called in');
SELECT pg_temp.ok((SELECT status = 'approved' AND hours = 6 AND via = 'admin' FROM time_off_requests WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000004'), 'admin-entered sick day');
-- Settings
SELECT pg_temp.fails($$SELECT timeclock_settings_save('10000000-0000-0000-0000-000000000001', 'monthly', DATE '2026-01-05', 'calendar', 0, 8)$$, 'weekly or every 2 weeks');
SELECT timeclock_settings_save('10000000-0000-0000-0000-000000000001', 'biweekly', DATE '2026-01-05', 'anniversary', 16, 7.5);
SELECT pg_temp.ok((timeclock_overview('10000000-0000-0000-0000-000000000001') -> 'settings') @> '{"pay_period":"biweekly","pto_year":"anniversary","full_day_hours":7.5}', 'settings saved');

-- 8. Staff portal ----------------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.ok(jsonb_array_length(timeclock_mine()) = 1, 'Bo sees his center');
SELECT pg_temp.ok(jsonb_array_length(timeclock_mine() -> 0 -> 'entries') = 2, 'Bo sees his two periods');
SELECT pg_temp.ok(jsonb_array_length(timeclock_mine() -> 0 -> 'requests') = 1, 'Bo sees his request');
SELECT timeclock_my_request('10000000-0000-0000-0000-000000000001', 'sick', pg_temp.mon() + 2, pg_temp.mon() + 2, true, NULL);
RESET ROLE;
SELECT pg_temp.ok((SELECT hours = 7.5 AND via = 'portal' FROM time_off_requests WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000002' AND status = 'pending'), 'portal request, 7.5 h day');
SELECT id AS denied_id FROM time_off_requests WHERE status = 'denied' \gset
SELECT id AS bo_pending FROM time_off_requests WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000002' AND status = 'pending' \gset
SET ROLE authenticated;
SELECT pg_temp.fails(format($$SELECT timeclock_my_cancel('10000000-0000-0000-0000-000000000001', %L)$$, :'denied_id'), 'Only a request');
SELECT timeclock_my_cancel('10000000-0000-0000-0000-000000000001', :'bo_pending');
SELECT pg_temp.fails($$SELECT timeclock_my_request('10000000-0000-0000-0000-000000000002', 'sick', pg_temp.mon(), pg_temp.mon(), true, NULL)$$, 'not turned on for you');
SELECT pg_temp.ok((SELECT count(*) FROM time_off_requests) = 0, 'staff cannot read the table directly');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000005');
SELECT pg_temp.ok(jsonb_array_length(timeclock_mine()) = 0, 'someone who left sees nothing');
RESET ROLE;

-- 9. Module off: tablet and admin stop ----------------------------------------------------------------------------------------
SELECT pg_temp.as_user(NULL);
UPDATE centers SET timeclock_enabled = false WHERE id = '10000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT pg_temp.ok(timeclock_device(pg_temp.h('tok1')) IS NULL, 'module off: tablet is not a Time Clock');
SELECT pg_temp.ok((timeclock_punch(pg_temp.h('tok1'), pg_temp.h('A:2580'), 'in') ->> 'status') = 'no_device', 'module off: no punches');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SELECT pg_temp.ok((SELECT count(*) FROM time_entries) = 0, 'module off: entries hidden');
RESET ROLE;

SELECT 'ALL PASSED';

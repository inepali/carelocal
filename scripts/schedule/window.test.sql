-- Database tests for a fixed schedule with an end date (20270101030000_fixed_schedule_window.sql), on a throwaway Postgres:
--   createdb swin && psql -q -d swin -f scripts/schedule/stub.sql -f supabase/migrations/20270101000000_staff_schedules.sql \
--     -f supabase/migrations/20270101030000_fixed_schedule_window.sql -f scripts/schedule/window.test.sql
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
CREATE FUNCTION pg_temp.t(n integer DEFAULT 0) RETURNS date LANGUAGE sql AS $$ SELECT public.roster_today('10000000-0000-0000-0000-000000000001') + n $$;
-- Monday's room on a day: 'Infant A 07:00-15:00', 'Floater ...' or '' (none)
CREATE FUNCTION pg_temp.monday(on_day date) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(COALESCE(w.name, 'Floater') || ' ' || to_char(f.start_time, 'HH24:MI') || '-' || to_char(f.end_time, 'HH24:MI'), ', ' ORDER BY f.start_time), '')
  FROM staff_fixed_schedules f LEFT JOIN work_areas w ON w.id = f.work_area_id
  WHERE f.center_staff_id = 'd0000000-0000-0000-0000-000000000001' AND f.weekday = 1
    AND f.effective_from <= on_day AND (f.effective_to IS NULL OR f.effective_to >= on_day) $$;
CREATE FUNCTION pg_temp.week(room text, s text, e text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('weekday', d, 'start', s, 'end', e, 'room_id', room)) FROM generate_series(1, 5) d $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

INSERT INTO auth.users (id) VALUES ('a0000000-0000-0000-0000-00000000000a'), ('a0000000-0000-0000-0000-000000000001');
INSERT INTO centers (id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A');
UPDATE centers SET schedule_enabled = true;
INSERT INTO center_admins VALUES ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'owner');
INSERT INTO work_areas (id, center_id, name, sort_order) VALUES
  ('b0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Infant A', 1),
  ('b0000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', 'Toddler', 2);
INSERT INTO staff_profiles (id, user_id, first_name) VALUES ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Ana');
INSERT INTO center_staff (id, center_id, staff_id, status, employment_class) VALUES
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'active', 'regular');

SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;

-- Her usual week: Infant A 7-3, no end
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.t(), pg_temp.week('b0000000-0000-0000-0000-0000000000a1', '07:00', '15:00'));

-- A summer schedule from day 10 through day 40 in Toddler 8-2
SELECT pg_temp.ok((SELECT schedule_fixed_save_window('d0000000-0000-0000-0000-000000000001', pg_temp.t(10), pg_temp.t(40),
                    pg_temp.week('b0000000-0000-0000-0000-0000000000a2', '08:00', '14:00')) = 5), 'window saved');
SELECT pg_temp.ok(pg_temp.monday(pg_temp.t(9)) = 'Infant A 07:00-15:00', 'before the window: usual week');
SELECT pg_temp.ok(pg_temp.monday(pg_temp.t(10)) = 'Toddler 08:00-14:00', 'first day of the window');
SELECT pg_temp.ok(pg_temp.monday(pg_temp.t(40)) = 'Toddler 08:00-14:00', 'last day of the window');
SELECT pg_temp.ok(pg_temp.monday(pg_temp.t(41)) = 'Infant A 07:00-15:00', 'after: the usual week comes back');
SELECT pg_temp.ok(pg_temp.monday(pg_temp.t(500)) = 'Infant A 07:00-15:00', 'and keeps going');
SELECT pg_temp.ok((SELECT (s ->> 'next_change')::date = pg_temp.t(10) FROM jsonb_array_elements(schedule_fixed_list('10000000-0000-0000-0000-000000000001') -> 'staff') s),
                  'the list shows the coming change');
SELECT pg_temp.ok((SELECT (s ->> 'next_change')::date = pg_temp.t(41) AND (s -> 'blocks' -> 0 ->> 'to')::date = pg_temp.t(40)
                   FROM jsonb_array_elements(schedule_fixed_list('10000000-0000-0000-0000-000000000001', pg_temp.t(20)) -> 'staff') s),
                  'during the window: it ends on day 40, changes back on 41');

-- A second window inside the first (day 20-25 floater 9-1) splits it and leaves both sides
SELECT schedule_fixed_save_window('d0000000-0000-0000-0000-000000000001', pg_temp.t(20), pg_temp.t(25), pg_temp.week(NULL, '09:00', '13:00'));
SELECT pg_temp.ok(pg_temp.monday(pg_temp.t(19)) = 'Toddler 08:00-14:00' AND pg_temp.monday(pg_temp.t(22)) = 'Floater 09:00-13:00'
                  AND pg_temp.monday(pg_temp.t(26)) = 'Toddler 08:00-14:00' AND pg_temp.monday(pg_temp.t(41)) = 'Infant A 07:00-15:00',
                  'nested window: summer, floater week, summer again, then the usual week');

-- An empty window: no fixed hours (floater) for days 60-62, then back
SELECT pg_temp.ok((SELECT schedule_fixed_save_window('d0000000-0000-0000-0000-000000000001', pg_temp.t(60), pg_temp.t(62), '[]') = 0), 'empty window');
SELECT pg_temp.ok(pg_temp.monday(pg_temp.t(61)) = '' AND pg_temp.monday(pg_temp.t(63)) = 'Infant A 07:00-15:00', 'off the fixed schedule for three days only');

-- With nothing after, they are a floater after the end
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.t(100), '[]');
SELECT schedule_fixed_save_window('d0000000-0000-0000-0000-000000000001', pg_temp.t(110), pg_temp.t(120), pg_temp.week('b0000000-0000-0000-0000-0000000000a1', '07:00', '12:00'));
SELECT pg_temp.ok(pg_temp.monday(pg_temp.t(115)) = 'Infant A 07:00-12:00' AND pg_temp.monday(pg_temp.t(121)) = '', 'no pattern after: floater after the end');

-- No end date behaves like the plain save (replaces everything from the start on)
SELECT schedule_fixed_save_window('d0000000-0000-0000-0000-000000000001', pg_temp.t(200), NULL, pg_temp.week('b0000000-0000-0000-0000-0000000000a2', '07:00', '16:00'));
SELECT pg_temp.ok(pg_temp.monday(pg_temp.t(900)) = 'Toddler 07:00-16:00', 'open-ended');

-- Same checks as the plain save, and nothing changes when one fails
SELECT pg_temp.fails($$SELECT schedule_fixed_save_window('d0000000-0000-0000-0000-000000000001', pg_temp.t(5), pg_temp.t(4), '[]')$$, 'on or after the start');
SELECT pg_temp.fails($$SELECT schedule_fixed_save_window('d0000000-0000-0000-0000-000000000001', pg_temp.t(5), pg_temp.t(1000), '[]')$$, 'two years');
SELECT pg_temp.fails($$SELECT schedule_fixed_save_window('d0000000-0000-0000-0000-000000000001', pg_temp.t(-1), pg_temp.t(4), '[]')$$, 'today or later');
SELECT pg_temp.fails($$SELECT schedule_fixed_save_window('d0000000-0000-0000-0000-000000000001', pg_temp.t(5), pg_temp.t(8),
  '[{"weekday":1,"start":"07:00","end":"12:00"},{"weekday":1,"start":"11:00","end":"13:00"}]')$$, 'overlap');
SELECT pg_temp.ok(pg_temp.monday(pg_temp.t(6)) = 'Infant A 07:00-15:00', 'a refused window changes nothing');
RESET ROLE;

-- A teacher can't
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT pg_temp.fails($$SELECT schedule_fixed_save_window('d0000000-0000-0000-0000-000000000001', pg_temp.t(5), pg_temp.t(8), '[]')$$, 'can''t change');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.monday(pg_temp.t(6)) = 'Infant A 07:00-15:00', 'refused for a teacher, nothing changed');

\echo ALL PASSED

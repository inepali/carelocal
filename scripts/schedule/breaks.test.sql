-- Database tests for breaks and break covers (20270101040000_schedule_breaks.sql), on a throwaway local Postgres:
--   createdb sbrk && psql -q -d sbrk -f scripts/schedule/stub.sql -f scripts/schedule/daily-stub.sql \
--     -f supabase/migrations/20270101000000_staff_schedules.sql -f supabase/migrations/20270101010000_schedule_days.sql \
--     -f supabase/migrations/20270101020000_schedule_teacher.sql -f supabase/migrations/20270101030000_fixed_schedule_window.sql \
--     -f supabase/migrations/20270101040000_schedule_breaks.sql -f scripts/schedule/breaks.test.sql
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
CREATE FUNCTION pg_temp.today() RETURNS date LANGUAGE sql AS $$ SELECT public.roster_today('10000000-0000-0000-0000-000000000001') $$;
CREATE FUNCTION pg_temp.d() RETURNS date LANGUAGE sql AS $$ SELECT pg_temp.today() + ((8 - extract(dow FROM pg_temp.today())::int) % 7) $$;
CREATE FUNCTION pg_temp.ver() RETURNS integer LANGUAGE sql AS $$
  SELECT version FROM schedule_days WHERE center_id = '10000000-0000-0000-0000-000000000001' AND service_date = pg_temp.d() $$;
-- A person's boxes: 'work 07:00-11:00 Infant A, break 11:00-12:00 Infant A, ...'
CREATE FUNCTION pg_temp.boxes(who text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(b.kind || ' ' || to_char(b.start_time, 'HH24:MI') || '-' || to_char(b.end_time, 'HH24:MI') || ' ' || COALESCE(w.name, 'Floater'), ', ' ORDER BY b.start_time), '')
  FROM schedule_blocks b JOIN staff_profiles sp ON sp.id = b.staff_id LEFT JOIN work_areas w ON w.id = b.work_area_id
  WHERE b.service_date = pg_temp.d() AND sp.first_name = who $$;
-- Covers in a room: '10:00-11:00 Bo, 14:00-14:30 -'
CREATE FUNCTION pg_temp.covers(room text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(to_char(b.start_time, 'HH24:MI') || '-' || to_char(b.end_time, 'HH24:MI') || ' ' || COALESCE(sp.first_name, '-'), ', ' ORDER BY b.start_time), '')
  FROM schedule_blocks b JOIN work_areas w ON w.id = b.work_area_id LEFT JOIN staff_profiles sp ON sp.id = b.staff_id
  WHERE b.service_date = pg_temp.d() AND b.kind = 'cover' AND w.name = room $$;
CREATE FUNCTION pg_temp.blk(who text, kind text, at text) RETURNS uuid LANGUAGE sql AS $$
  SELECT b.id FROM schedule_blocks b JOIN staff_profiles sp ON sp.id = b.staff_id
  WHERE b.service_date = pg_temp.d() AND sp.first_name = who AND b.kind = kind AND b.start_time = at::time $$;
CREATE FUNCTION pg_temp.cov(room text, at text) RETURNS uuid LANGUAGE sql AS $$
  SELECT b.id FROM schedule_blocks b JOIN work_areas w ON w.id = b.work_area_id
  WHERE b.service_date = pg_temp.d() AND b.kind = 'cover' AND w.name = room AND b.start_time = at::time $$;
CREATE FUNCTION pg_temp.go(ops jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT schedule_apply('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), ops) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- Center A: Infant A and Toddler. Ana (Mon 7-3 Infant A, usual break 11-12), Bo (Mon 9-6 floater, break 1-2),
-- Cy (no fixed schedule), Sam (substitute, confirmed Toddler 8-12)
INSERT INTO auth.users (id) SELECT ('a0000000-0000-0000-0000-0000000000' || x)::uuid FROM unnest(ARRAY['0a', '01', '02', '03', '04']) x;
INSERT INTO centers (id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A');
UPDATE centers SET schedule_enabled = true;
INSERT INTO center_admins VALUES ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'owner');
INSERT INTO work_areas (id, center_id, name, sort_order, ratio_children) VALUES
  ('b0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Infant A', 1, 4),
  ('b0000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', 'Toddler', 2, 6);
INSERT INTO staff_profiles (id, user_id, first_name, last_name) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Ana', 'Lee'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Bo', 'Kim'),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'Cy', 'Ray'),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'Sam', 'Sub');
INSERT INTO center_staff (id, center_id, staff_id, status, employment_class) VALUES
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'active', 'regular'),
  ('d0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'active', 'regular'),
  ('d0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'active', 'regular');
INSERT INTO shifts (id, center_id, work_area_id, shift_date, start_time, end_time, status) VALUES
  ('e0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000a2', pg_temp.d(), '08:00', '12:00', 'filled');
INSERT INTO shift_claims (id, shift_id, staff_id, status) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'confirmed');

SELECT pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;

-- 1. Breaks in the fixed schedule -----------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(),
  '[{"weekday":1,"start":"07:00","end":"15:00","room_id":"b0000000-0000-0000-0000-0000000000a1"},{"weekday":1,"start":"11:00","end":"12:00","kind":"break"}]') = 2),
  'work + usual break saved');
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000002', pg_temp.today(),
  '[{"weekday":1,"start":"09:00","end":"18:00","room_id":null},{"weekday":1,"start":"13:00","end":"14:00","kind":"break","room_id":"b0000000-0000-0000-0000-0000000000a1"}]');
SELECT pg_temp.ok((SELECT work_area_id IS NULL FROM staff_fixed_schedules WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000002' AND kind = 'break'),
                  'a break has no room of its own');
SELECT pg_temp.ok((SELECT s -> 'blocks' @> '[{"kind":"break","start":"11:00","end":"12:00"}]' FROM jsonb_array_elements(schedule_fixed_list('10000000-0000-0000-0000-000000000001') -> 'staff') s
                   WHERE s ->> 'first_name' = 'Ana'), 'fixed list shows the break');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000003', pg_temp.today(),
  '[{"weekday":1,"start":"07:00","end":"12:00"},{"weekday":1,"start":"12:00","end":"13:00","kind":"break"}]')$$, 'inside their working hours');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000003', pg_temp.today(),
  '[{"weekday":1,"start":"07:00","end":"12:00"},{"weekday":1,"start":"07:00","end":"12:00","kind":"break"}]')$$, 'inside their working hours');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000003', pg_temp.today(),
  '[{"weekday":1,"start":"07:00","end":"15:00"},{"weekday":1,"start":"11:00","end":"12:00","kind":"break"},{"weekday":1,"start":"11:30","end":"12:30","kind":"break"}]')$$, 'overlap');
SELECT pg_temp.fails($$SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000003', pg_temp.today(), '[{"weekday":1,"start":"07:00","end":"15:00","kind":"nap"}]')$$, 'either working hours or a break');
-- A window keeps breaks on both sides
SELECT schedule_fixed_save_window('d0000000-0000-0000-0000-000000000001', pg_temp.today() + 100, pg_temp.today() + 110, '[]');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM staff_fixed_schedules WHERE center_staff_id = 'd0000000-0000-0000-0000-000000000001' AND kind = 'break' AND effective_from = pg_temp.today() + 111),
                  'the usual break comes back after a window');
SELECT schedule_fixed_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(),
  '[{"weekday":1,"start":"07:00","end":"15:00","room_id":"b0000000-0000-0000-0000-0000000000a1"},{"weekday":1,"start":"11:00","end":"12:00","kind":"break"}]');

-- 2. Building the day cuts the breaks out ---------------------------------------------------------------------------
SELECT schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d());
SELECT pg_temp.ok(pg_temp.boxes('Ana') = 'work 07:00-11:00 Infant A, break 11:00-12:00 Infant A, work 12:00-15:00 Infant A', 'Ana: break cut out, in her room');
SELECT pg_temp.ok(pg_temp.boxes('Bo') = 'work 09:00-13:00 Floater, break 13:00-14:00 Floater, work 14:00-18:00 Floater', 'Bo: floater with a break');
SELECT pg_temp.ok((SELECT p -> 'blocks' @> '[{"kind":"break","start":"11:00"}]' FROM schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d()) p), 'payload has kinds');

-- 3. A break on the board, with an empty cover ------------------------------------------------------------------------
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'break', 'id', pg_temp.blk('Ana', 'work', '12:00'), 'start', '14:00', 'end', '14:30')));
SELECT pg_temp.ok(pg_temp.boxes('Ana') = 'work 07:00-11:00 Infant A, break 11:00-12:00 Infant A, work 12:00-14:00 Infant A, break 14:00-14:30 Infant A, work 14:30-15:00 Infant A',
                  'second break cut out');
SELECT pg_temp.ok(pg_temp.covers('Infant A') = '14:00-14:30 -', 'and an empty cover in her room');
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'break', 'id', pg_temp.blk('Bo', 'work', '14:00'), 'start', '16:00', 'end', '16:15')));
SELECT pg_temp.ok((SELECT count(*) = 1 FROM schedule_blocks WHERE kind = 'cover'), 'a floater''s break adds no cover (no room)');
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'remove', 'id', pg_temp.blk('Bo', 'break', '16:00'))));
SELECT pg_temp.ok(pg_temp.boxes('Bo') = 'work 09:00-13:00 Floater, break 13:00-14:00 Floater, work 14:00-18:00 Floater', 'removing a break gives the time back (merged)');
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'break', 'id', pg_temp.blk('Ana', 'work', '07:00'), 'start', '09:00', 'end', '09:15', 'cover', false)));
SELECT pg_temp.ok((SELECT count(*) = 1 FROM schedule_blocks WHERE kind = 'cover'), 'cover: false adds none');
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'remove', 'id', pg_temp.blk('Ana', 'break', '09:00'))));
SELECT pg_temp.fails($$SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'break', 'id', pg_temp.blk('Ana', 'work', '07:00'), 'start', '10:30', 'end', '11:30')))$$, 'between');
SELECT pg_temp.fails($$SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'break', 'id', pg_temp.blk('Ana', 'work', '07:00'), 'start', '07:00', 'end', '11:00')))$$, 'whole box');

-- 4. Covers: new, assign, move, take off ---------------------------------------------------------------------------------
SELECT pg_temp.go('[{"op":"cover","room_id":"b0000000-0000-0000-0000-0000000000a2","start":"10:00","end":"11:00"}]');
SELECT pg_temp.ok(pg_temp.covers('Toddler') = '10:00-11:00 -', 'empty cover from the tray');
SELECT pg_temp.fails($$SELECT pg_temp.go('[{"op":"cover","room_id":null,"start":"10:00","end":"11:00"}]')$$, 'needs a room');
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'assign', 'id', pg_temp.cov('Toddler', '10:00'), 'staff_id', 'c0000000-0000-0000-0000-000000000002')));
SELECT pg_temp.ok(pg_temp.covers('Toddler') = '10:00-11:00 Bo', 'Bo on the cover');
SELECT pg_temp.ok(pg_temp.boxes('Bo') = 'work 09:00-10:00 Floater, cover 10:00-11:00 Toddler, work 11:00-13:00 Floater, break 13:00-14:00 Floater, work 14:00-18:00 Floater',
                  'his Floaters time was taken for it');
-- Moving the cover keeps Bo on it and moves the time it takes
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'update', 'id', pg_temp.cov('Toddler', '10:00'), 'start', '10:30', 'end', '11:30')));
SELECT pg_temp.ok(pg_temp.boxes('Bo') = 'work 09:00-10:30 Floater, cover 10:30-11:30 Toddler, work 11:30-13:00 Floater, break 13:00-14:00 Floater, work 14:00-18:00 Floater',
                  'moved cover: Bo still on it');
-- Into his break: he comes off and it stays empty? no: the move is refused, nothing changes
SELECT pg_temp.fails($$SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'update', 'id', pg_temp.cov('Toddler', '10:30'), 'start', '13:00', 'end', '14:00')))$$, 'on a break');
SELECT pg_temp.ok(pg_temp.covers('Toddler') = '10:30-11:30 Bo', 'refused move changed nothing');
-- Taking him off gives the time back
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'assign', 'id', pg_temp.cov('Toddler', '10:30'), 'staff_id', NULL)));
SELECT pg_temp.ok(pg_temp.boxes('Bo') = 'work 09:00-13:00 Floater, break 13:00-14:00 Floater, work 14:00-18:00 Floater', 'off the cover: time back, merged');
SELECT pg_temp.ok(pg_temp.covers('Toddler') = '10:30-11:30 -', 'cover back to needs someone');
-- Who can't: someone on a break, someone in a room, a sub outside their shift, a stranger
SELECT pg_temp.fails($$SELECT pg_temp.go('[{"op":"cover","room_id":"b0000000-0000-0000-0000-0000000000a1","start":"11:00","end":"12:00","staff_id":"c0000000-0000-0000-0000-000000000001"}]')$$, 'on a break');
SELECT pg_temp.fails($$SELECT pg_temp.go('[{"op":"cover","room_id":"b0000000-0000-0000-0000-0000000000a1","start":"10:00","end":"11:00","staff_id":"c0000000-0000-0000-0000-000000000004"}]')$$, 'is in Toddler');
SELECT pg_temp.fails($$SELECT pg_temp.go('[{"op":"cover","room_id":"b0000000-0000-0000-0000-0000000000a1","start":"13:00","end":"14:00","staff_id":"c0000000-0000-0000-0000-000000000004"}]')$$, 'doesn''t cover');
SELECT pg_temp.fails($$SELECT pg_temp.go('[{"op":"cover","room_id":"b0000000-0000-0000-0000-0000000000a1","start":"13:00","end":"14:00","staff_id":"c0000000-0000-0000-0000-0000000000ff"}]')$$, 'someone on the team');
SELECT pg_temp.ok((SELECT count(*) = 2 FROM schedule_blocks WHERE kind = 'cover'), 'refused covers were not saved');
-- Cy (no boxes) on Ana's break cover
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'assign', 'id', pg_temp.cov('Infant A', '14:00'), 'staff_id', 'c0000000-0000-0000-0000-000000000003')));
SELECT pg_temp.ok(pg_temp.boxes('Cy') = 'cover 14:00-14:30 Infant A', 'Cy on the cover, nothing taken');
SELECT pg_temp.fails($$SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'split', 'id', pg_temp.cov('Infant A', '14:00'), 'at', '14:15', 'room_id', null)))$$, 'moved, resized, assigned or removed');
SELECT pg_temp.fails($$SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'assign', 'id', pg_temp.blk('Ana', 'work', '07:00'), 'staff_id', null)))$$, 'Only a break cover');

-- 5. Moving and changing breaks -----------------------------------------------------------------------------------------
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'update', 'id', pg_temp.blk('Ana', 'break', '11:00'), 'start', '11:30', 'end', '12:30')));
SELECT pg_temp.ok(pg_temp.boxes('Ana') = 'work 07:00-11:30 Infant A, break 11:30-12:30 Infant A, work 12:30-14:00 Infant A, break 14:00-14:30 Infant A, work 14:30-15:00 Infant A',
                  'break moved later, the hours follow');
SELECT pg_temp.fails($$SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'update', 'id', pg_temp.blk('Ana', 'break', '11:30'), 'start', '15:00', 'end', '16:00')))$$, 'inside one of');
SELECT pg_temp.ok(pg_temp.boxes('Ana') LIKE '%break 11:30-12:30%', 'refused break move changed nothing');
SELECT pg_temp.fails($$SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'split', 'id', pg_temp.blk('Ana', 'break', '11:30'), 'at', '12:00', 'room_id', null)))$$, 'moved, resized or removed');
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'remove', 'id', pg_temp.blk('Ana', 'break', '14:00'))));
SELECT pg_temp.ok(pg_temp.boxes('Ana') = 'work 07:00-11:30 Infant A, break 11:30-12:30 Infant A, work 12:30-15:00 Infant A', 'removed break: hours merged');
SELECT pg_temp.ok(pg_temp.covers('Infant A') = '14:00-14:30 Cy', 'its cover stays (the admin removes it if not needed)');

-- 6. Call-outs, undo and resets keep covers ------------------------------------------------------------------------------
SELECT schedule_call_out('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000003', 'sick', NULL, NULL, NULL);
SELECT pg_temp.ok(pg_temp.covers('Infant A') = '14:00-14:30 -', 'Cy out sick: her cover needs someone again');
SELECT schedule_call_out_undo('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000003');
SELECT pg_temp.ok(pg_temp.covers('Infant A') = '14:00-14:30 -' AND pg_temp.boxes('Cy') = '', 'undo: she has no fixed schedule, cover still empty');
SELECT schedule_reset_person('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000001');
SELECT pg_temp.ok(pg_temp.boxes('Ana') = 'work 07:00-11:00 Infant A, break 11:00-12:00 Infant A, work 12:00-15:00 Infant A', 'reset: fixed schedule and usual break');
-- Ana covers Toddler 3-4 after her day; a reset keeps it and fills around it
SELECT pg_temp.go('[{"op":"cover","room_id":"b0000000-0000-0000-0000-0000000000a2","start":"15:00","end":"16:00","staff_id":"c0000000-0000-0000-0000-000000000001"}]');
SELECT schedule_reset_person('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000001');
SELECT pg_temp.ok(pg_temp.covers('Toddler') = '10:30-11:30 -, 15:00-16:00 Ana', 'reset keeps her cover');
-- Leaving at 2: her 12-3 is trimmed and her 3-4 cover needs someone
SELECT schedule_call_out('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver(), 'd0000000-0000-0000-0000-000000000001', 'other', '14:00', '18:00', 'appointment');
SELECT pg_temp.ok(pg_temp.boxes('Ana') = 'work 07:00-11:00 Infant A, break 11:00-12:00 Infant A, work 12:00-14:00 Infant A', 'leaving early trims her day');
SELECT pg_temp.ok(pg_temp.covers('Toddler') = '10:30-11:30 -, 15:00-16:00 -', 'and frees her cover');
SELECT pg_temp.fails($$SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'assign', 'id', pg_temp.cov('Toddler', '15:00'), 'staff_id', 'c0000000-0000-0000-0000-000000000001')))$$, 'off then');

-- 7. A substitute on a cover, then their shift is cancelled ------------------------------------------------------------------
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'update', 'id', pg_temp.blk('Sam', 'work', '08:00'), 'room_id', NULL)));
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'assign', 'id', pg_temp.cov('Toddler', '10:30'), 'staff_id', 'c0000000-0000-0000-0000-000000000004')));
SELECT pg_temp.ok(pg_temp.boxes('Sam') = 'work 08:00-10:30 Floater, cover 10:30-11:30 Toddler, work 11:30-12:00 Floater', 'a floating sub covers a break');
SELECT pg_temp.ok((SELECT source = 'sub' AND shift_claim_id IS NOT NULL FROM schedule_blocks WHERE id = pg_temp.cov('Toddler', '10:30')), 'the cover is on his shift');
SELECT schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d());
SELECT pg_temp.ok(pg_temp.boxes('Sam') = 'work 08:00-10:30 Floater, cover 10:30-11:30 Toddler, work 11:30-12:00 Floater', 'reopening doesn''t add his shift again');
RESET ROLE;
UPDATE shift_claims SET status = 'cancelled' WHERE id = 'f0000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d());
SELECT pg_temp.ok(pg_temp.boxes('Sam') = '' AND pg_temp.covers('Toddler') = '10:30-11:30 -, 15:00-16:00 -', 'cancelled: his boxes go, the cover stays empty');

-- 8. Teachers and notices -----------------------------------------------------------------------------------------------------
SELECT pg_temp.go(jsonb_build_array(jsonb_build_object('op', 'assign', 'id', pg_temp.cov('Toddler', '10:30'), 'staff_id', 'c0000000-0000-0000-0000-000000000002')));
SELECT schedule_publish('10000000-0000-0000-0000-000000000001', pg_temp.d(), pg_temp.ver());
SELECT pg_temp.ok((SELECT bool_and(u::text IS NOT NULL) FROM jsonb_array_elements(schedule_day_open('10000000-0000-0000-0000-000000000001', pg_temp.d()) -> 'unnotified') u), 'no empty-cover entries to notify');
SELECT pg_temp.ok((SELECT summary = 'Floater 09:00-10:30 · Break cover Toddler 10:30-11:30 · Floater 11:30-13:00 · Break 13:00-14:00 · Floater 14:00-18:00'
                   FROM schedule_notice_targets('10000000-0000-0000-0000-000000000001', pg_temp.d()) WHERE first_name = 'Bo'), 'Bo''s notice names the break and the cover');
RESET ROLE;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT my_schedule(pg_temp.d(), pg_temp.d()) -> 0 -> 'blocks' @> '[{"kind":"cover","room_name":"Toddler"},{"kind":"break","start":"13:00"}]'), 'Bo sees his cover and break');
SELECT pg_temp.ok((SELECT b -> 'blocks' @> '[{"kind":"cover","staff_id":null}]' AND NOT (b -> 'people' @> '[{"staff_id":null}]')
                   FROM schedule_board('10000000-0000-0000-0000-000000000001', pg_temp.d()) b), 'board: empty covers shown, no empty person');
RESET ROLE;

-- 9. Backstop: an empty cover is the only box with nobody on it
SELECT pg_temp.fails($$INSERT INTO schedule_blocks (day_id, center_id, service_date, work_area_id, start_time, end_time, kind, source)
  SELECT id, center_id, service_date, 'b0000000-0000-0000-0000-0000000000a1', '16:00', '17:00', 'work', 'added' FROM schedule_days$$, 'one_owner');

\echo ALL PASSED

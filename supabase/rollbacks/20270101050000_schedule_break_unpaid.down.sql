-- Rollback for 20270101050000_schedule_break_unpaid.sql. schedule_apply goes back to its 20270101040000 definition.
-- Days already changed keep their times (the extra time after a break stays as working time).
CREATE OR REPLACE FUNCTION public.schedule_apply(p_center_id uuid, p_date date, p_version integer, p_ops jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d schedule_days%ROWTYPE; v_c centers%ROWTYPE; o jsonb; b schedule_blocks%ROWTYPE; w schedule_blocks%ROWTYPE; cs center_staff%ROWTYPE;
  v_op text; v_room uuid; v_s time; v_e time; v_at time; v_note text; v_staff uuid; v_cs uuid; v_label text; v_prev uuid; v_new uuid;
  a schedule_absences%ROWTYPE;
BEGIN
  d := public.schedule_lock_day(p_center_id, p_date, p_version);
  SELECT * INTO v_c FROM centers WHERE id = p_center_id;
  IF jsonb_typeof(COALESCE(p_ops, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_ops) = 0 THEN
    RAISE EXCEPTION 'Nothing to change' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_ops) > 50 THEN
    RAISE EXCEPTION 'Too many changes at once' USING ERRCODE = '22023';
  END IF;

  FOR o IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
    v_op := o ->> 'op';
    BEGIN
      v_room := CASE WHEN o ? 'room_id' THEN NULLIF(o ->> 'room_id', '')::uuid END;
      v_s := CASE WHEN o ? 'start' THEN (o ->> 'start')::time END;
      v_e := CASE WHEN o ? 'end' THEN (o ->> 'end')::time END;
      v_at := CASE WHEN o ? 'at' THEN (o ->> 'at')::time END;
      v_new := CASE WHEN o ? 'staff_id' THEN NULLIF(o ->> 'staff_id', '')::uuid END;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'A change has a time, room or person that can''t be read' USING ERRCODE = '22023';
    END;
    v_note := NULLIF(btrim(COALESCE(o ->> 'note', '')), '');
    IF length(v_note) > 200 THEN RAISE EXCEPTION 'Notes are 200 characters at most' USING ERRCODE = '22023'; END IF;
    IF o ? 'room_id' AND v_room IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM work_areas wa WHERE wa.id = v_room AND wa.center_id = p_center_id AND COALESCE(wa.is_active, true)
    ) THEN
      RAISE EXCEPTION 'That room isn''t one of this center''s active rooms' USING ERRCODE = '22023';
    END IF;

    -- A new break cover
    IF v_op = 'cover' THEN
      IF v_room IS NULL THEN RAISE EXCEPTION 'A break cover needs a room' USING ERRCODE = '22023'; END IF;
      PERFORM public.schedule_check_time(v_s, 'Start'); PERFORM public.schedule_check_time(v_e, 'End');
      IF v_e <= v_s THEN RAISE EXCEPTION 'A box has to end after it starts' USING ERRCODE = '22023'; END IF;
      IF v_s < v_c.schedule_day_start OR v_e > v_c.schedule_day_end THEN
        RAISE EXCEPTION '% to % is outside the center''s day (% to %)', public.schedule_hhmi(v_s), public.schedule_hhmi(v_e),
          public.schedule_hhmi(v_c.schedule_day_start), public.schedule_hhmi(v_c.schedule_day_end) USING ERRCODE = '22023';
      END IF;
      INSERT INTO schedule_blocks (day_id, center_id, service_date, work_area_id, start_time, end_time, kind, source, note, updated_by)
      VALUES (d.id, p_center_id, p_date, v_room, v_s, v_e, 'cover', 'added', v_note, auth.uid()) RETURNING id INTO v_prev;
      IF v_new IS NOT NULL THEN PERFORM public.schedule_cover_assign(d, v_prev, v_new); END IF;
      PERFORM public.schedule_log(d, 'cover', jsonb_build_object('room_id', v_room, 'start', public.schedule_hhmi(v_s), 'end', public.schedule_hhmi(v_e), 'staff_id', v_new));
      CONTINUE;
    END IF;

    IF v_op = 'add' THEN
      SELECT * INTO cs FROM center_staff WHERE id = NULLIF(o ->> 'center_staff_id', '')::uuid AND center_id = p_center_id;
      IF NOT FOUND OR cs.status <> 'active' OR cs.employment_class <> 'regular' THEN
        RAISE EXCEPTION 'Only this center''s active regular staff can be added. Substitutes come in through their shifts' USING ERRCODE = '22023';
      END IF;
      v_staff := cs.staff_id; v_cs := cs.id;
      PERFORM public.schedule_check_time(v_s, 'Start'); PERFORM public.schedule_check_time(v_e, 'End');
      b := NULL;
    ELSIF v_op IN ('update', 'remove', 'split', 'break', 'assign') THEN
      SELECT * INTO b FROM schedule_blocks WHERE id = NULLIF(o ->> 'id', '')::uuid AND day_id = d.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'That box is no longer on this day. It has been reloaded' USING ERRCODE = 'P0002';
      END IF;
      v_staff := b.staff_id; v_cs := b.center_staff_id;
    ELSE
      RAISE EXCEPTION 'Unknown change "%"', COALESCE(v_op, '') USING ERRCODE = '22023';
    END IF;
    v_label := public.schedule_person_label(v_staff);

    -- Break covers: assign / remove / update
    IF b.kind = 'cover' THEN
      IF v_op = 'assign' THEN
        v_prev := b.staff_id;
        PERFORM public.schedule_cover_release(d, b.id, true);
        IF v_new IS NOT NULL THEN PERFORM public.schedule_cover_assign(d, b.id, v_new); END IF;
        PERFORM public.schedule_log(d, 'assign', jsonb_build_object('block', b.id, 'from', v_prev, 'to', v_new));
      ELSIF v_op = 'remove' THEN
        PERFORM public.schedule_cover_release(d, b.id, true);
        DELETE FROM schedule_blocks WHERE id = b.id;
        PERFORM public.schedule_log(d, 'remove', jsonb_build_object('block', b.id, 'kind', 'cover', 'room_id', b.work_area_id,
          'start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time)));
      ELSIF v_op = 'update' THEN
        IF o ? 'start' THEN PERFORM public.schedule_check_time(v_s, 'Start'); ELSE v_s := b.start_time; END IF;
        IF o ? 'end' THEN PERFORM public.schedule_check_time(v_e, 'End'); ELSE v_e := b.end_time; END IF;
        IF NOT o ? 'room_id' THEN v_room := b.work_area_id; END IF;
        IF NOT o ? 'note' THEN v_note := b.note; END IF;
        IF v_room IS NULL THEN RAISE EXCEPTION 'A break cover needs a room' USING ERRCODE = '22023'; END IF;
        IF v_e <= v_s THEN RAISE EXCEPTION 'A box has to end after it starts' USING ERRCODE = '22023'; END IF;
        IF v_s < v_c.schedule_day_start OR v_e > v_c.schedule_day_end THEN
          RAISE EXCEPTION '% to % is outside the center''s day (% to %)', public.schedule_hhmi(v_s), public.schedule_hhmi(v_e),
            public.schedule_hhmi(v_c.schedule_day_start), public.schedule_hhmi(v_c.schedule_day_end) USING ERRCODE = '22023';
        END IF;
        v_prev := b.staff_id;
        PERFORM public.schedule_cover_release(d, b.id, true);
        UPDATE schedule_blocks SET work_area_id = v_room, start_time = v_s, end_time = v_e, note = v_note, updated_at = now(), updated_by = auth.uid() WHERE id = b.id;
        IF v_prev IS NOT NULL THEN PERFORM public.schedule_cover_assign(d, b.id, v_prev); END IF;
        PERFORM public.schedule_log(d, 'update', jsonb_build_object('block', b.id, 'kind', 'cover',
          'from', jsonb_build_object('room_id', b.work_area_id, 'start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time)),
          'to', jsonb_build_object('room_id', v_room, 'start', public.schedule_hhmi(v_s), 'end', public.schedule_hhmi(v_e))));
      ELSE
        RAISE EXCEPTION 'A break cover can be moved, resized, assigned or removed' USING ERRCODE = '22023';
      END IF;
      CONTINUE;
    END IF;
    IF v_op = 'assign' THEN RAISE EXCEPTION 'Only a break cover can be assigned' USING ERRCODE = '22023'; END IF;

    -- Breaks: remove gives the time back; update moves the break (the time goes back, then a new one is cut out)
    IF b.kind = 'break' THEN
      IF v_op NOT IN ('remove', 'update') THEN RAISE EXCEPTION 'A break can be moved, resized or removed' USING ERRCODE = '22023'; END IF;
      IF v_op = 'update' THEN
        IF o ? 'start' THEN PERFORM public.schedule_check_time(v_s, 'Start'); ELSE v_s := b.start_time; END IF;
        IF o ? 'end' THEN PERFORM public.schedule_check_time(v_e, 'End'); ELSE v_e := b.end_time; END IF;
        IF v_e <= v_s THEN RAISE EXCEPTION 'A break has to end after it starts' USING ERRCODE = '22023'; END IF;
      END IF;
      DELETE FROM schedule_blocks WHERE id = b.id;
      PERFORM public.schedule_insert_free(d, b.staff_id, b.center_staff_id, b.shift_claim_id, b.work_area_id, b.start_time, b.end_time, 'work',
        CASE WHEN b.shift_claim_id IS NOT NULL THEN 'sub' ELSE 'added' END, NULL, NULL);
      PERFORM public.schedule_merge(d.id, b.staff_id);
      IF v_op = 'update' THEN
        SELECT * INTO w FROM schedule_blocks WHERE day_id = d.id AND staff_id = b.staff_id AND kind = 'work' AND start_time <= v_s AND end_time >= v_e LIMIT 1;
        IF NOT FOUND THEN RAISE EXCEPTION 'A break has to be inside one of %''s working boxes', v_label USING ERRCODE = '22023'; END IF;
        PERFORM public.schedule_carve(d.id, b.staff_id, v_s, v_e, ARRAY['work'], false);
        INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, shift_claim_id, work_area_id, start_time, end_time, kind, source, updated_by)
        VALUES (d.id, p_center_id, p_date, b.staff_id, b.center_staff_id, b.shift_claim_id, w.work_area_id, v_s, v_e, 'break',
                CASE WHEN b.shift_claim_id IS NOT NULL THEN 'sub' ELSE 'added' END, auth.uid());
      END IF;
      PERFORM public.schedule_log(d, v_op, jsonb_build_object('block', b.id, 'kind', 'break', 'staff_id', b.staff_id,
        'from', jsonb_build_object('start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time)),
        'to', CASE WHEN v_op = 'update' THEN jsonb_build_object('start', public.schedule_hhmi(v_s), 'end', public.schedule_hhmi(v_e)) END));
      CONTINUE;
    END IF;

    -- A break cut out of a working box (and, unless told not to, an empty break cover in that room)
    IF v_op = 'break' THEN
      PERFORM public.schedule_check_time(v_s, 'Break start'); PERFORM public.schedule_check_time(v_e, 'Break end');
      IF v_e <= v_s THEN RAISE EXCEPTION 'A break has to end after it starts' USING ERRCODE = '22023'; END IF;
      IF v_s < b.start_time OR v_e > b.end_time THEN
        RAISE EXCEPTION 'Pick a break between % and %', public.schedule_hhmi(b.start_time), public.schedule_hhmi(b.end_time) USING ERRCODE = '22023';
      END IF;
      IF v_s = b.start_time AND v_e = b.end_time THEN
        RAISE EXCEPTION 'That is the whole box. Take it off the board instead' USING ERRCODE = '22023';
      END IF;
      PERFORM public.schedule_carve(d.id, b.staff_id, v_s, v_e, ARRAY['work'], false);
      INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, shift_claim_id, work_area_id, start_time, end_time, kind, source, updated_by)
      VALUES (d.id, p_center_id, p_date, b.staff_id, b.center_staff_id, b.shift_claim_id, b.work_area_id, v_s, v_e, 'break',
              CASE WHEN b.shift_claim_id IS NOT NULL THEN 'sub' ELSE 'added' END, auth.uid());
      IF b.work_area_id IS NOT NULL AND COALESCE((o ->> 'cover')::boolean, true) THEN
        INSERT INTO schedule_blocks (day_id, center_id, service_date, work_area_id, start_time, end_time, kind, source, updated_by)
        VALUES (d.id, p_center_id, p_date, b.work_area_id, v_s, v_e, 'cover', 'added', auth.uid());
      END IF;
      PERFORM public.schedule_log(d, 'break', jsonb_build_object('staff_id', b.staff_id, 'room_id', b.work_area_id,
        'start', public.schedule_hhmi(v_s), 'end', public.schedule_hhmi(v_e), 'cover', b.work_area_id IS NOT NULL AND COALESCE((o ->> 'cover')::boolean, true)));
      CONTINUE;
    END IF;

    IF v_op = 'remove' THEN
      IF b.shift_claim_id IS NOT NULL THEN
        RAISE EXCEPTION '% is here on a substitute shift. Cancel or change the shift to take them off', v_label USING ERRCODE = '22023';
      END IF;
      DELETE FROM schedule_blocks WHERE id = b.id;
      PERFORM public.schedule_log(d, 'remove', jsonb_build_object('block', b.id, 'staff_id', b.staff_id, 'room_id', b.work_area_id,
        'start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time)));
      CONTINUE;
    END IF;

    IF v_op = 'split' THEN
      PERFORM public.schedule_check_time(v_at, 'The move time');
      IF v_at <= b.start_time OR v_at >= b.end_time THEN
        RAISE EXCEPTION 'Pick a time between % and %', public.schedule_hhmi(b.start_time), public.schedule_hhmi(b.end_time) USING ERRCODE = '22023';
      END IF;
      UPDATE schedule_blocks SET end_time = v_at, updated_at = now(), updated_by = auth.uid() WHERE id = b.id;
      INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, shift_claim_id, work_area_id, start_time, end_time, kind, source, note, updated_by)
      VALUES (d.id, p_center_id, p_date, b.staff_id, b.center_staff_id, b.shift_claim_id, v_room, v_at, b.end_time, 'work',
              CASE WHEN b.shift_claim_id IS NOT NULL THEN 'sub' ELSE 'added' END, b.note, auth.uid());
      PERFORM public.schedule_log(d, 'split', jsonb_build_object('block', b.id, 'staff_id', b.staff_id, 'at', public.schedule_hhmi(v_at),
        'from_room', b.work_area_id, 'to_room', v_room));
      CONTINUE;
    END IF;

    -- add / update a working box
    IF v_op = 'update' THEN
      IF b.shift_claim_id IS NOT NULL AND ((o ? 'start' AND v_s <> b.start_time) OR (o ? 'end' AND v_e <> b.end_time)) THEN
        RAISE EXCEPTION '%''s hours come from their substitute shift. Change the shift to change them', v_label USING ERRCODE = '22023';
      END IF;
      IF o ? 'start' THEN PERFORM public.schedule_check_time(v_s, 'Start'); ELSE v_s := b.start_time; END IF;
      IF o ? 'end' THEN PERFORM public.schedule_check_time(v_e, 'End'); ELSE v_e := b.end_time; END IF;
      IF NOT o ? 'room_id' THEN v_room := b.work_area_id; END IF;
      IF NOT o ? 'note' THEN v_note := b.note; END IF;
    END IF;
    IF v_e <= v_s THEN RAISE EXCEPTION 'A box has to end after it starts' USING ERRCODE = '22023'; END IF;
    IF v_s < v_c.schedule_day_start OR v_e > v_c.schedule_day_end THEN
      RAISE EXCEPTION '% to % is outside the center''s day (% to %)', public.schedule_hhmi(v_s), public.schedule_hhmi(v_e),
        public.schedule_hhmi(v_c.schedule_day_start), public.schedule_hhmi(v_c.schedule_day_end) USING ERRCODE = '22023';
    END IF;
    IF v_cs IS NOT NULL THEN
      SELECT * INTO a FROM schedule_absences WHERE day_id = d.id AND center_staff_id = v_cs;
      IF FOUND AND (a.start_time IS NULL OR (a.start_time < v_e AND a.end_time > v_s)) THEN
        RAISE EXCEPTION '% is off % today. Undo the call-out first', v_label,
          CASE WHEN a.start_time IS NULL THEN 'all day' ELSE 'from ' || public.schedule_hhmi(a.start_time) || ' to ' || public.schedule_hhmi(a.end_time) END
          USING ERRCODE = '22023';
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM schedule_blocks x WHERE x.day_id = d.id AND x.staff_id = v_staff AND x.id IS DISTINCT FROM b.id
               AND x.start_time < v_e AND x.end_time > v_s) THEN
      RAISE EXCEPTION '% is already on the schedule for part of % to %', v_label, public.schedule_hhmi(v_s), public.schedule_hhmi(v_e) USING ERRCODE = '22023';
    END IF;

    IF v_op = 'add' THEN
      INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, work_area_id, start_time, end_time, kind, source, note, updated_by)
      VALUES (d.id, p_center_id, p_date, v_staff, v_cs, v_room, v_s, v_e, 'work', 'added', v_note, auth.uid());
      PERFORM public.schedule_log(d, 'add', jsonb_build_object('staff_id', v_staff, 'room_id', v_room, 'start', public.schedule_hhmi(v_s), 'end', public.schedule_hhmi(v_e)));
    ELSE
      UPDATE schedule_blocks SET work_area_id = v_room, start_time = v_s, end_time = v_e, note = v_note, updated_at = now(), updated_by = auth.uid()
      WHERE id = b.id;
      PERFORM public.schedule_log(d, 'update', jsonb_build_object('block', b.id, 'staff_id', v_staff,
        'from', jsonb_build_object('room_id', b.work_area_id, 'start', public.schedule_hhmi(b.start_time), 'end', public.schedule_hhmi(b.end_time)),
        'to', jsonb_build_object('room_id', v_room, 'start', public.schedule_hhmi(v_s), 'end', public.schedule_hhmi(v_e))));
    END IF;
  END LOOP;

  UPDATE schedule_days SET version = version + 1 WHERE id = d.id;
  RETURN public.schedule_day_payload(d.id);
END $$;

DROP FUNCTION IF EXISTS public.schedule_break_extend(schedule_days, uuid, uuid, uuid, uuid, time, integer);
DROP FUNCTION IF EXISTS public.schedule_break_unextend(uuid, uuid, time, integer);
ALTER TABLE public.schedule_blocks DROP CONSTRAINT IF EXISTS schedule_blocks_break_extended_check;
ALTER TABLE public.schedule_blocks DROP COLUMN IF EXISTS break_extended_minutes;

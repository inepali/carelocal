-- Rollback for 20270120000000_time_clock.sql. WARNING: deletes every punch, PIN, Time Clock tablet and time off
-- request (export the timesheets first). Days on the Daily Schedule keep the absences already recorded.
DROP FUNCTION IF EXISTS public.timeclock_mine(date);
DROP FUNCTION IF EXISTS public.timeclock_my_request(uuid, text, date, date, boolean, text);
DROP FUNCTION IF EXISTS public.timeclock_my_cancel(uuid, uuid);
DROP FUNCTION IF EXISTS public.timeclock_my_staff(uuid);
DROP FUNCTION IF EXISTS public.timeclock_off_decide(uuid, uuid, text, numeric, text);
DROP FUNCTION IF EXISTS public.timeclock_off_add(uuid, uuid, text, date, date, boolean, numeric, text);
DROP FUNCTION IF EXISTS public.timeclock_off_list(uuid, date, date);
DROP FUNCTION IF EXISTS public.timeclock_entry_delete(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.timeclock_entry_save(uuid, uuid, uuid, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.timeclock_entries(uuid, date, date);
DROP FUNCTION IF EXISTS public.timeclock_device_revoke(uuid, uuid);
DROP FUNCTION IF EXISTS public.timeclock_device_register(uuid, text, text);
DROP FUNCTION IF EXISTS public.timeclock_allowance_set(uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public.timeclock_pin_clear(uuid, uuid);
DROP FUNCTION IF EXISTS public.timeclock_pin_set(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.timeclock_settings_save(uuid, text, date, text, numeric, numeric);
DROP FUNCTION IF EXISTS public.timeclock_overview(uuid);
DROP FUNCTION IF EXISTS public.timeclock_admin_check(uuid);
DROP FUNCTION IF EXISTS public.timeclock_room_user(text, text);
DROP FUNCTION IF EXISTS public.timeclock_cancel_off(text, text, uuid);
DROP FUNCTION IF EXISTS public.timeclock_request_off(text, text, text, date, date, boolean, text);
DROP FUNCTION IF EXISTS public.timeclock_punch(text, text, text);
DROP FUNCTION IF EXISTS public.timeclock_identify(text, text);
DROP FUNCTION IF EXISTS public.timeclock_person(uuid);
DROP FUNCTION IF EXISTS public.timeclock_auth(text, text);
DROP FUNCTION IF EXISTS public.timeclock_device(text);
DROP FUNCTION IF EXISTS public.timeclock_off_create(uuid, text, date, date, boolean, numeric, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.timeclock_off_json(time_off_requests);
DROP FUNCTION IF EXISTS public.timeclock_schedule_mark(uuid);
DROP FUNCTION IF EXISTS public.timeclock_schedule_unmark(uuid);
DROP FUNCTION IF EXISTS public.timeclock_close_stale(uuid);
DROP FUNCTION IF EXISTS public.timeclock_weekdays(date, date);
DROP FUNCTION IF EXISTS public.timeclock_pto_balance(uuid, date);
DROP FUNCTION IF EXISTS public.timeclock_pto_sum(uuid, daterange, text);
DROP FUNCTION IF EXISTS public.timeclock_pto_year(uuid, date);
DROP FUNCTION IF EXISTS public.timeclock_name(uuid);
DROP FUNCTION IF EXISTS public.timeclock_cfg(uuid);

-- schedule_fill_fixed as it was in 20270101040000_schedule_breaks.sql
CREATE OR REPLACE FUNCTION public.schedule_fill_fixed(p_day schedule_days, p_cs center_staff)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f staff_fixed_schedules%ROWTYPE; w schedule_blocks%ROWTYPE; v_n integer := 0;
BEGIN
  FOR f IN
    SELECT * FROM staff_fixed_schedules
    WHERE center_staff_id = p_cs.id AND weekday = extract(dow FROM p_day.service_date)::int AND kind = 'work'
      AND effective_from <= p_day.service_date AND (effective_to IS NULL OR effective_to >= p_day.service_date)
    ORDER BY start_time
  LOOP
    PERFORM public.schedule_add_trimmed(p_day, p_cs,
      CASE WHEN EXISTS (SELECT 1 FROM work_areas wa WHERE wa.id = f.work_area_id AND COALESCE(wa.is_active, true)) THEN f.work_area_id END,
      f.start_time, f.end_time, 'fixed', f.id, f.notes);
    v_n := v_n + 1;
  END LOOP;
  -- Usual breaks: cut out of the box they fall in (skipped if that time isn't a working box today)
  FOR f IN
    SELECT * FROM staff_fixed_schedules
    WHERE center_staff_id = p_cs.id AND weekday = extract(dow FROM p_day.service_date)::int AND kind = 'break'
      AND effective_from <= p_day.service_date AND (effective_to IS NULL OR effective_to >= p_day.service_date)
    ORDER BY start_time
  LOOP
    SELECT * INTO w FROM schedule_blocks
    WHERE day_id = p_day.id AND center_staff_id = p_cs.id AND kind = 'work' AND start_time <= f.start_time AND end_time >= f.end_time LIMIT 1;
    CONTINUE WHEN NOT FOUND;
    PERFORM public.schedule_carve(p_day.id, p_cs.staff_id, f.start_time, f.end_time, ARRAY['work'], false);
    INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, work_area_id, start_time, end_time, kind, source, fixed_schedule_id, updated_by)
    VALUES (p_day.id, p_day.center_id, p_day.service_date, p_cs.staff_id, p_cs.id, w.work_area_id, f.start_time, f.end_time, 'break', 'fixed', f.id, auth.uid());
  END LOOP;
  RETURN v_n;
END $$;

ALTER TABLE public.schedule_absences DROP COLUMN IF EXISTS time_off_id;
DROP TABLE IF EXISTS public.time_off_requests;
DROP TABLE IF EXISTS public.staff_pto_allowances;
DROP TABLE IF EXISTS public.time_entry_log;
DROP TABLE IF EXISTS public.time_entries;
DROP TABLE IF EXISTS public.timeclock_attempts;
DROP TABLE IF EXISTS public.timeclock_devices;
DROP TABLE IF EXISTS public.staff_time_pins;
DROP TABLE IF EXISTS public.timeclock_settings;
DROP FUNCTION IF EXISTS public.timeclock_admin_can(uuid);
DROP TRIGGER IF EXISTS trg_guard_timeclock_flag ON public.centers;
DROP FUNCTION IF EXISTS public.guard_timeclock_flag();
ALTER TABLE public.centers DROP COLUMN IF EXISTS timeclock_enabled;

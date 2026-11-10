-- Rollback for 20270101010000_schedule_days.sql: the daily board tables and functions go (fixed schedules stay)
DROP FUNCTION IF EXISTS public.schedule_publish(uuid, date, integer);
DROP FUNCTION IF EXISTS public.schedule_reset_person(uuid, date, integer, uuid);
DROP FUNCTION IF EXISTS public.schedule_call_out_undo(uuid, date, integer, uuid);
DROP FUNCTION IF EXISTS public.schedule_call_out(uuid, date, integer, uuid, text, time, time, text);
DROP FUNCTION IF EXISTS public.schedule_apply(uuid, date, integer, jsonb);
DROP FUNCTION IF EXISTS public.schedule_day_open(uuid, date);
DROP FUNCTION IF EXISTS public.schedule_lock_day(uuid, date, integer);
DROP FUNCTION IF EXISTS public.schedule_day_payload(uuid);
DROP FUNCTION IF EXISTS public.schedule_log(schedule_days, text, jsonb);
DROP FUNCTION IF EXISTS public.schedule_sync_subs(schedule_days);
DROP FUNCTION IF EXISTS public.schedule_fill_fixed(schedule_days, center_staff);
DROP FUNCTION IF EXISTS public.schedule_add_trimmed(schedule_days, center_staff, uuid, time, time, text, uuid, text);
DROP FUNCTION IF EXISTS public.schedule_person_label(uuid);
DROP FUNCTION IF EXISTS public.schedule_check_time(time, text);
DROP FUNCTION IF EXISTS public.schedule_time(integer);
DROP FUNCTION IF EXISTS public.schedule_mins(time);

DROP TABLE IF EXISTS public.schedule_changes;
DROP TABLE IF EXISTS public.schedule_absences;
DROP TABLE IF EXISTS public.schedule_blocks;
DROP TABLE IF EXISTS public.schedule_days;
DROP FUNCTION IF EXISTS public.check_schedule_block();

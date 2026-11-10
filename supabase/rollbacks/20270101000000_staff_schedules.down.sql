-- Rollback for 20270101000000_staff_schedules.sql: fixed schedules, the schedule functions and the centers settings go
DROP FUNCTION IF EXISTS public.schedule_fixed_save(uuid, date, jsonb);
DROP FUNCTION IF EXISTS public.schedule_fixed_list(uuid, date);
DROP FUNCTION IF EXISTS public.schedule_settings_save(uuid, time, time, boolean);
DROP FUNCTION IF EXISTS public.schedule_settings(uuid);
DROP FUNCTION IF EXISTS public.schedule_hhmi(time);
DROP FUNCTION IF EXISTS public.schedule_can_manage(uuid);

DROP TABLE IF EXISTS public.staff_fixed_schedules;
DROP FUNCTION IF EXISTS public.check_staff_fixed_schedule();

DROP TRIGGER IF EXISTS trg_guard_schedule_flags ON public.centers;
DROP FUNCTION IF EXISTS public.guard_schedule_flags();
ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_schedule_day_check;
ALTER TABLE public.centers DROP CONSTRAINT IF EXISTS centers_schedule_slot_minutes_check;
ALTER TABLE public.centers DROP COLUMN IF EXISTS schedule_weekends;
ALTER TABLE public.centers DROP COLUMN IF EXISTS schedule_day_end;
ALTER TABLE public.centers DROP COLUMN IF EXISTS schedule_day_start;
ALTER TABLE public.centers DROP COLUMN IF EXISTS schedule_slot_minutes;
ALTER TABLE public.centers DROP COLUMN IF EXISTS schedule_enabled;

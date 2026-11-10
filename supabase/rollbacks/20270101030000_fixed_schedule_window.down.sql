-- Rollback for 20270101030000_fixed_schedule_window.sql (saved schedules with an end date keep their end date)
DROP FUNCTION IF EXISTS public.schedule_fixed_save_window(uuid, date, date, jsonb);

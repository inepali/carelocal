-- Rollback for 20270101020000_schedule_teacher.sql: teacher reads and notices go; the admin's day goes back to phase 2's
DROP FUNCTION IF EXISTS public.schedule_notice_mark(uuid, date, jsonb);
DROP FUNCTION IF EXISTS public.schedule_notice_targets(uuid, date);
DROP FUNCTION IF EXISTS public.schedule_board(uuid, date);
DROP FUNCTION IF EXISTS public.my_schedule_seen(uuid, date);
DROP FUNCTION IF EXISTS public.my_schedule(date, date);
DROP FUNCTION IF EXISTS public.schedule_day_payload(uuid);
ALTER FUNCTION public.schedule_day_payload_base(uuid) RENAME TO schedule_day_payload;
DROP FUNCTION IF EXISTS public.schedule_unnotified(uuid);
DROP FUNCTION IF EXISTS public.schedule_my_staff_id();
DROP FUNCTION IF EXISTS public.schedule_person_summary(uuid, uuid);
DROP FUNCTION IF EXISTS public.schedule_person_hash(uuid, uuid);
DROP TABLE IF EXISTS public.schedule_person_notices;

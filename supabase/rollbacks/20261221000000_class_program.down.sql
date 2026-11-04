DROP TRIGGER IF EXISTS work_areas_check_program ON public.work_areas;
DROP FUNCTION IF EXISTS public.check_work_area_program();
DROP INDEX IF EXISTS public.work_areas_program_id_idx;
ALTER TABLE public.work_areas DROP COLUMN IF EXISTS program_id;

DROP TRIGGER IF EXISTS work_areas_check_theme_key ON public.work_areas;
DROP FUNCTION IF EXISTS public.check_room_theme_key();
ALTER TABLE public.work_areas DROP COLUMN IF EXISTS circle_image_key;
ALTER TABLE public.work_areas DROP COLUMN IF EXISTS theme_image_key;

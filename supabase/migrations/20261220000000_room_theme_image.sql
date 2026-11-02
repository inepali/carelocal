-- ============================================================
-- Room theme pictures: an admin can set a background picture per room (behind the selected room's rectangle
-- and on the room's tile) and a separate one for the Classroom circle. The Live Roster shows them.
-- Who may change them is the existing work_areas policy (center admins and owners); everyone on the roster reads them.
-- The pictures live in the child bucket under roster-theme/<center>/<room>/.
-- Rollback: supabase/rollbacks/20261220000000_room_theme_image.down.sql
-- ============================================================

ALTER TABLE public.work_areas ADD COLUMN IF NOT EXISTS theme_image_key text;
ALTER TABLE public.work_areas ADD COLUMN IF NOT EXISTS circle_image_key text;

-- Each picture must sit in the room's own folder
CREATE OR REPLACE FUNCTION public.check_room_theme_key()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_prefix text := 'roster-theme/' || NEW.center_id || '/' || NEW.id || '/';
BEGIN
  IF NEW.theme_image_key IS NOT NULL
     AND (NEW.theme_image_key NOT LIKE v_prefix || '%' OR NEW.theme_image_key LIKE '%..%') THEN
    RAISE EXCEPTION 'The theme picture must be in this room''s folder' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.circle_image_key IS NOT NULL
     AND (NEW.circle_image_key NOT LIKE v_prefix || '%' OR NEW.circle_image_key LIKE '%..%') THEN
    RAISE EXCEPTION 'The circle picture must be in this room''s folder' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS work_areas_check_theme_key ON public.work_areas;
CREATE TRIGGER work_areas_check_theme_key
  BEFORE INSERT OR UPDATE OF theme_image_key, circle_image_key ON public.work_areas
  FOR EACH ROW EXECUTE FUNCTION public.check_room_theme_key();

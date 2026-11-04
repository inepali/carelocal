-- ============================================================
-- Classes belong to a program: a program (About → Programs) can have one or more classes (work_areas), and each
-- class picks its program in Manage Data → Classrooms. Lesson plans use this to know which program's learning
-- areas, subjects and goals apply to a class.
-- Who may change it is the existing work_areas policy (center admins and owners).
-- Deleting a program leaves its classes in place with no program.
-- Rollback: supabase/rollbacks/20261221000000_class_program.down.sql
-- ============================================================

ALTER TABLE public.work_areas ADD COLUMN IF NOT EXISTS program_id uuid
  REFERENCES public.center_programs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS work_areas_program_id_idx ON public.work_areas(program_id);

-- The program must be one of the class's own center
CREATE OR REPLACE FUNCTION public.check_work_area_program()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.program_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM center_programs p WHERE p.id = NEW.program_id AND p.center_id = NEW.center_id
  ) THEN
    RAISE EXCEPTION 'That program belongs to another center' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_work_area_program() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS work_areas_check_program ON public.work_areas;
CREATE TRIGGER work_areas_check_program
  BEFORE INSERT OR UPDATE OF program_id, center_id ON public.work_areas
  FOR EACH ROW EXECUTE FUNCTION public.check_work_area_program();

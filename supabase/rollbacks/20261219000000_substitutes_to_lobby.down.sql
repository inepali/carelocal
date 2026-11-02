-- Rollback for 20261219000000_substitutes_to_lobby.sql: substitutes check in to the classroom again.
-- As in 20261210000000_roster_substitutes.sql
CREATE OR REPLACE FUNCTION public.roster_on_shift_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shift record;
BEGIN
  IF NEW.status::text <> 'confirmed' THEN RETURN NEW; END IF;
  SELECT s.center_id, s.work_area_id INTO v_shift FROM shifts s WHERE s.id = NEW.shift_id;
  IF v_shift.center_id IS NULL THEN RETURN NEW; END IF;
  IF NOT COALESCE((SELECT c.roster_enabled AND c.child_files_enabled FROM centers c WHERE c.id = v_shift.center_id), false) THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.check_out_time IS NOT NULL AND OLD.check_out_time IS NULL THEN
      PERFORM public.roster_move(v_shift.center_id, NULL, NEW.staff_id, NULL, 'home', NULL);
    ELSIF NEW.check_in_time IS NOT NULL AND OLD.check_in_time IS NULL AND v_shift.work_area_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM work_areas w WHERE w.id = v_shift.work_area_id AND w.is_active AND w.on_roster) THEN
      PERFORM public.roster_move(v_shift.center_id, NULL, NEW.staff_id, v_shift.work_area_id, 'classroom', NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live roster: could not place staff % for shift %: %', NEW.staff_id, NEW.shift_id, SQLERRM;
  END;
  RETURN NEW;
END $$;

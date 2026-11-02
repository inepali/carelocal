-- ============================================================
-- Substitutes check in to the Lobby. Checking in to a confirmed shift now places the person in the Lobby of the
-- shift's room (on site, not counted in the classroom ratio) instead of the classroom; an admin moves them in.
-- A shift with no room puts them on today's roster with no room, so the board shows them waiting for one.
-- Checking out still sends them home. Never blocks the time clock.
-- Rollback: supabase/rollbacks/20261219000000_substitutes_to_lobby.down.sql
-- ============================================================

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
    ELSIF NEW.check_in_time IS NOT NULL AND OLD.check_in_time IS NULL THEN
      IF v_shift.work_area_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM work_areas w WHERE w.id = v_shift.work_area_id AND w.is_active AND w.on_roster) THEN
        -- The Lobby of the shift's room: on site, not counted in the classroom, until an admin moves them in
        PERFORM public.roster_move(v_shift.center_id, NULL, NEW.staff_id, v_shift.work_area_id, 'lobby', NULL);
      ELSE
        -- No room on the shift: on today's roster with no room, so the board shows them waiting for one
        INSERT INTO roster_presence (center_id, service_date, staff_id, work_area_id, zone, updated_by)
        VALUES (v_shift.center_id, public.roster_today(v_shift.center_id), NEW.staff_id, NULL, 'home', NULL)
        ON CONFLICT ON CONSTRAINT roster_presence_staff_day DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live roster: could not place staff % for shift %: %', NEW.staff_id, NEW.shift_id, SQLERRM;
  END;
  RETURN NEW;
END $$;

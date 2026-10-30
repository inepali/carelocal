-- ============================================================
-- Live Roster (phase 6): daily attendance export
--
--  - roster_attendance(center, from, to): one row per person per day the center was open (any check-in or move
--    that day). Children enrolled that day who never came are listed as Absent; anyone whose last move was not
--    a check-out is "Not checked out". Times are in the center's own time zone.
--  - roster_moves_export(center, from, to): every check-in, check-out and move with names and rooms.
--  - Owner and administrators only (the same people who can open child records), with the roster on.
--    At most 62 days per export.
-- Rollback: supabase/rollbacks/20261211000000_roster_attendance_export.down.sql
-- ============================================================

-- The center's time zone (the same default the rest of the app uses)
CREATE OR REPLACE FUNCTION public.roster_timezone(p_center_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF((SELECT timezone FROM centers WHERE id = p_center_id), ''), 'America/New_York');
$$;

CREATE OR REPLACE FUNCTION public.roster_export_check(p_center_id uuid, p_from date, p_to date)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.can_view_confidential(p_center_id) AND public.can_use_roster(p_center_id)) THEN
    RAISE EXCEPTION 'Only the owner and administrators can export attendance.' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Pick a start date on or before the end date.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_to - p_from > 61 THEN
    RAISE EXCEPTION 'Export at most 62 days at a time.' USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.roster_attendance(p_center_id uuid, p_from date, p_to date, p_include_staff boolean DEFAULT false)
RETURNS TABLE (
  service_date     date,
  kind             text,      -- 'child' | 'staff'
  person_id        uuid,
  first_name       text,
  last_name        text,
  role             text,      -- 'Child' | 'Regular teacher' | 'Substitute'
  home_room        text,
  status           text,      -- 'Present' | 'Not checked out' | 'Absent'
  first_in         text,      -- local time, e.g. '07:42 AM'
  last_out         text,
  minutes_on_site  integer,   -- closed visits only (check-in to check-out)
  rooms            text,      -- every room they were in that day, in order of first visit
  moves            integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_tz text;
BEGIN
  PERFORM public.roster_export_check(p_center_id, p_from, p_to);
  v_tz := public.roster_timezone(p_center_id);

  RETURN QUERY
  WITH ev AS (
    SELECT e.service_date AS d, e.child_id, e.staff_id, COALESCE(e.child_id, e.staff_id) AS pid,
           e.action, e.at, e.id, e.to_zone, e.to_area_id,
           lead(e.at) OVER (PARTITION BY e.service_date, COALESCE(e.child_id, e.staff_id) ORDER BY e.at, e.id) AS next_at
    FROM roster_events e
    WHERE e.center_id = p_center_id AND e.service_date BETWEEN p_from AND p_to
  ),
  firsts AS (                                                   -- first visit to each room, for the room order
    SELECT ev.d, ev.pid, ev.to_area_id, min(ev.at) AS first_at
    FROM ev WHERE ev.to_zone <> 'home' AND ev.to_area_id IS NOT NULL
    GROUP BY ev.d, ev.pid, ev.to_area_id
  ),
  per AS (
    SELECT ev.d, ev.pid,
           bool_or(ev.child_id IS NOT NULL) AS is_child,
           min(ev.at) FILTER (WHERE ev.action = 'check_in') AS first_in,
           max(ev.at) FILTER (WHERE ev.action = 'check_out') AS last_out,
           COALESCE(sum(extract(epoch FROM ev.next_at - ev.at)) FILTER (WHERE ev.to_zone <> 'home' AND ev.next_at IS NOT NULL), 0) AS secs,
           (array_agg(ev.to_zone ORDER BY ev.at DESC, ev.id DESC))[1] AS last_zone,
           count(*)::integer AS n
    FROM ev GROUP BY ev.d, ev.pid
  ),
  open_days AS (SELECT DISTINCT ev.d FROM ev),
  present AS (
    SELECT per.d, CASE WHEN per.is_child THEN 'child' ELSE 'staff' END AS k, per.pid,
           CASE WHEN per.last_zone = 'home' THEN 'Present' ELSE 'Not checked out' END AS st,
           per.first_in, per.last_out, round(per.secs / 60)::integer AS mins,
           (SELECT string_agg(w.name, ', ' ORDER BY f.first_at) FROM firsts f JOIN work_areas w ON w.id = f.to_area_id
             WHERE f.d = per.d AND f.pid = per.pid) AS room_list,
           per.n
    FROM per
  ),
  absent AS (
    SELECT od.d, 'child'::text AS k, ch.id AS pid
    FROM open_days od
    JOIN children ch ON ch.center_id = p_center_id
     AND ch.enrolled_on <= od.d AND (ch.withdrawn_on IS NULL OR ch.withdrawn_on > od.d)
    WHERE NOT EXISTS (SELECT 1 FROM per WHERE per.d = od.d AND per.pid = ch.id)
  ),
  rows_all AS (
    SELECT p.d, p.k, p.pid, p.st, p.first_in, p.last_out, p.mins, p.room_list, p.n FROM present p
    UNION ALL
    SELECT a.d, a.k, a.pid, 'Absent', NULL, NULL, NULL, NULL, 0 FROM absent a
  )
  SELECT r.d, r.k, r.pid,
         COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name, sp.first_name),
         COALESCE(ch.last_name, sp.last_name),
         CASE WHEN r.k = 'staff' THEN CASE COALESCE(cs.employment_class, 'substitute') WHEN 'regular' THEN 'Regular teacher' ELSE 'Substitute' END ELSE 'Child' END,
         COALESCE(hc.name, hs.name),
         r.st,
         to_char(r.first_in AT TIME ZONE v_tz, 'HH12:MI AM'),
         to_char(r.last_out AT TIME ZONE v_tz, 'HH12:MI AM'),
         r.mins,
         r.room_list,
         r.n
  FROM rows_all r
  LEFT JOIN children ch ON r.k = 'child' AND ch.id = r.pid
  LEFT JOIN work_areas hc ON hc.id = ch.classroom_id
  LEFT JOIN staff_profiles sp ON r.k = 'staff' AND sp.id = r.pid
  LEFT JOIN center_staff cs ON r.k = 'staff' AND cs.staff_id = r.pid AND cs.center_id = p_center_id
  LEFT JOIN work_areas hs ON hs.id = cs.home_work_area_id
  WHERE r.k = 'child' OR p_include_staff
  ORDER BY r.d, (r.k = 'staff'), COALESCE(hc.name, hs.name) NULLS LAST, COALESCE(ch.last_name, sp.last_name), COALESCE(ch.first_name, sp.first_name);
END $$;

CREATE OR REPLACE FUNCTION public.roster_moves_export(p_center_id uuid, p_from date, p_to date)
RETURNS TABLE (
  service_date  date,
  local_time    text,      -- in the center's time zone
  kind          text,
  first_name    text,
  last_name     text,
  action        text,      -- 'Checked in' | 'Checked out' | 'Changed room' | 'Moved'
  from_room     text,
  from_zone     text,
  to_room       text,
  to_zone       text,
  at            timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_tz text;
BEGIN
  PERFORM public.roster_export_check(p_center_id, p_from, p_to);
  v_tz := public.roster_timezone(p_center_id);

  RETURN QUERY
  SELECT e.service_date,
         to_char(e.at AT TIME ZONE v_tz, 'HH12:MI:SS AM'),
         CASE WHEN e.child_id IS NOT NULL THEN 'child' ELSE 'staff' END,
         COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name, sp.first_name),
         COALESCE(ch.last_name, sp.last_name),
         CASE e.action WHEN 'check_in' THEN 'Checked in' WHEN 'check_out' THEN 'Checked out' WHEN 'move_room' THEN 'Changed room' ELSE 'Moved' END,
         fa.name, initcap(e.from_zone), ta.name, initcap(e.to_zone),
         e.at
  FROM roster_events e
  LEFT JOIN children ch ON ch.id = e.child_id
  LEFT JOIN staff_profiles sp ON sp.id = e.staff_id
  LEFT JOIN work_areas fa ON fa.id = e.from_area_id
  LEFT JOIN work_areas ta ON ta.id = e.to_area_id
  WHERE e.center_id = p_center_id AND e.service_date BETWEEN p_from AND p_to
  ORDER BY e.at, e.id;
END $$;

REVOKE ALL ON FUNCTION public.roster_timezone(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.roster_export_check(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.roster_attendance(uuid, date, date, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roster_moves_export(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roster_attendance(uuid, date, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roster_moves_export(uuid, date, date) TO authenticated;

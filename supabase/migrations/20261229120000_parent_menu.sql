-- ============================================================
-- Parent page: the center's monthly menu, read only.
--
--  - Parents see a month only once the center has published it (drafts never), and only while the center has
--    Menu planning on. Last month (so the 60 days of history line up), this month and the next two.
--  - What a parent sees per meal: the foods, serving notes, allergens and the note. Not the CACFP details.
--  - Closed days show as closed, with the reason.
--  - parent_portal_home now says whether the center has Menu planning on (so the page shows the Menu tab).
-- Rollback: supabase/rollbacks/20261229120000_parent_menu.down.sql
-- ============================================================

-- The first screen, as before, plus center.menu (Menu planning on)
CREATE OR REPLACE FUNCTION public.parent_portal_home(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_access uuid; v_center uuid; v_result jsonb;
BEGIN
  v_access := public.parent_session_access(p_token_hash);
  IF v_access IS NULL THEN RETURN NULL; END IF;
  SELECT center_id INTO v_center FROM parent_access WHERE id = v_access;
  SELECT jsonb_build_object(
    'center', jsonb_build_object('id', c.id, 'name', c.name, 'email', NULLIF(btrim(c.email), ''), 'phone', c.phone,
                                 'timezone', public.roster_timezone(c.id), 'today', public.roster_today(c.id),
                                 'domain_key', c.domain_key, 'menu', c.menu_planning_enabled),
    'parent', jsonb_build_object('name', (SELECT g.name FROM child_guardians g WHERE g.parent_access_id = v_access
                                          ORDER BY g.is_primary DESC, g.created_at LIMIT 1)),
    'children', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', ch.id,
               'first_name', COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name),
               'photo_key', ch.photo_key)
             ORDER BY ch.date_of_birth DESC NULLS LAST, ch.first_name)
        FROM children ch
       WHERE ch.center_id = v_center AND ch.status = 'enrolled'
         AND EXISTS (SELECT 1 FROM child_guardians g WHERE g.child_id = ch.id AND g.parent_access_id = v_access)), '[]'::jsonb))
  INTO v_result
  FROM centers c WHERE c.id = v_center;
  IF jsonb_array_length(v_result -> 'children') = 0 THEN RETURN NULL; END IF;
  RETURN v_result;
END $$;

-- One published month of the center's menu. p_month NULL = this month.
-- NULL = signed out, or Menu planning is off. {published: false} = the month is not published (or out of range).
CREATE OR REPLACE FUNCTION public.parent_portal_menu(p_token_hash text, p_month date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_access uuid; v_center uuid; v_today date; v_month date; v_first date; v_last date; v_published boolean;
BEGIN
  v_access := public.parent_session_access(p_token_hash);
  IF v_access IS NULL THEN RETURN NULL; END IF;
  SELECT a.center_id INTO v_center FROM parent_access a JOIN centers c ON c.id = a.center_id
   WHERE a.id = v_access AND c.menu_planning_enabled;
  IF v_center IS NULL THEN RETURN NULL; END IF;

  v_today := public.roster_today(v_center);
  v_first := date_trunc('month', v_today - 60)::date;
  v_last := (date_trunc('month', v_today) + interval '2 months')::date;
  v_month := date_trunc('month', COALESCE(p_month, v_today))::date;
  v_published := v_month BETWEEN v_first AND v_last
             AND EXISTS (SELECT 1 FROM menu_months m WHERE m.center_id = v_center AND m.month = v_month AND m.status = 'published');

  RETURN jsonb_build_object(
    'month', v_month,
    'today', v_today,
    'published', v_published,
    'slots', (SELECT to_jsonb(menu_slots) FROM centers WHERE id = v_center),
    -- The published months a parent can move between
    'months', COALESCE((SELECT jsonb_agg(m.month ORDER BY m.month) FROM menu_months m
                         WHERE m.center_id = v_center AND m.status = 'published' AND m.month BETWEEN v_first AND v_last), '[]'::jsonb),
    'entries', CASE WHEN v_published THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'date', e.service_date, 'slot', e.slot, 'name', e.preset_name, 'note', e.note,
               'foods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                     'name', f ->> 'name',
                                     'serving_note', NULLIF(f ->> 'serving_note', ''),
                                     'allergens', COALESCE(f -> 'allergens', '[]'::jsonb)))
                                   FROM jsonb_array_elements(e.items) f), '[]'::jsonb))
             ORDER BY e.service_date, array_position(ARRAY['breakfast', 'am_snack', 'lunch', 'pm_snack', 'supper'], e.slot))
        FROM menu_entries e
       WHERE e.center_id = v_center AND e.service_date >= v_month AND e.service_date < (v_month + interval '1 month')::date), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'closed', CASE WHEN v_published THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', d.service_date, 'reason', d.reason) ORDER BY d.service_date)
        FROM menu_closed_days d
       WHERE d.center_id = v_center AND d.service_date >= v_month AND d.service_date < (v_month + interval '1 month')::date), '[]'::jsonb)
      ELSE '[]'::jsonb END);
END $$;

REVOKE ALL ON FUNCTION public.parent_portal_menu(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_portal_menu(text, date) TO service_role;

-- Rollback for 20261229120000_parent_menu.sql: the menu function goes; parent_portal_home as it was
DROP FUNCTION IF EXISTS public.parent_portal_menu(text, date);

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
                                 'domain_key', c.domain_key),
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

-- Rollback for 20270106010000_care_review_link_viewer.sql: care_review_link_options without 'viewer'.
CREATE OR REPLACE FUNCTION public.care_review_link_options(p_code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_link  care_review_links;
  v_me    uuid;
  v_opts  jsonb := '[]'::jsonb;
  v_self  boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to leave a review' USING ERRCODE = '42501'; END IF;
  v_link := public.care_review_link_subject(p_code);
  IF v_link.id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_me FROM staff_profiles WHERE user_id = v_uid;

  IF v_link.subject_type = 'center' THEN
    v_self := public.is_center_admin(v_link.subject_id);
    IF v_me IS NOT NULL AND public.care_staff_at_center(v_me, v_link.subject_id) THEN
      v_opts := v_opts || jsonb_build_array(jsonb_build_object('as', 'staff', 'org_id', v_link.subject_id,
        'label', 'As someone who works here'));
    END IF;
  ELSE
    v_self := v_me IS NOT NULL AND v_me = v_link.subject_id;
    IF NOT v_self THEN
      -- As one of my centers the person works or worked at
      v_opts := v_opts || COALESCE((
        SELECT jsonb_agg(jsonb_build_object('as', 'center', 'org_id', c.id, 'label', 'As ' || c.name) ORDER BY c.name)
        FROM center_admins ca JOIN centers c ON c.id = ca.center_id
        WHERE ca.user_id = v_uid AND public.care_staff_at_center(v_link.subject_id, c.id)), '[]'::jsonb);
      -- As a coworker at a center we share
      IF v_me IS NOT NULL THEN
        v_opts := v_opts || COALESCE((
          SELECT jsonb_agg(jsonb_build_object('as', 'peer', 'org_id', c.id, 'label', 'As a coworker at ' || c.name) ORDER BY c.name)
          FROM centers c
          WHERE public.care_staff_at_center(v_me, c.id) AND public.care_staff_at_center(v_link.subject_id, c.id)), '[]'::jsonb);
      END IF;
    END IF;
  END IF;

  -- Each option's latest review by this viewer
  SELECT COALESCE(jsonb_agg(o || jsonb_build_object('existing', (
           SELECT jsonb_build_object('rating', r.rating, 'public_comment', r.public_comment, 'private_feedback', r.private_feedback,
                                     'sub_ratings', r.sub_ratings, 'editable', r.locked_at > now() AND r.hidden_at IS NULL,
                                     'next_review_at', r.created_at + interval '90 days')
           FROM shift_reviews r
           WHERE r.shift_id IS NULL AND r.reviewee_id = v_link.subject_id AND r.reviewer_type = o ->> 'as'
             AND r.reviewer_id = CASE WHEN o ->> 'as' = 'center' THEN (o ->> 'org_id')::uuid ELSE v_me END
           ORDER BY r.created_at DESC LIMIT 1))), '[]'::jsonb)
    INTO v_opts FROM jsonb_array_elements(v_opts) o;

  RETURN jsonb_build_object('subject_type', v_link.subject_type, 'is_self', v_self, 'options', v_opts);
END;
$$;


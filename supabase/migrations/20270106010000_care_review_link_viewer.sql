-- ============================================================
-- Review links: say who is signed in and why a way to review is not open.
-- care_review_link_options() now also returns 'viewer': email, whether the account has a staff profile (and its
-- display name), the centers it administers, and whether it has a shift at this center that has not ended yet.
-- Only the signed-in person's own details. Rollback: re-run care_review_link_options from 20270106000000.
-- ============================================================

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
  v_viewer jsonb;
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

  -- Who is signed in, so the page can say why a way to review is not open (wrong account, no recent work there)
  v_viewer := jsonb_build_object(
    'email', (SELECT email FROM auth.users WHERE id = v_uid),
    'has_staff_profile', v_me IS NOT NULL,
    'staff_name', CASE WHEN v_me IS NOT NULL THEN (public.care_staff_display(v_me)).name END,
    'admin_of', COALESCE((SELECT jsonb_agg(c.name ORDER BY c.name) FROM center_admins ca JOIN centers c ON c.id = ca.center_id
                          WHERE ca.user_id = v_uid), '[]'::jsonb),
    -- A shift at this center today or later that has not been checked out yet (it counts once it ends)
    'pending_shift_here', v_link.subject_type = 'center' AND v_me IS NOT NULL AND EXISTS (
      SELECT 1 FROM shift_claims sc JOIN shifts s ON s.id = sc.shift_id
      WHERE sc.staff_id = v_me AND s.center_id = v_link.subject_id AND sc.status = 'confirmed'
        AND sc.check_out_time IS NULL AND s.shift_date >= current_date));

  RETURN jsonb_build_object('subject_type', v_link.subject_type, 'is_self', v_self, 'options', v_opts, 'viewer', v_viewer);
END;
$$;

REVOKE ALL ON FUNCTION public.care_review_link_options(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.care_review_link_options(text) TO authenticated;

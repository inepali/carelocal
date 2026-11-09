-- ============================================================
-- Center announcements, phase 1 (email): a center owner or admin writes one note and sends it to a group —
-- all parents, the parents of chosen classes, all active staff (or regular staff only), or a mix.
--
--  - centers.announcements_enabled: the module switch (super admin only, like the other modules). Off by default.
--  - announcements: one row per note. The audience is stored as data so new groups (program, age, picked people)
--    need no schema change:
--      {"parents": "all"}                      every enrolled child's contacts
--      {"parents": {"classes": [<room id>]}}   contacts of enrolled children whose home room is one of these
--      {"staff": "all" | "regular"}            active center staff (regular + substitutes) or regular only
--    Keys combine: {"parents": "all", "staff": "all"}.
--  - Parents are the child's pick-up contacts that can get messages (can_pick_up AND can_message), the same rule
--    as teacher messages. Withdrawn children's contacts are never included.
--  - announcement_recipients: the people it went to, frozen at send time (later roster changes do not rewrite
--    history). One row per email address: a parent of two children, or a parent who also works here, gets one
--    copy. People in the group with no email are counted (no_email_count), not stored.
--  - announcement_deliveries: one row per recipient and channel, with the provider result. Only 'email' today;
--    GroupMe and SMS add rows here later.
--  - Each email carries a link (/a/<token>) that opens just that announcement for 30 days, so a parent can read
--    and acknowledge it without the PIN. Only the token's SHA-256 is stored, set by the sender when the email goes.
--  - Owners and admins read everything at their center (row level security); every write goes through the
--    functions below. The sending functions are service role only.
--  - Parents also see their announcements on the parent page (Notices tab, 60 days) and staff in the staff app;
--    either can acknowledge there. Needs the parent portal migrations (parent_actor) first.
-- Rollback: supabase/rollbacks/20261230000000_announcements.down.sql
-- ============================================================

-- 1. The module switch -------------------------------------------------------------------------------------------
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS announcements_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_announcements_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.announcements_enabled IS NOT DISTINCT FROM OLD.announcements_enabled THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.announcements_enabled := OLD.announcements_enabled;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_announcements_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_announcements_flag ON public.centers;
CREATE TRIGGER trg_guard_announcements_flag BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_announcements_flag();

-- 2. Tables -------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id       uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  subject         text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 150),
  body            text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  audience        jsonb NOT NULL CHECK (jsonb_typeof(audience) = 'object'),
  audience_label  text NOT NULL,                                -- "All parents · All staff", as it was when sent
  channels        text[] NOT NULL DEFAULT '{email}' CHECK (cardinality(channels) > 0 AND channels <@ ARRAY['email', 'groupme', 'sms']),
  urgent          boolean NOT NULL DEFAULT false,
  requires_ack    boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'sending'
                    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'partial', 'failed', 'canceled')),
  recipient_count integer NOT NULL DEFAULT 0,
  no_email_count  integer NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_label    text NOT NULL,                                -- "Priya S.", as it was when sent
  client_key      uuid NOT NULL,                                -- the app's key: a retried Send is sent once
  scheduled_at    timestamptz,                                  -- phase 2
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  finished_at     timestamptz,
  CONSTRAINT announcements_client_key UNIQUE (center_id, client_key)
);
CREATE INDEX IF NOT EXISTS announcements_center_idx ON public.announcements (center_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.announcement_recipients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id  uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  center_id        uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('parent', 'staff')),
  name             text NOT NULL,                               -- as it was when sent
  email            text NOT NULL,
  guardian_ids     uuid[] NOT NULL DEFAULT '{}',
  child_ids        uuid[] NOT NULL DEFAULT '{}',
  staff_id         uuid,
  user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  view_token_hash  text UNIQUE CHECK (view_token_hash IS NULL OR view_token_hash ~ '^[0-9a-f]{64}$'),
  opened_at        timestamptz,
  acknowledged_at  timestamptz,
  CONSTRAINT announcement_recipients_one_email UNIQUE (announcement_id, email)
);
CREATE INDEX IF NOT EXISTS announcement_recipients_center_idx ON public.announcement_recipients (center_id);
CREATE INDEX IF NOT EXISTS announcement_recipients_user_idx ON public.announcement_recipients (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.announcement_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id  uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  recipient_id     uuid NOT NULL REFERENCES public.announcement_recipients(id) ON DELETE CASCADE,
  center_id        uuid NOT NULL,
  channel          text NOT NULL CHECK (channel IN ('email', 'groupme', 'sms')),
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'failed')),
  attempts         integer NOT NULL DEFAULT 0,
  last_attempt_at  timestamptz,
  provider_id      text,
  last_error       text,
  sent_at          timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcement_deliveries_one_per_channel UNIQUE (recipient_id, channel)
);
CREATE INDEX IF NOT EXISTS announcement_deliveries_due_idx ON public.announcement_deliveries (last_attempt_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS announcement_deliveries_announcement_idx ON public.announcement_deliveries (announcement_id, status);
CREATE INDEX IF NOT EXISTS announcement_deliveries_provider_idx ON public.announcement_deliveries (provider_id) WHERE provider_id IS NOT NULL;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and admins read announcements" ON public.announcements;
CREATE POLICY "Owners and admins read announcements" ON public.announcements
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
DROP POLICY IF EXISTS "Owners and admins read announcement_recipients" ON public.announcement_recipients;
CREATE POLICY "Owners and admins read announcement_recipients" ON public.announcement_recipients
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
DROP POLICY IF EXISTS "Owners and admins read announcement_deliveries" ON public.announcement_deliveries;
CREATE POLICY "Owners and admins read announcement_deliveries" ON public.announcement_deliveries
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));

REVOKE ALL ON public.announcements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.announcement_recipients FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.announcement_deliveries FROM PUBLIC, anon, authenticated;
-- Tokens never leave the database, not even to owners
GRANT SELECT ON public.announcements TO authenticated;
GRANT SELECT (id, announcement_id, center_id, kind, name, email, guardian_ids, child_ids, staff_id, user_id, opened_at, acknowledged_at)
  ON public.announcement_recipients TO authenticated;
GRANT SELECT ON public.announcement_deliveries TO authenticated;
GRANT ALL ON public.announcements TO service_role;
GRANT ALL ON public.announcement_recipients TO service_role;
GRANT ALL ON public.announcement_deliveries TO service_role;

-- 3. Who is in a group ---------------------------------------------------------------------------------------------

-- The caller may send announcements at this center: an owner or admin, the center active with the module on
CREATE OR REPLACE FUNCTION public.announcement_check(p_center_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_confidential(p_center_id) THEN
    RAISE EXCEPTION 'Only center owners and admins can send announcements.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM centers WHERE id = p_center_id AND announcements_enabled AND is_active) THEN
    RAISE EXCEPTION 'Announcements are not turned on for this center.' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.announcement_check(uuid) FROM PUBLIC, anon, authenticated;

-- Checks an audience and returns it in a canonical form. Raises on anything it does not understand.
CREATE OR REPLACE FUNCTION public.announcement_audience_clean(p_center_id uuid, p_audience jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parents jsonb := p_audience -> 'parents';
  v_staff   jsonb := p_audience -> 'staff';
  v_classes uuid[];
  v_out     jsonb := '{}'::jsonb;
BEGIN
  IF p_audience IS NULL OR jsonb_typeof(p_audience) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_audience) k WHERE k NOT IN ('parents', 'staff')) THEN
    RAISE EXCEPTION 'Pick who to send to.' USING ERRCODE = '22023';
  END IF;

  IF v_parents IS NOT NULL AND v_parents <> 'null'::jsonb THEN
    IF NOT EXISTS (SELECT 1 FROM centers WHERE id = p_center_id AND COALESCE(domain_key, 'childcare') = 'childcare' AND child_files_enabled) THEN
      RAISE EXCEPTION 'Parent announcements need the Children module.' USING ERRCODE = '22023';
    END IF;
    IF v_parents = '"all"'::jsonb THEN
      v_out := v_out || '{"parents": "all"}'::jsonb;
    ELSIF jsonb_typeof(v_parents) = 'object' AND jsonb_typeof(v_parents -> 'classes') = 'array' THEN
      BEGIN
        v_classes := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(v_parents -> 'classes') x);
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Pick the classes again.' USING ERRCODE = '22023';
      END;
      IF cardinality(v_classes) = 0 THEN RAISE EXCEPTION 'Pick at least one class.' USING ERRCODE = '22023'; END IF;
      IF (SELECT count(*) FROM work_areas w WHERE w.id = ANY (v_classes) AND w.center_id = p_center_id) <> cardinality(v_classes) THEN
        RAISE EXCEPTION 'A class you picked is not at this center.' USING ERRCODE = '22023';
      END IF;
      v_out := v_out || jsonb_build_object('parents', jsonb_build_object('classes', to_jsonb(v_classes)));
    ELSE
      RAISE EXCEPTION 'Pick which parents to send to.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_staff IS NOT NULL AND v_staff <> 'null'::jsonb THEN
    IF v_staff NOT IN ('"all"'::jsonb, '"regular"'::jsonb) THEN
      RAISE EXCEPTION 'Pick which staff to send to.' USING ERRCODE = '22023';
    END IF;
    v_out := v_out || jsonb_build_object('staff', v_staff);
  END IF;

  IF v_out = '{}'::jsonb THEN RAISE EXCEPTION 'Pick who to send to.' USING ERRCODE = '22023'; END IF;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.announcement_audience_clean(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- "All parents · Toddler 2, Pre-K parents · All staff": how the group reads in lists and emails
CREATE OR REPLACE FUNCTION public.announcement_audience_label(p_center_id uuid, p_audience jsonb)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT array_to_string(ARRAY[
    CASE WHEN p_audience -> 'parents' = '"all"'::jsonb THEN 'All parents'
         WHEN p_audience -> 'parents' ? 'classes' THEN
           (SELECT string_agg(w.name, ', ' ORDER BY w.name) FROM work_areas w
             WHERE w.center_id = p_center_id AND w.id::text IN (SELECT jsonb_array_elements_text(p_audience -> 'parents' -> 'classes'))) || ' parents'
    END,
    CASE p_audience ->> 'staff' WHEN 'all' THEN 'All staff' WHEN 'regular' THEN 'Regular staff' END
  ], ' · ');
$$;
REVOKE ALL ON FUNCTION public.announcement_audience_label(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Everyone in a (clean) audience, one row per email address; people with no email come back with email NULL,
-- one row each. A person who is both a parent and staff is the parent (they get the parent link).
CREATE OR REPLACE FUNCTION public.announcement_people(p_center_id uuid, p_audience jsonb)
RETURNS TABLE (kind text, email text, name text, guardian_ids uuid[], child_ids uuid[], staff_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH parent_rows AS (
    SELECT lower(NULLIF(btrim(g.email), '')) AS email, g.id AS guardian_id, g.child_id, g.name, g.is_primary
      FROM child_guardians g JOIN children ch ON ch.id = g.child_id AND ch.center_id = g.center_id
     WHERE p_audience ? 'parents' AND g.center_id = p_center_id AND ch.status = 'enrolled' AND g.can_pick_up AND g.can_message
       AND (p_audience -> 'parents' = '"all"'::jsonb
            OR ch.classroom_id::text IN (SELECT jsonb_array_elements_text(p_audience -> 'parents' -> 'classes')))
  ), parents AS (
    SELECT 'parent'::text AS kind, email,
           (array_agg(name ORDER BY is_primary DESC, name))[1] AS name,
           array_agg(DISTINCT guardian_id) AS guardian_ids, array_agg(DISTINCT child_id) AS child_ids,
           NULL::uuid AS staff_id, NULL::uuid AS user_id, 0 AS rank
      FROM parent_rows WHERE email IS NOT NULL GROUP BY email
    UNION ALL
    SELECT 'parent', NULL, name, ARRAY[guardian_id], ARRAY[child_id], NULL, NULL, 0 FROM parent_rows WHERE email IS NULL
  ), staff AS (
    SELECT 'staff'::text AS kind,
           lower(NULLIF(btrim(COALESCE(NULLIF(btrim(sp.email), ''), u.email)), '')) AS email,
           btrim(COALESCE(sp.first_name, '') || ' ' || COALESCE(sp.last_name, '')) AS name,
           '{}'::uuid[] AS guardian_ids, '{}'::uuid[] AS child_ids, sp.id AS staff_id, sp.user_id, 1 AS rank
      FROM center_staff cs JOIN staff_profiles sp ON sp.id = cs.staff_id
      LEFT JOIN auth.users u ON u.id = sp.user_id
     WHERE p_audience ? 'staff' AND cs.center_id = p_center_id AND cs.status = 'active'
       AND (p_audience ->> 'staff' = 'all' OR cs.employment_class = 'regular')
  ), everyone AS (SELECT * FROM parents UNION ALL SELECT * FROM staff)
  SELECT DISTINCT ON (COALESCE(e.email, 'none:' || COALESCE(e.guardian_ids[1], e.staff_id)::text)) e.kind, e.email,
         COALESCE(NULLIF(e.name, ''), 'Staff'), e.guardian_ids, e.child_ids, e.staff_id, e.user_id
    FROM everyone e
   ORDER BY COALESCE(e.email, 'none:' || COALESCE(e.guardian_ids[1], e.staff_id)::text), e.rank;
$$;
REVOKE ALL ON FUNCTION public.announcement_people(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 4. Owners and admins ------------------------------------------------------------------------------------------

-- Who a group reaches right now, before sending: counts plus the list (owners and admins see contacts anyway)
CREATE OR REPLACE FUNCTION public.announcement_preview(p_center_id uuid, p_audience jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_audience jsonb;
BEGIN
  PERFORM public.announcement_check(p_center_id);
  v_audience := public.announcement_audience_clean(p_center_id, p_audience);
  RETURN (
    SELECT jsonb_build_object(
      'label', public.announcement_audience_label(p_center_id, v_audience),
      'total', count(*) FILTER (WHERE p.email IS NOT NULL),
      'parents', count(*) FILTER (WHERE p.email IS NOT NULL AND p.kind = 'parent'),
      'staff', count(*) FILTER (WHERE p.email IS NOT NULL AND p.kind = 'staff'),
      'no_email', count(*) FILTER (WHERE p.email IS NULL),
      'people', COALESCE(jsonb_agg(jsonb_build_object('kind', p.kind, 'name', p.name, 'email', p.email)
                                   ORDER BY p.kind, p.name), '[]'::jsonb))
    FROM public.announcement_people(p_center_id, v_audience) p
  );
END $$;

-- Send an announcement. Returns its id (the existing one when the same Send is retried). The app then sends
-- right away with announcement_claim(<id>); the cron run picks up anything left over.
CREATE OR REPLACE FUNCTION public.announcement_create(
  p_center_id uuid, p_subject text, p_body text, p_audience jsonb, p_channels text[],
  p_urgent boolean, p_requires_ack boolean, p_client_key uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_max_people   constant integer := 2000;
  c_max_per_day  constant integer := 20;
  v_id       uuid;
  v_subject  text := NULLIF(btrim(regexp_replace(COALESCE(p_subject, ''), '[\r\n]+', ' ', 'g')), '');
  v_body     text := NULLIF(btrim(COALESCE(p_body, '')), '');
  v_channels text[] := ARRAY(SELECT DISTINCT unnest(COALESCE(p_channels, '{}'::text[])));
  v_audience jsonb;
  v_with     integer;
  v_without  integer;
BEGIN
  IF p_client_key IS NULL THEN RAISE EXCEPTION 'Missing the announcement key.' USING ERRCODE = '22023'; END IF;
  PERFORM public.announcement_check(p_center_id);
  SELECT id INTO v_id FROM announcements WHERE center_id = p_center_id AND client_key = p_client_key;
  IF FOUND THEN RETURN v_id; END IF;

  IF v_subject IS NULL OR char_length(v_subject) > 150 THEN
    RAISE EXCEPTION 'Write a subject (up to 150 characters).' USING ERRCODE = '22023';
  END IF;
  IF v_body IS NULL OR char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'Write the message (up to 5,000 characters).' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_channels) = 0 THEN RAISE EXCEPTION 'Pick how to send it.' USING ERRCODE = '22023'; END IF;
  IF NOT v_channels <@ ARRAY['email'] THEN
    RAISE EXCEPTION 'Only email is available for now.' USING ERRCODE = '22023';
  END IF;
  v_audience := public.announcement_audience_clean(p_center_id, p_audience);

  -- One center at a time, so two admins sending at once cannot both slip under the daily cap
  PERFORM pg_advisory_xact_lock(hashtext('announcement:' || p_center_id::text));
  IF (SELECT count(*) FROM announcements WHERE center_id = p_center_id AND created_at > now() - interval '1 day') >= c_max_per_day THEN
    RAISE EXCEPTION 'That is a lot of announcements for one day. Try again tomorrow.' USING ERRCODE = '54000';
  END IF;

  SELECT count(*) FILTER (WHERE p.email IS NOT NULL), count(*) FILTER (WHERE p.email IS NULL)
    INTO v_with, v_without FROM public.announcement_people(p_center_id, v_audience) p;

  IF v_with = 0 THEN RAISE EXCEPTION 'Nobody in that group has an email address.' USING ERRCODE = '22023'; END IF;
  IF v_with > c_max_people THEN
    RAISE EXCEPTION 'That group has more than % people. Pick a smaller group.', c_max_people USING ERRCODE = '54000';
  END IF;

  INSERT INTO announcements (center_id, subject, body, audience, audience_label, channels, urgent, requires_ack,
                             status, recipient_count, no_email_count, created_by, sender_label, client_key, sent_at)
  VALUES (p_center_id, v_subject, v_body, v_audience, public.announcement_audience_label(p_center_id, v_audience),
          v_channels, COALESCE(p_urgent, false), COALESCE(p_requires_ack, false), 'sending', v_with, v_without,
          auth.uid(), COALESCE(public.daily_person_label(auth.uid(), p_center_id), 'Center admin'), p_client_key, now())
  RETURNING id INTO v_id;

  INSERT INTO announcement_recipients (announcement_id, center_id, kind, name, email, guardian_ids, child_ids, staff_id, user_id)
  SELECT v_id, p_center_id, p.kind, p.name, p.email, p.guardian_ids, p.child_ids, p.staff_id, p.user_id
    FROM public.announcement_people(p_center_id, v_audience) p WHERE p.email IS NOT NULL;

  INSERT INTO announcement_deliveries (announcement_id, recipient_id, center_id, channel)
  SELECT v_id, r.id, p_center_id, ch FROM announcement_recipients r CROSS JOIN unnest(v_channels) ch
   WHERE r.announcement_id = v_id;
  RETURN v_id;
END $$;

-- 5. The sender (service role only) -----------------------------------------------------------------------------

-- An announcement's status from its deliveries: any queued = sending; all out = sent; some = partial; none = failed
CREATE OR REPLACE FUNCTION public.announcement_refresh(p_announcement_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE announcements a SET
    status = s.status,
    finished_at = CASE WHEN s.status = 'sending' THEN NULL ELSE COALESCE(a.finished_at, now()) END
  FROM (
    SELECT CASE WHEN bool_or(d.status = 'queued') THEN 'sending'
                WHEN bool_and(d.status IN ('sent', 'delivered')) THEN 'sent'
                WHEN bool_or(d.status IN ('sent', 'delivered')) THEN 'partial'
                ELSE 'failed' END AS status
      FROM announcement_deliveries d WHERE d.announcement_id = p_announcement_id
  ) s
  WHERE a.id = p_announcement_id AND a.status IN ('sending', 'sent', 'partial', 'failed') AND s.status IS NOT NULL;
$$;

-- Claim deliveries to send. With an announcement id: its not-yet-tried deliveries (the app, right after Send).
-- Without: the cron retry — deliveries still queued 10 minutes after their last try; after 3 tries, failed; and
-- anything queued at a center whose module was turned off, failed. Rows are locked so two runs never share one.
CREATE OR REPLACE FUNCTION public.announcement_claim(p_announcement_id uuid DEFAULT NULL, p_limit integer DEFAULT 100)
RETURNS TABLE (delivery_id uuid, recipient_id uuid, announcement_id uuid, center_id uuid, channel text, kind text,
               name text, email text, subject text, body text, urgent boolean, requires_ack boolean,
               sender_label text, center_name text, center_email text, center_domain text, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_id uuid;
BEGIN
  IF p_announcement_id IS NULL THEN
    FOR v_id IN
      UPDATE announcement_deliveries d SET status = 'failed', updated_at = now(),
             last_error = CASE WHEN c.announcements_enabled AND c.is_active
                               THEN COALESCE(d.last_error, 'Not sent after 3 tries') ELSE 'Announcements turned off' END
        FROM centers c
       WHERE c.id = d.center_id AND d.status = 'queued'
         AND ((d.attempts >= 3 AND d.last_attempt_at < now() - interval '10 minutes') OR NOT (c.announcements_enabled AND c.is_active))
      RETURNING d.announcement_id
    LOOP
      PERFORM public.announcement_refresh(v_id);
    END LOOP;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT d.id FROM announcement_deliveries d JOIN centers c ON c.id = d.center_id
     WHERE d.status = 'queued' AND c.announcements_enabled AND c.is_active
       AND CASE WHEN p_announcement_id IS NOT NULL THEN d.announcement_id = p_announcement_id AND d.attempts = 0
                ELSE d.attempts < 3 AND (d.last_attempt_at IS NULL OR d.last_attempt_at < now() - interval '10 minutes') END
     ORDER BY d.last_attempt_at NULLS FIRST
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
     FOR UPDATE OF d SKIP LOCKED
  ), claimed AS (
    UPDATE announcement_deliveries d SET attempts = d.attempts + 1, last_attempt_at = now(), updated_at = now()
      FROM picked WHERE d.id = picked.id
    RETURNING d.id, d.recipient_id, d.announcement_id, d.center_id, d.channel, d.attempts
  )
  SELECT cl.id, cl.recipient_id, cl.announcement_id, cl.center_id, cl.channel, r.kind, r.name, r.email,
         a.subject, a.body, a.urgent, a.requires_ack, a.sender_label, c.name, NULLIF(btrim(c.email), ''), c.domain_key, cl.attempts
    FROM claimed cl
    JOIN announcement_recipients r ON r.id = cl.recipient_id
    JOIN announcements a ON a.id = cl.announcement_id
    JOIN centers c ON c.id = cl.center_id;
END $$;

-- The provider's answer for one delivery. On success the view link's token hash is kept (the link in that
-- email); on failure the delivery stays queued for the cron retry until its third try.
CREATE OR REPLACE FUNCTION public.announcement_delivery_result(
  p_delivery_id uuid, p_ok boolean, p_provider_id text DEFAULT NULL, p_error text DEFAULT NULL, p_token_hash text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_d announcement_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM announcement_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND OR v_d.status <> 'queued' THEN RETURN; END IF;
  IF p_ok THEN
    IF p_token_hash IS NOT NULL THEN
      IF p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Bad token hash' USING ERRCODE = '22023'; END IF;
      UPDATE announcement_recipients SET view_token_hash = p_token_hash WHERE id = v_d.recipient_id;
    END IF;
    UPDATE announcement_deliveries SET status = 'sent', provider_id = left(p_provider_id, 200), last_error = NULL,
           sent_at = now(), updated_at = now() WHERE id = p_delivery_id;
  ELSE
    UPDATE announcement_deliveries SET last_error = left(COALESCE(p_error, 'Send failed'), 500),
           status = CASE WHEN v_d.attempts >= 3 THEN 'failed' ELSE 'queued' END, updated_at = now()
     WHERE id = p_delivery_id;
  END IF;
  PERFORM public.announcement_refresh(v_d.announcement_id);
END $$;

-- A provider webhook (Resend: delivered / bounced / complained) for a sent delivery. Returns whether it matched.
CREATE OR REPLACE FUNCTION public.announcement_delivery_event(p_provider_id text, p_event text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_announcement uuid;
BEGIN
  IF p_provider_id IS NULL OR p_event NOT IN ('delivered', 'bounced', 'complained') THEN RETURN false; END IF;
  UPDATE announcement_deliveries SET
    status = CASE WHEN p_event = 'delivered' AND status = 'sent' THEN 'delivered'
                  WHEN p_event IN ('bounced', 'complained') THEN 'bounced' ELSE status END,
    last_error = CASE WHEN p_event IN ('bounced', 'complained') THEN 'Email ' || p_event ELSE last_error END,
    updated_at = now()
   WHERE provider_id = p_provider_id AND status IN ('sent', 'delivered')
  RETURNING announcement_id INTO v_announcement;
  IF v_announcement IS NULL THEN RETURN false; END IF;
  PERFORM public.announcement_refresh(v_announcement);
  RETURN true;
END $$;

-- 6. The link in the email (service role only; the app hashes the token from the URL) ------------------------

-- Open one announcement: what to show, or NULL when the link is wrong, older than 30 days, or the center turned
-- announcements off. Records the first open. Opening never acknowledges.
CREATE OR REPLACE FUNCTION public.announcement_open(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_recipient uuid;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT r.id, jsonb_build_object(
           'center_name', c.name, 'center_email', c.email, 'subject', a.subject, 'body', a.body,
           'sender_label', a.sender_label, 'sent_at', a.sent_at, 'urgent', a.urgent,
           'requires_ack', a.requires_ack, 'acknowledged_at', r.acknowledged_at, 'kind', r.kind)
    INTO v_recipient, v
    FROM announcement_recipients r
    JOIN announcements a ON a.id = r.announcement_id
    JOIN centers c ON c.id = r.center_id
   WHERE r.view_token_hash = p_token_hash AND c.announcements_enabled AND c.is_active
     AND a.sent_at > now() - interval '30 days';
  IF v_recipient IS NULL THEN RETURN NULL; END IF;
  UPDATE announcement_recipients SET opened_at = now() WHERE id = v_recipient AND opened_at IS NULL;
  RETURN v;
END $$;

-- Acknowledge from the link ("I have read this"). Returns the acknowledgement time, or NULL for a bad link or an
-- announcement that did not ask for one.
CREATE OR REPLACE FUNCTION public.announcement_acknowledge(p_token_hash text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_at timestamptz;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  UPDATE announcement_recipients r
     SET acknowledged_at = COALESCE(r.acknowledged_at, now()), opened_at = COALESCE(r.opened_at, now())
    FROM announcements a, centers c
   WHERE r.view_token_hash = p_token_hash AND a.id = r.announcement_id AND c.id = r.center_id
     AND a.requires_ack AND c.announcements_enabled AND c.is_active AND a.sent_at > now() - interval '30 days'
  RETURNING r.acknowledged_at INTO v_at;
  RETURN v_at;
END $$;

-- 7. Reading announcements back ----------------------------------------------------------------------------------

-- Owners and admins: the center's announcements, newest first, with how each is doing
CREATE OR REPLACE FUNCTION public.announcements_list(p_center_id uuid, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.announcement_check(p_center_id);
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
      SELECT a.id, a.subject, a.audience_label, a.status, a.urgent, a.requires_ack, a.sender_label, a.created_at, a.sent_at,
             a.recipient_count, a.no_email_count,
             (SELECT count(*) FROM announcement_deliveries d WHERE d.announcement_id = a.id AND d.status IN ('sent', 'delivered')) AS sent,
             (SELECT count(*) FROM announcement_deliveries d WHERE d.announcement_id = a.id AND d.status IN ('failed', 'bounced')) AS failed,
             (SELECT count(*) FROM announcement_deliveries d WHERE d.announcement_id = a.id AND d.status = 'queued') AS queued,
             (SELECT count(*) FROM announcement_recipients r WHERE r.announcement_id = a.id AND r.opened_at IS NOT NULL) AS opened,
             (SELECT count(*) FROM announcement_recipients r WHERE r.announcement_id = a.id AND r.acknowledged_at IS NOT NULL) AS acknowledged
        FROM announcements a
       WHERE a.center_id = p_center_id
       ORDER BY a.created_at DESC
       LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))) x), '[]'::jsonb);
END $$;

-- Owners and admins: one announcement and every person it went to (with the children a parent was sent about)
CREATE OR REPLACE FUNCTION public.announcement_detail(p_center_id uuid, p_announcement_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.announcement_check(p_center_id);
  RETURN (
    SELECT to_jsonb(a) - 'client_key' - 'created_by' || jsonb_build_object('recipients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'kind', r.kind, 'name', r.name, 'email', r.email,
               'children', (SELECT COALESCE(jsonb_agg(COALESCE(NULLIF(btrim(ch.preferred_name), ''), ch.first_name) ORDER BY ch.first_name), '[]'::jsonb)
                              FROM children ch WHERE ch.id = ANY (r.child_ids)),
               'status', d.status, 'error', d.last_error, 'sent_at', d.sent_at,
               'opened_at', r.opened_at, 'acknowledged_at', r.acknowledged_at)
             ORDER BY r.kind, r.name)
        FROM announcement_recipients r
        LEFT JOIN announcement_deliveries d ON d.recipient_id = r.id AND d.channel = 'email'
       WHERE r.announcement_id = a.id), '[]'::jsonb))
      FROM announcements a WHERE a.id = p_announcement_id AND a.center_id = p_center_id);
END $$;

-- Parent page (service role): announcements sent to this parent in the last 60 days, newest first. NULL when signed
-- out or the center has announcements off (the page then hides the tab). p_mark_seen: the parent opened the tab;
-- 'unread' in the answer is how it was before that.
CREATE OR REPLACE FUNCTION public.parent_portal_announcements(p_token_hash text, p_mark_seen boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor record; v_center uuid; v_result jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.parent_actor(p_token_hash, NULL);
  IF v_actor.guardians IS NULL THEN RETURN NULL; END IF;
  SELECT g.center_id INTO v_center FROM child_guardians g WHERE g.id = v_actor.guardians[1];
  IF NOT EXISTS (SELECT 1 FROM centers WHERE id = v_center AND announcements_enabled AND is_active) THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.sent_at DESC), '[]'::jsonb) INTO v_result FROM (
    SELECT a.id, a.subject, a.body, a.sender_label, a.sent_at, a.urgent, a.requires_ack,
           bool_or(r.acknowledged_at IS NOT NULL) AS acknowledged,
           bool_and(r.opened_at IS NULL) AS unread
      FROM announcement_recipients r JOIN announcements a ON a.id = r.announcement_id
     WHERE r.kind = 'parent' AND r.center_id = v_center AND r.guardian_ids && v_actor.guardians
       AND a.sent_at > now() - interval '60 days'
     GROUP BY a.id
     ORDER BY a.sent_at DESC
     LIMIT 50) x;

  IF p_mark_seen THEN
    UPDATE announcement_recipients r SET opened_at = now()
      FROM announcements a
     WHERE a.id = r.announcement_id AND r.kind = 'parent' AND r.center_id = v_center
       AND r.guardian_ids && v_actor.guardians AND r.opened_at IS NULL AND a.sent_at > now() - interval '60 days';
  END IF;
  RETURN v_result;
END $$;

-- Parent page (service role): acknowledge one announcement that asked for it
CREATE OR REPLACE FUNCTION public.parent_portal_announcement_ack(p_token_hash text, p_announcement_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor record; v_n integer;
BEGIN
  SELECT * INTO v_actor FROM public.parent_actor(p_token_hash, NULL);
  IF v_actor.guardians IS NULL THEN RETURN false; END IF;
  UPDATE announcement_recipients r
     SET acknowledged_at = COALESCE(r.acknowledged_at, now()), opened_at = COALESCE(r.opened_at, now())
    FROM announcements a, centers c
   WHERE r.announcement_id = p_announcement_id AND a.id = r.announcement_id AND c.id = r.center_id
     AND r.kind = 'parent' AND r.guardian_ids && v_actor.guardians
     AND a.requires_ack AND c.announcements_enabled AND c.is_active AND a.sent_at > now() - interval '60 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;

-- Staff (signed in): announcements sent to me as staff in the last 60 days, at centers that still have them on.
-- p_mark_seen as above.
CREATE OR REPLACE FUNCTION public.my_announcements(p_mark_seen boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.sent_at DESC), '[]'::jsonb) INTO v_result FROM (
    SELECT a.id, a.subject, a.body, a.sender_label, a.sent_at, a.urgent, a.requires_ack, c.name AS center_name,
           r.acknowledged_at IS NOT NULL AS acknowledged, r.opened_at IS NULL AS unread
      FROM announcement_recipients r
      JOIN announcements a ON a.id = r.announcement_id
      JOIN centers c ON c.id = r.center_id
     WHERE r.kind = 'staff' AND r.user_id = auth.uid() AND c.announcements_enabled AND c.is_active
       AND a.sent_at > now() - interval '60 days'
     ORDER BY a.sent_at DESC
     LIMIT 50) x;
  IF p_mark_seen THEN
    UPDATE announcement_recipients r SET opened_at = now()
      FROM announcements a
     WHERE a.id = r.announcement_id AND r.kind = 'staff' AND r.user_id = auth.uid() AND r.opened_at IS NULL
       AND a.sent_at > now() - interval '60 days';
  END IF;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.my_announcement_ack(p_announcement_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  UPDATE announcement_recipients r
     SET acknowledged_at = COALESCE(r.acknowledged_at, now()), opened_at = COALESCE(r.opened_at, now())
    FROM announcements a, centers c
   WHERE r.announcement_id = p_announcement_id AND a.id = r.announcement_id AND c.id = r.center_id
     AND r.kind = 'staff' AND r.user_id = auth.uid()
     AND a.requires_ack AND c.announcements_enabled AND c.is_active AND a.sent_at > now() - interval '60 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;

-- 8. Grants -------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.announcement_preview(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.announcement_create(uuid, text, text, jsonb, text[], boolean, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_preview(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.announcement_create(uuid, text, text, jsonb, text[], boolean, boolean, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.announcements_list(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.announcement_detail(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_announcements(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_announcement_ack(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcements_list(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.announcement_detail(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_announcements(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_announcement_ack(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.parent_portal_announcements(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parent_portal_announcement_ack(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_portal_announcements(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.parent_portal_announcement_ack(text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.announcement_refresh(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.announcement_claim(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.announcement_delivery_result(uuid, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.announcement_delivery_event(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.announcement_open(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.announcement_acknowledge(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.announcement_refresh(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.announcement_claim(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.announcement_delivery_result(uuid, boolean, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.announcement_delivery_event(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.announcement_open(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.announcement_acknowledge(text) TO service_role;

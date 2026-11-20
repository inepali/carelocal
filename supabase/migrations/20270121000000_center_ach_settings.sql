-- ============================================================
-- Center ACH settings: how each center's ACH (NACHA) file is built and delivered to its bank
--
--  - About → Center Profile → ACH bank settings. One row per center.
--  - Bank: Truist, Wells Fargo, Bank of America or another bank. The bank decides the Company ID, the file header
--    values it wants and how the file reaches it.
--  - Send method:
--      manual  build the file in CareLocal and upload it on the bank's website (the default, works with any bank)
--      sftp    CareLocal sends the file to the bank's SFTP server ("direct transmission")
--      api     the bank's API credentials are kept for later. Bank APIs take payments one at a time, not NACHA files,
--              so nothing is sent this way yet.
--  - Secrets (SFTP password or private key and its passphrase, API client secret and private key) arrive already
--    encrypted by the server (AES-256-GCM, key TUITION_BANK_KEY; see src/lib/server/bank-account.ts). The app can't
--    read the encrypted columns. center_ach_settings_secrets() hands them to the server for the owner and logs it.
--  - Changing where money goes or where the bank file is sent is a classic payment-fraud move, so only the center's
--    OWNER changes these settings. Admins (directors) see them without secrets.
--  - center_ach_settings_events records every change, connection test and file sent (who and when).
-- Needs: 20270110000000_center_bank_account.sql (center_bank_is_owner, center_bank_who), can_view_confidential(), centers.
-- Rollback: supabase/rollbacks/20270121000000_center_ach_settings.down.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.center_ach_settings (
  center_id                   uuid PRIMARY KEY REFERENCES public.centers(id) ON DELETE CASCADE,
  bank                        text NOT NULL DEFAULT 'other' CHECK (bank IN ('truist', 'wells_fargo', 'bank_of_america', 'other')),
  bank_label                  text CHECK (bank_label IS NULL OR char_length(bank_label) BETWEEN 1 AND 80),   -- name of an "other" bank
  send_method                 text NOT NULL DEFAULT 'manual' CHECK (send_method IN ('manual', 'sftp', 'api')),

  -- NACHA file. NULL means "use the default" (see src/lib/server/nacha.ts)
  company_id                  text CHECK (company_id IS NULL OR company_id ~ '^[A-Z0-9]{1,10}$'),
  company_name                text CHECK (company_name IS NULL OR char_length(company_name) BETWEEN 1 AND 16),
  entry_description           text CHECK (entry_description IS NULL OR char_length(entry_description) BETWEEN 1 AND 10),
  immediate_destination       text CHECK (immediate_destination IS NULL OR immediate_destination ~ '^[0-9]{9}$'),
  immediate_destination_name  text CHECK (immediate_destination_name IS NULL OR char_length(immediate_destination_name) BETWEEN 1 AND 23),
  immediate_origin            text CHECK (immediate_origin IS NULL OR immediate_origin ~ '^[A-Z0-9]{1,10}$'),
  balanced                    boolean NOT NULL DEFAULT false,
  line_ending                 text NOT NULL DEFAULT 'lf' CHECK (line_ending IN ('lf', 'crlf')),
  file_name_pattern           text CHECK (file_name_pattern IS NULL OR file_name_pattern ~ '^[A-Za-z0-9{}._-]{1,120}$'),

  -- SFTP ("direct transmission")
  sftp_host                   text CHECK (sftp_host IS NULL OR sftp_host ~ '^[A-Za-z0-9.-]{1,253}$'),
  sftp_port                   integer NOT NULL DEFAULT 22 CHECK (sftp_port BETWEEN 1 AND 65535),
  sftp_username               text CHECK (sftp_username IS NULL OR char_length(sftp_username) BETWEEN 1 AND 100),
  sftp_auth                   text NOT NULL DEFAULT 'key' CHECK (sftp_auth IN ('password', 'key')),
  sftp_secret_enc             text CHECK (sftp_secret_enc IS NULL OR (sftp_secret_enc ~ '^v[0-9]+:' AND char_length(sftp_secret_enc) <= 20000)),
  sftp_passphrase_enc         text CHECK (sftp_passphrase_enc IS NULL OR (sftp_passphrase_enc ~ '^v[0-9]+:' AND char_length(sftp_passphrase_enc) <= 2000)),
  sftp_remote_dir             text CHECK (sftp_remote_dir IS NULL OR (char_length(sftp_remote_dir) <= 200 AND sftp_remote_dir !~ '\.\.')),
  sftp_host_fingerprint       text CHECK (sftp_host_fingerprint IS NULL OR sftp_host_fingerprint ~ '^SHA256:[A-Za-z0-9+/]{43}=?$'),
  pgp_public_key              text CHECK (pgp_public_key IS NULL OR (char_length(pgp_public_key) <= 20000 AND pgp_public_key LIKE '-----BEGIN PGP PUBLIC KEY BLOCK-----%')),

  -- Bank API (kept for later; nothing is sent by API yet)
  api_environment             text NOT NULL DEFAULT 'sandbox' CHECK (api_environment IN ('sandbox', 'production')),
  api_base_url                text CHECK (api_base_url IS NULL OR api_base_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$'),
  api_client_id               text CHECK (api_client_id IS NULL OR char_length(api_client_id) BETWEEN 1 AND 200),
  api_client_secret_enc       text CHECK (api_client_secret_enc IS NULL OR (api_client_secret_enc ~ '^v[0-9]+:' AND char_length(api_client_secret_enc) <= 2000)),
  api_client_cert             text CHECK (api_client_cert IS NULL OR (char_length(api_client_cert) <= 20000 AND api_client_cert LIKE '-----BEGIN CERTIFICATE-----%')),
  api_client_key_enc          text CHECK (api_client_key_enc IS NULL OR (api_client_key_enc ~ '^v[0-9]+:' AND char_length(api_client_key_enc) <= 20000)),
  api_extra                   jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(api_extra) = 'object' AND pg_column_size(api_extra) <= 4000),  -- e.g. Wells Fargo gateway entity ID

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.center_ach_settings_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id  uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN ('saved', 'secrets_read', 'tested', 'test_failed', 'sent', 'send_failed')),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  summary    text CHECK (summary IS NULL OR char_length(summary) <= 500)
);
CREATE INDEX IF NOT EXISTS center_ach_settings_events_center_idx ON public.center_ach_settings_events (center_id, at DESC);

-- RLS: owner and admins read everything but the secrets; nobody writes directly
ALTER TABLE public.center_ach_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.center_ach_settings_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.center_ach_settings, public.center_ach_settings_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.center_ach_settings, public.center_ach_settings_events TO service_role;
GRANT SELECT (center_id, bank, bank_label, send_method, company_id, company_name, entry_description, immediate_destination,
  immediate_destination_name, immediate_origin, balanced, line_ending, file_name_pattern, sftp_host, sftp_port, sftp_username,
  sftp_auth, sftp_remote_dir, sftp_host_fingerprint, pgp_public_key, api_environment, api_base_url, api_client_id,
  api_client_cert, api_extra, created_at, updated_at, updated_by) ON public.center_ach_settings TO authenticated;
GRANT SELECT ON public.center_ach_settings_events TO authenticated;
DROP POLICY IF EXISTS "Owners and admins read center_ach_settings" ON public.center_ach_settings;
CREATE POLICY "Owners and admins read center_ach_settings" ON public.center_ach_settings
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
DROP POLICY IF EXISTS "Owners and admins read center_ach_settings_events" ON public.center_ach_settings_events;
CREATE POLICY "Owners and admins read center_ach_settings_events" ON public.center_ach_settings_events
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));

-- The settings without secrets (and which secrets are set), as jsonb
CREATE OR REPLACE FUNCTION public.center_ach_settings_public(s public.center_ach_settings)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT to_jsonb(s) - 'sftp_secret_enc' - 'sftp_passphrase_enc' - 'api_client_secret_enc' - 'api_client_key_enc' - 'updated_by'
    || jsonb_build_object(
      'has_sftp_secret', s.sftp_secret_enc IS NOT NULL, 'has_sftp_passphrase', s.sftp_passphrase_enc IS NOT NULL,
      'has_api_client_secret', s.api_client_secret_enc IS NOT NULL, 'has_api_client_key', s.api_client_key_enc IS NOT NULL,
      'updated_by', public.center_bank_who(s.updated_by));
$$;
REVOKE ALL ON FUNCTION public.center_ach_settings_public(public.center_ach_settings) FROM PUBLIC, anon, authenticated;

-- { is_owner, settings: {...without secrets} | null, events: [last 25] }
CREATE OR REPLACE FUNCTION public.center_ach_settings_get(p_center_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s center_ach_settings%ROWTYPE;
BEGIN
  IF NOT public.can_view_confidential(p_center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner and administrators can see its ACH settings' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_s FROM center_ach_settings WHERE center_id = p_center_id;
  RETURN jsonb_build_object(
    'is_owner', public.center_bank_is_owner(p_center_id),
    'settings', CASE WHEN v_s.center_id IS NULL THEN NULL ELSE public.center_ach_settings_public(v_s) END,
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('action', e.action, 'at', e.at, 'who', public.center_bank_who(e.user_id), 'summary', e.summary) ORDER BY e.at DESC)
                FROM (SELECT * FROM center_ach_settings_events WHERE center_id = p_center_id ORDER BY at DESC LIMIT 25) e), '[]'));
END $$;

-- Owner: save the settings. p holds every non-secret field (they replace what's there). Secrets: a "<name>_enc" key
-- with an encrypted value sets it, a name in p.clear (array) removes it, anything else keeps it.
-- Secret names: sftp_secret, sftp_passphrase, api_client_secret, api_client_key.
CREATE OR REPLACE FUNCTION public.center_ach_settings_save(p_center_id uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old center_ach_settings%ROWTYPE; v_new center_ach_settings%ROWTYPE; v_changed text[] := '{}'; v_f text;
  v_clear text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p -> 'clear', '[]')));
  v_labels jsonb := '{"bank":"bank","bank_label":"bank name","send_method":"send method","company_id":"Company ID",
    "company_name":"company name","entry_description":"entry description","immediate_destination":"immediate destination",
    "immediate_destination_name":"destination name","immediate_origin":"immediate origin","balanced":"balanced file",
    "line_ending":"line endings","file_name_pattern":"file name","sftp_host":"SFTP host","sftp_port":"SFTP port",
    "sftp_username":"SFTP username","sftp_auth":"SFTP sign-in type","sftp_secret_enc":"SFTP password or key",
    "sftp_passphrase_enc":"key passphrase","sftp_remote_dir":"SFTP folder","sftp_host_fingerprint":"host fingerprint",
    "pgp_public_key":"bank PGP key","api_environment":"API environment","api_base_url":"API URL","api_client_id":"API client ID",
    "api_client_secret_enc":"API client secret","api_client_cert":"API certificate","api_client_key_enc":"API private key",
    "api_extra":"API extra fields"}';
  t text := '';
BEGIN
  IF NOT public.center_bank_is_owner(p_center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner can change the ACH bank settings' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Bad settings' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_clear) c WHERE c NOT IN ('sftp_secret', 'sftp_passphrase', 'api_client_secret', 'api_client_key')) THEN
    RAISE EXCEPTION 'Bad settings' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM center_ach_settings WHERE center_id = p_center_id FOR UPDATE;
  v_new.center_id := p_center_id;
  v_new.bank := COALESCE(NULLIF(p ->> 'bank', ''), 'other');
  v_new.bank_label := NULLIF(btrim(COALESCE(p ->> 'bank_label', t)), '');
  v_new.send_method := COALESCE(NULLIF(p ->> 'send_method', ''), 'manual');
  v_new.company_id := NULLIF(upper(btrim(COALESCE(p ->> 'company_id', t))), '');
  v_new.company_name := NULLIF(btrim(COALESCE(p ->> 'company_name', t)), '');
  v_new.entry_description := NULLIF(btrim(COALESCE(p ->> 'entry_description', t)), '');
  v_new.immediate_destination := NULLIF(btrim(COALESCE(p ->> 'immediate_destination', t)), '');
  v_new.immediate_destination_name := NULLIF(btrim(COALESCE(p ->> 'immediate_destination_name', t)), '');
  v_new.immediate_origin := NULLIF(upper(btrim(COALESCE(p ->> 'immediate_origin', t))), '');
  v_new.balanced := COALESCE((p ->> 'balanced')::boolean, false);
  v_new.line_ending := COALESCE(NULLIF(p ->> 'line_ending', ''), 'lf');
  v_new.file_name_pattern := NULLIF(btrim(COALESCE(p ->> 'file_name_pattern', t)), '');
  v_new.sftp_host := NULLIF(lower(btrim(COALESCE(p ->> 'sftp_host', t))), '');
  v_new.sftp_port := COALESCE(NULLIF(p ->> 'sftp_port', '')::integer, 22);
  v_new.sftp_username := NULLIF(btrim(COALESCE(p ->> 'sftp_username', t)), '');
  v_new.sftp_auth := COALESCE(NULLIF(p ->> 'sftp_auth', ''), 'key');
  v_new.sftp_remote_dir := NULLIF(btrim(COALESCE(p ->> 'sftp_remote_dir', t)), '');
  v_new.sftp_host_fingerprint := NULLIF(btrim(COALESCE(p ->> 'sftp_host_fingerprint', t)), '');
  v_new.pgp_public_key := NULLIF(btrim(COALESCE(p ->> 'pgp_public_key', t)), '');
  v_new.api_environment := COALESCE(NULLIF(p ->> 'api_environment', ''), 'sandbox');
  v_new.api_base_url := NULLIF(btrim(COALESCE(p ->> 'api_base_url', t)), '');
  v_new.api_client_id := NULLIF(btrim(COALESCE(p ->> 'api_client_id', t)), '');
  v_new.api_client_cert := NULLIF(btrim(COALESCE(p ->> 'api_client_cert', t)), '');
  v_new.api_extra := COALESCE(p -> 'api_extra', '{}');

  -- Secrets: new value, cleared, or kept
  v_new.sftp_secret_enc := CASE WHEN p ? 'sftp_secret_enc' THEN p ->> 'sftp_secret_enc' WHEN 'sftp_secret' = ANY (v_clear) THEN NULL ELSE v_old.sftp_secret_enc END;
  v_new.sftp_passphrase_enc := CASE WHEN p ? 'sftp_passphrase_enc' THEN p ->> 'sftp_passphrase_enc' WHEN 'sftp_passphrase' = ANY (v_clear) THEN NULL ELSE v_old.sftp_passphrase_enc END;
  v_new.api_client_secret_enc := CASE WHEN p ? 'api_client_secret_enc' THEN p ->> 'api_client_secret_enc' WHEN 'api_client_secret' = ANY (v_clear) THEN NULL ELSE v_old.api_client_secret_enc END;
  v_new.api_client_key_enc := CASE WHEN p ? 'api_client_key_enc' THEN p ->> 'api_client_key_enc' WHEN 'api_client_key' = ANY (v_clear) THEN NULL ELSE v_old.api_client_key_enc END;

  IF v_new.bank = 'other' AND v_new.bank_label IS NULL THEN RAISE EXCEPTION 'Enter the bank''s name' USING ERRCODE = '22023'; END IF;
  IF v_new.send_method = 'sftp' AND (v_new.sftp_host IS NULL OR v_new.sftp_username IS NULL OR v_new.sftp_secret_enc IS NULL OR v_new.sftp_host_fingerprint IS NULL) THEN
    RAISE EXCEPTION 'To send by SFTP, enter the host, username, password or private key, and the server''s host key fingerprint from your bank' USING ERRCODE = '22023';
  END IF;

  v_new.created_at := COALESCE(v_old.created_at, now());
  v_new.updated_at := now();
  v_new.updated_by := auth.uid();

  -- Which fields changed (names only, never values)
  FOR v_f IN SELECT jsonb_object_keys(v_labels) LOOP
    IF (to_jsonb(v_old) -> v_f) IS DISTINCT FROM (to_jsonb(v_new) -> v_f) THEN v_changed := v_changed || (v_labels ->> v_f); END IF;
  END LOOP;

  INSERT INTO center_ach_settings SELECT v_new.*
  ON CONFLICT (center_id) DO UPDATE SET
    bank = EXCLUDED.bank, bank_label = EXCLUDED.bank_label, send_method = EXCLUDED.send_method, company_id = EXCLUDED.company_id,
    company_name = EXCLUDED.company_name, entry_description = EXCLUDED.entry_description, immediate_destination = EXCLUDED.immediate_destination,
    immediate_destination_name = EXCLUDED.immediate_destination_name, immediate_origin = EXCLUDED.immediate_origin, balanced = EXCLUDED.balanced,
    line_ending = EXCLUDED.line_ending, file_name_pattern = EXCLUDED.file_name_pattern, sftp_host = EXCLUDED.sftp_host, sftp_port = EXCLUDED.sftp_port,
    sftp_username = EXCLUDED.sftp_username, sftp_auth = EXCLUDED.sftp_auth, sftp_secret_enc = EXCLUDED.sftp_secret_enc,
    sftp_passphrase_enc = EXCLUDED.sftp_passphrase_enc, sftp_remote_dir = EXCLUDED.sftp_remote_dir, sftp_host_fingerprint = EXCLUDED.sftp_host_fingerprint,
    pgp_public_key = EXCLUDED.pgp_public_key, api_environment = EXCLUDED.api_environment, api_base_url = EXCLUDED.api_base_url,
    api_client_id = EXCLUDED.api_client_id, api_client_secret_enc = EXCLUDED.api_client_secret_enc, api_client_cert = EXCLUDED.api_client_cert,
    api_client_key_enc = EXCLUDED.api_client_key_enc, api_extra = EXCLUDED.api_extra, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;

  IF array_length(v_changed, 1) > 0 OR v_old.center_id IS NULL THEN
    INSERT INTO center_ach_settings_events (center_id, action, user_id, summary)
    VALUES (p_center_id, 'saved', auth.uid(), left(CASE WHEN v_old.center_id IS NULL THEN 'Set up' ELSE 'Changed' END
      || COALESCE(': ' || NULLIF(array_to_string(v_changed, ', '), ''), ''), 500));
  END IF;
  SELECT * INTO v_new FROM center_ach_settings WHERE center_id = p_center_id;
  RETURN public.center_ach_settings_public(v_new);
END $$;

-- Owner: everything, with the encrypted secrets, for the server to test the connection or send a file. Logged.
CREATE OR REPLACE FUNCTION public.center_ach_settings_secrets(p_center_id uuid, p_purpose text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s center_ach_settings%ROWTYPE;
BEGIN
  IF NOT public.center_bank_is_owner(p_center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner can connect to the bank' USING ERRCODE = '42501';
  END IF;
  IF p_purpose NOT IN ('test', 'send') THEN RAISE EXCEPTION 'Bad request' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_s FROM center_ach_settings WHERE center_id = p_center_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Set up the ACH bank settings first (About → Center Profile → ACH bank settings)' USING ERRCODE = '22023'; END IF;
  INSERT INTO center_ach_settings_events (center_id, action, user_id, summary)
  VALUES (p_center_id, 'secrets_read', auth.uid(), CASE p_purpose WHEN 'test' THEN 'Connection test' ELSE 'Sending an ACH file' END);
  RETURN to_jsonb(v_s);
END $$;

-- Owner: record a connection test or a file sent (the server calls this after it talks to the bank)
CREATE OR REPLACE FUNCTION public.center_ach_settings_log(p_center_id uuid, p_action text, p_summary text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.center_bank_is_owner(p_center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner can connect to the bank' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('tested', 'test_failed', 'sent', 'send_failed') THEN RAISE EXCEPTION 'Bad request' USING ERRCODE = '22023'; END IF;
  INSERT INTO center_ach_settings_events (center_id, action, user_id, summary)
  VALUES (p_center_id, p_action, auth.uid(), left(NULLIF(btrim(COALESCE(p_summary, '')), ''), 500));
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['center_ach_settings_get(uuid)', 'center_ach_settings_save(uuid, jsonb)',
    'center_ach_settings_secrets(uuid, text)', 'center_ach_settings_log(uuid, text, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- ============================================================
-- Sending a batch's file by SFTP. A file the bank receives twice drafts every family twice, so a send first claims
-- the batch (one sender at a time; a claim older than 10 minutes counts as abandoned). After the upload the server
-- records the file name and marks the batch sent, or releases the claim if the upload failed.
-- ============================================================
ALTER TABLE public.billing_ach_batches ADD COLUMN IF NOT EXISTS sftp_claimed_at timestamptz;
ALTER TABLE public.billing_ach_batches ADD COLUMN IF NOT EXISTS sftp_file_name text CHECK (sftp_file_name IS NULL OR char_length(sftp_file_name) <= 200);

-- Owner: claim the batch for sending. Returns the center id. Fails if it was already sent or another send is running.
CREATE OR REPLACE FUNCTION public.billing_ach_sftp_claim(p_batch_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_b billing_ach_batches%ROWTYPE;
BEGIN
  SELECT * INTO v_b FROM billing_ach_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACH batch not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_b.center_id);
  IF NOT public.tuition_is_owner(v_b.center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner can send the ACH file' USING ERRCODE = '42501';
  END IF;
  IF v_b.status NOT IN ('scheduled', 'exported') OR v_b.sftp_file_name IS NOT NULL THEN
    RAISE EXCEPTION 'This batch was already sent to the bank' USING ERRCODE = '22023';
  END IF;
  IF v_b.sftp_claimed_at IS NOT NULL AND v_b.sftp_claimed_at > now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'This file is being sent right now. Wait a minute, then reload the page' USING ERRCODE = '22023';
  END IF;
  UPDATE billing_ach_batches SET sftp_claimed_at = now() WHERE id = p_batch_id;
  RETURN v_b.center_id;
END $$;

-- Owner: after the upload. p_file_name set = delivered (the batch is marked sent); NULL = failed (claim released).
CREATE OR REPLACE FUNCTION public.billing_ach_sftp_done(p_batch_id uuid, p_file_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_b billing_ach_batches%ROWTYPE;
BEGIN
  SELECT * INTO v_b FROM billing_ach_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACH batch not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.tuition_is_owner(v_b.center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner can send the ACH file' USING ERRCODE = '42501';
  END IF;
  IF v_b.sftp_claimed_at IS NULL THEN RAISE EXCEPTION 'This batch is not being sent' USING ERRCODE = '22023'; END IF;
  IF NULLIF(btrim(COALESCE(p_file_name, '')), '') IS NULL THEN
    UPDATE billing_ach_batches SET sftp_claimed_at = NULL WHERE id = p_batch_id;
    RETURN;
  END IF;
  UPDATE billing_ach_batches SET sftp_file_name = left(btrim(p_file_name), 200) WHERE id = p_batch_id;
  PERFORM public.billing_ach_batch_mark(p_batch_id, 'sent');
END $$;

REVOKE ALL ON FUNCTION public.billing_ach_sftp_claim(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_ach_sftp_done(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_ach_sftp_claim(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_ach_sftp_done(uuid, text) TO authenticated, service_role;

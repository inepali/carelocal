-- ============================================================
-- Center bank account: where the center's money lands (ACH tuition deposits, later through a processor such as Moov)
--
--  - About → Center Profile → Bank account. One active account per center; replaced and removed accounts stay as
--    history, so it's always clear where deposits were meant to go on a given day.
--  - Changing where money goes is the classic payment-fraud move, so only the center's OWNER adds, replaces or removes
--    the account, and only the owner sees the full account number. Admins (directors) see it masked.
--  - The account number arrives already encrypted by the server (AES-256-GCM, key TUITION_BANK_KEY, never in the
--    database; see src/lib/server/bank-account.ts). The app can't read the encrypted column. center_bank_reveal()
--    hands it to the server for the owner and logs the look.
--  - center_bank_account_events records every add, replace, removal and view (who and when).
--  - Nobody writes these tables directly; the functions below do, for the owner.
-- Needs: 20270109000000_tuition_fees.sql (tuition_aba_ok), can_view_confidential(), centers, center_admins.
-- Rollback: supabase/rollbacks/20270110000000_center_bank_account.down.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.center_bank_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id            uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  account_holder_name  text NOT NULL CHECK (char_length(btrim(account_holder_name)) BETWEEN 1 AND 120),  -- legal name on the account
  account_holder_type  text NOT NULL DEFAULT 'business' CHECK (account_holder_type IN ('business', 'individual')),
  bank_name            text NOT NULL CHECK (char_length(btrim(bank_name)) BETWEEN 1 AND 80),
  account_type         text NOT NULL CHECK (account_type IN ('checking', 'savings')),
  routing_number       text NOT NULL CHECK (public.tuition_aba_ok(routing_number)),
  account_number_enc   text NOT NULL CHECK (account_number_enc ~ '^v[0-9]+:' AND char_length(account_number_enc) <= 400),
  last4                text NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replaced', 'removed')),
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  ended_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_at             timestamptz,
  end_note             text CHECK (end_note IS NULL OR char_length(end_note) <= 300),
  CONSTRAINT center_bank_accounts_ended CHECK ((status = 'active') = (ended_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS center_bank_accounts_one_active ON public.center_bank_accounts (center_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS center_bank_accounts_center_idx ON public.center_bank_accounts (center_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.center_bank_account_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id        uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  bank_account_id  uuid REFERENCES public.center_bank_accounts(id) ON DELETE SET NULL,
  action           text NOT NULL CHECK (action IN ('added', 'replaced', 'removed', 'viewed')),
  user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  at               timestamptz NOT NULL DEFAULT now(),
  summary          text CHECK (summary IS NULL OR char_length(summary) <= 300)
);
CREATE INDEX IF NOT EXISTS center_bank_account_events_center_idx ON public.center_bank_account_events (center_id, at DESC);

-- RLS: owner and admins read (the account number only masked); nobody writes directly
ALTER TABLE public.center_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.center_bank_account_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.center_bank_accounts, public.center_bank_account_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.center_bank_accounts, public.center_bank_account_events TO service_role;
GRANT SELECT (id, center_id, account_holder_name, account_holder_type, bank_name, account_type, routing_number, last4, status,
  created_by, created_at, ended_by, ended_at, end_note) ON public.center_bank_accounts TO authenticated;
GRANT SELECT ON public.center_bank_account_events TO authenticated;
DROP POLICY IF EXISTS "Owners and admins read center_bank_accounts" ON public.center_bank_accounts;
CREATE POLICY "Owners and admins read center_bank_accounts" ON public.center_bank_accounts
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));
DROP POLICY IF EXISTS "Owners and admins read center_bank_account_events" ON public.center_bank_account_events;
CREATE POLICY "Owners and admins read center_bank_account_events" ON public.center_bank_account_events
  FOR SELECT TO authenticated USING (public.can_view_confidential(center_id));

-- The center's owner (one of possibly several co-owners)
CREATE OR REPLACE FUNCTION public.center_bank_is_owner(p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role = 'owner');
$$;
REVOKE ALL ON FUNCTION public.center_bank_is_owner(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.center_bank_who(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT email FROM auth.users WHERE id = p_user), 'someone')
$$;
REVOKE ALL ON FUNCTION public.center_bank_who(uuid) FROM PUBLIC, anon, authenticated;

-- { is_owner, current: {...masked} | null, history: [...], events: [last 25] }
CREATE OR REPLACE FUNCTION public.center_bank_get(p_center_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_confidential(p_center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner and administrators can see its bank account' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'is_owner', public.center_bank_is_owner(p_center_id),
    'current', (SELECT jsonb_build_object('id', a.id, 'account_holder_name', a.account_holder_name, 'account_holder_type', a.account_holder_type,
                  'bank_name', a.bank_name, 'account_type', a.account_type, 'routing_number', a.routing_number, 'last4', a.last4,
                  'created_at', a.created_at, 'created_by', public.center_bank_who(a.created_by))
                FROM center_bank_accounts a WHERE a.center_id = p_center_id AND a.status = 'active'),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'account_holder_name', a.account_holder_name, 'bank_name', a.bank_name,
                  'account_type', a.account_type, 'routing_number', a.routing_number, 'last4', a.last4, 'status', a.status,
                  'created_at', a.created_at, 'ended_at', a.ended_at, 'end_note', a.end_note) ORDER BY a.created_at DESC)
                FROM center_bank_accounts a WHERE a.center_id = p_center_id AND a.status <> 'active'), '[]'),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('action', e.action, 'at', e.at, 'who', public.center_bank_who(e.user_id), 'summary', e.summary) ORDER BY e.at DESC)
                FROM (SELECT * FROM center_bank_account_events WHERE center_id = p_center_id ORDER BY at DESC LIMIT 25) e), '[]')
  );
END $$;

-- Owner: add the account, or replace the active one (it becomes history). p: {account_holder_name, account_holder_type,
-- bank_name, account_type, routing_number, account_number_enc, last4, note}. The number is encrypted by the server.
CREATE OR REPLACE FUNCTION public.center_bank_save(p_center_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old center_bank_accounts%ROWTYPE; v_id uuid; v_routing text := btrim(COALESCE(p ->> 'routing_number', ''));
BEGIN
  IF NOT public.center_bank_is_owner(p_center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner can change where payments are deposited' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p ->> 'account_holder_name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Enter the name on the account' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p ->> 'bank_name', '')), '') IS NULL THEN RAISE EXCEPTION 'Enter the bank name' USING ERRCODE = '22023'; END IF;
  IF COALESCE(p ->> 'account_type', '') NOT IN ('checking', 'savings') THEN RAISE EXCEPTION 'Pick checking or savings' USING ERRCODE = '22023'; END IF;
  IF NOT public.tuition_aba_ok(v_routing) THEN
    RAISE EXCEPTION 'That routing number isn''t valid. It is the 9 digits at the bottom left of a check' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p ->> 'account_number_enc', '') !~ '^v[0-9]+:' OR COALESCE(p ->> 'last4', '') !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'The account number was not saved securely. Try again' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM center_bank_accounts WHERE center_id = p_center_id AND status = 'active' FOR UPDATE;
  IF FOUND THEN
    UPDATE center_bank_accounts SET status = 'replaced', ended_at = now(), ended_by = auth.uid(),
      end_note = NULLIF(btrim(COALESCE(p ->> 'note', '')), '')
    WHERE id = v_old.id;
  END IF;
  INSERT INTO center_bank_accounts (center_id, account_holder_name, account_holder_type, bank_name, account_type, routing_number,
    account_number_enc, last4, created_by)
  VALUES (p_center_id, btrim(p ->> 'account_holder_name'), COALESCE(NULLIF(p ->> 'account_holder_type', ''), 'business'),
    btrim(p ->> 'bank_name'), p ->> 'account_type', v_routing, p ->> 'account_number_enc', p ->> 'last4', auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO center_bank_account_events (center_id, bank_account_id, action, user_id, summary)
  VALUES (p_center_id, v_id, CASE WHEN v_old.id IS NULL THEN 'added' ELSE 'replaced' END, auth.uid(),
    left(btrim(p ->> 'bank_name') || ' ····' || (p ->> 'last4')
      || CASE WHEN v_old.id IS NULL THEN '' ELSE ' (was ' || v_old.bank_name || ' ····' || v_old.last4 || ')' END
      || COALESCE(' · ' || NULLIF(btrim(COALESCE(p ->> 'note', '')), ''), ''), 300));
  RETURN v_id;
END $$;

-- Owner: remove the active account (kept as history)
CREATE OR REPLACE FUNCTION public.center_bank_remove(p_center_id uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old center_bank_accounts%ROWTYPE;
BEGIN
  IF NOT public.center_bank_is_owner(p_center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner can change where payments are deposited' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_old FROM center_bank_accounts WHERE center_id = p_center_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'There is no bank account on file' USING ERRCODE = 'P0002'; END IF;
  UPDATE center_bank_accounts SET status = 'removed', ended_at = now(), ended_by = auth.uid(), end_note = NULLIF(btrim(COALESCE(p_note, '')), '')
  WHERE id = v_old.id;
  INSERT INTO center_bank_account_events (center_id, bank_account_id, action, user_id, summary)
  VALUES (p_center_id, v_old.id, 'removed', auth.uid(), left(v_old.bank_name || ' ····' || v_old.last4 || COALESCE(' · ' || NULLIF(btrim(COALESCE(p_note, '')), ''), ''), 300));
END $$;

-- Owner: the encrypted number of the active account, for the server to decrypt. Logged.
CREATE OR REPLACE FUNCTION public.center_bank_reveal(p_center_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a center_bank_accounts%ROWTYPE;
BEGIN
  IF NOT public.center_bank_is_owner(p_center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner can see the full account number' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_a FROM center_bank_accounts WHERE center_id = p_center_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'There is no bank account on file' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO center_bank_account_events (center_id, bank_account_id, action, user_id, summary)
  VALUES (p_center_id, v_a.id, 'viewed', auth.uid(), 'Full account number viewed (····' || v_a.last4 || ')');
  RETURN jsonb_build_object('account_number_enc', v_a.account_number_enc, 'routing_number', v_a.routing_number, 'last4', v_a.last4);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['center_bank_get(uuid)', 'center_bank_save(uuid, jsonb)', 'center_bank_remove(uuid, text)', 'center_bank_reveal(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

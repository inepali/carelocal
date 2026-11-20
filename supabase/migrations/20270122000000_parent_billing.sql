-- ============================================================
-- Parent page: Billing tab, and bill emails when the center submits billing
--
--  - centers.parent_billing_enabled (off by default): the center's owner turns on "Billing for families" on the
--    Billing page. Needs Tuition. The tab also needs the parent page; the emails don't.
--  - A parent sees only what they pay: the charges whose payer is one of their contact rows
--    (billing_charges.payer_guardian_id), their own payments and credit. On a split bill they see the child's bill
--    total and their own share, never another payer's name, method, bank or payments. Bank details: last 4 only.
--  - The tab is for the whole family (every child the PIN covers), including withdrawn children with a balance.
--  - Bill emails: when a run is submitted, billing_notices gets one row per person who pays (by email), filled at
--    commit so the run's charges exist. Voiding a run cancels unsent ones and adds a "bill canceled" email for each
--    person already told. The server claims rows (billing_notice_claim), sends with Resend and records the result
--    (billing_notice_result). Unsent rows are retried 10 minutes later, up to 3 tries.
--  - Every parent_billing_* / billing_notice_* function is service role only, like parent_portal_*.
-- Needs: 20261228000000_parent_portal.sql, 20270111000000_billing_runs.sql … 20270117000000_billing_payer_identity.sql
-- Rollback: supabase/rollbacks/20270122000000_parent_billing.down.sql
-- ============================================================

ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS parent_billing_enabled boolean NOT NULL DEFAULT false;

-- 1. The owner's switch -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.center_parent_billing_get(p_center_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.tuition_can_manage(p_center_id) THEN
    RAISE EXCEPTION 'Tuition is not turned on for your center, or you cannot change it' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT jsonb_build_object('enabled', c.parent_billing_enabled, 'is_owner', public.tuition_is_owner(c.id),
            'parent_page', COALESCE(c.parent_portal_enabled, false)) FROM centers c WHERE c.id = p_center_id);
END $$;

CREATE OR REPLACE FUNCTION public.center_parent_billing_set(p_center_id uuid, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.tuition_require(p_center_id);
  IF NOT public.tuition_is_owner(p_center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner can turn billing for families on or off' USING ERRCODE = '42501';
  END IF;
  UPDATE centers SET parent_billing_enabled = COALESCE(p_enabled, false) WHERE id = p_center_id;
END $$;

-- 2. Who the parent is, for billing --------------------------------------------------------------------------------
-- The contact rows this session's PIN covers, when billing for families is on (else empty)
CREATE OR REPLACE FUNCTION public.parent_billing_guardians(p_token_hash text)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_access uuid;
BEGIN
  v_access := public.parent_session_access(p_token_hash);
  IF v_access IS NULL THEN RETURN '{}'; END IF;
  IF NOT COALESCE((SELECT c.tuition_enabled AND c.parent_billing_enabled FROM parent_access a JOIN centers c ON c.id = a.center_id
                   WHERE a.id = v_access), false) THEN
    RETURN '{}';
  END IF;
  RETURN COALESCE((SELECT array_agg(g.id) FROM child_guardians g JOIN parent_access a ON a.id = g.parent_access_id
                   WHERE g.parent_access_id = v_access AND g.center_id = a.center_id), '{}');
END $$;

-- A child's first name as the parent page shows it
CREATE OR REPLACE FUNCTION public.parent_billing_child_name(p_child_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(btrim(preferred_name), ''), first_name) FROM children WHERE id = p_child_id
$$;

-- One of this parent's charges, as the parent may see it (no other payer, no full bank details)
CREATE OR REPLACE FUNCTION public.parent_billing_charge_json(c public.billing_charges)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'status', c.status, 'method', c.method, 'amount', c.amount, 'paid', c.paid_amount,
    'due', CASE WHEN c.status IN ('open', 'partial', 'returned') THEN GREATEST(c.amount - c.paid_amount, 0) ELSE 0 END,
    'account_type', c.account_type, 'last4', c.last4, 'return_code', c.ach_return_code,
    'draft_date', (SELECT ab.draft_date FROM billing_ach_batches ab WHERE ab.id = c.ach_batch_id),
    'sent_at', (SELECT ab.sent_at FROM billing_ach_batches ab WHERE ab.id = c.ach_batch_id),
    'settled_at', (SELECT ab.settled_at FROM billing_ach_batches ab WHERE ab.id = c.ach_batch_id))
$$;

-- 3. The Billing tab -------------------------------------------------------------------------------------------------
-- NULL = no Billing tab (off, signed out, or this parent pays nothing). Otherwise the summary:
-- { center, due, credit, ach_scheduled: [{date, amount, last4, account_type}], ach_sent, ytd, methods, payments }
CREATE OR REPLACE FUNCTION public.parent_billing_summary(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_g uuid[]; v_center uuid; v_today date; v_year int;
BEGIN
  v_g := public.parent_billing_guardians(p_token_hash);
  IF cardinality(v_g) = 0 THEN RETURN NULL; END IF;
  SELECT center_id INTO v_center FROM child_guardians WHERE id = v_g[1];
  IF NOT EXISTS (SELECT 1 FROM billing_charges WHERE payer_guardian_id = ANY (v_g))
     AND NOT EXISTS (SELECT 1 FROM child_payment_payers WHERE payer_guardian_id = ANY (v_g))
     AND NOT EXISTS (SELECT 1 FROM billing_receipts WHERE payer_guardian_id = ANY (v_g) AND NOT voided) THEN
    RETURN NULL;
  END IF;
  v_today := public.roster_today(v_center);
  v_year := extract(year FROM v_today)::int;

  RETURN jsonb_build_object(
    'center', (SELECT jsonb_build_object('name', c.name, 'phone', c.phone, 'email', NULLIF(btrim(c.email), ''), 'today', v_today)
               FROM centers c WHERE c.id = v_center),
    'due', COALESCE((SELECT sum(GREATEST(c.amount - c.paid_amount, 0)) FROM billing_charges c JOIN billing_bills b ON b.id = c.bill_id
                     WHERE c.payer_guardian_id = ANY (v_g) AND c.status IN ('open', 'partial', 'returned') AND NOT b.voided), 0),
    'credit', COALESCE((SELECT sum(public.billing_receipt_left(r.id)) FROM billing_receipts r
                        WHERE r.payer_guardian_id = ANY (v_g) AND NOT r.voided), 0),
    'ach_scheduled', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', x.draft_date, 'amount', x.amount, 'last4', x.last4, 'account_type', x.account_type)
                       ORDER BY x.draft_date, x.last4)
        FROM (SELECT ab.draft_date, c.last4, c.account_type, sum(c.amount - c.paid_amount) AS amount
                FROM billing_charges c JOIN billing_ach_batches ab ON ab.id = c.ach_batch_id
               WHERE c.payer_guardian_id = ANY (v_g) AND c.status = 'ach_scheduled'
               GROUP BY ab.draft_date, c.last4, c.account_type) x), '[]'),
    'ach_sent', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c
                          WHERE c.payer_guardian_id = ANY (v_g) AND c.status = 'ach_sent'), 0),
    'ytd', (SELECT jsonb_build_object('year', v_year,
                     'billed', COALESCE(sum(c.amount), 0),
                     'paid', COALESCE(sum(c.paid_amount), 0),
                     'due', COALESCE(sum(GREATEST(c.amount - c.paid_amount, 0)) FILTER (WHERE c.status IN ('open', 'partial', 'returned')), 0))
              FROM billing_charges c JOIN billing_bills b ON b.id = c.bill_id
             WHERE c.payer_guardian_id = ANY (v_g) AND c.status <> 'void' AND NOT b.voided
               AND extract(year FROM b.period_start) = v_year),
    -- How they pay today, per child
    'methods', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'child', public.parent_billing_child_name(pp.child_id), 'method', pp.method, 'bank_name', pp.bank_name,
               'account_type', pp.account_type, 'last4', pp.last4, 'card_brand', pp.card_brand,
               'share_type', pp.share_type, 'share_value', pp.share_value, 'fixed_frequency', pp.fixed_frequency,
               'authorization_signed_on', pp.authorization_signed_on,
               'ach_ready', pp.method = 'ach' AND pp.routing_number IS NOT NULL AND pp.account_number_enc IS NOT NULL AND pp.authorization_on_file)
             ORDER BY public.parent_billing_child_name(pp.child_id), pp.sort_order)
        FROM child_payment_payers pp JOIN children ch ON ch.id = pp.child_id
       WHERE pp.payer_guardian_id = ANY (v_g) AND ch.status = 'enrolled'
         AND pp.effective_from <= v_today AND (pp.effective_to IS NULL OR pp.effective_to >= v_today)), '[]'),
    -- Their payments in the last 12 months: money they paid at the center (or credit given), and ACH drafts
    'payments', COALESCE((
      SELECT jsonb_agg(p ORDER BY p ->> 'date' DESC, p ->> 'created_at' DESC) FROM (
        (SELECT jsonb_build_object('kind', 'receipt', 'date', r.received_on, 'created_at', r.created_at, 'method', r.method,
                  'card_brand', r.card_brand, 'last4', r.last4, 'amount', r.amount, 'credit_left', public.billing_receipt_left(r.id),
                  'child', public.parent_billing_child_name(r.child_id)) AS p
           FROM billing_receipts r
          WHERE r.payer_guardian_id = ANY (v_g) AND NOT r.voided AND r.received_on > v_today - 366
          ORDER BY r.received_on DESC LIMIT 60)
        UNION ALL
        (SELECT jsonb_build_object('kind', bp.kind, 'date', bp.received_on, 'created_at', bp.created_at, 'method', 'ach',
                  'last4', c.last4, 'account_type', c.account_type, 'amount', bp.amount, 'return_code', c.ach_return_code,
                  'child', public.parent_billing_child_name(bp.child_id)) AS p
           FROM billing_payments bp JOIN billing_charges c ON c.id = bp.charge_id
          WHERE c.payer_guardian_id = ANY (v_g) AND bp.kind IN ('ach', 'ach_return') AND NOT bp.voided AND bp.received_on > v_today - 366
          ORDER BY bp.received_on DESC LIMIT 60)
      ) all_p), '[]'));
END $$;

-- Their bills, newest first, 20 at a time (p_before = the oldest period_start shown so far).
-- [{bill_id, child, frequency, period_start, period_end, bill_total, share, paid, due, charges: [...]}]
CREATE OR REPLACE FUNCTION public.parent_billing_bills(p_token_hash text, p_before date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_g uuid[];
BEGIN
  v_g := public.parent_billing_guardians(p_token_hash);
  IF cardinality(v_g) = 0 THEN RETURN NULL; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x.j ORDER BY x.period_start DESC, x.child)
      FROM (SELECT b.period_start, public.parent_billing_child_name(b.child_id) AS child,
                   jsonb_build_object('bill_id', b.id, 'child', public.parent_billing_child_name(b.child_id), 'frequency', b.frequency,
                     'period_start', b.period_start, 'period_end', b.period_end, 'bill_total', b.total,
                     'share', sum(c.amount), 'paid', sum(c.paid_amount),
                     'due', sum(CASE WHEN c.status IN ('open', 'partial', 'returned') THEN GREATEST(c.amount - c.paid_amount, 0) ELSE 0 END),
                     'charges', jsonb_agg(public.parent_billing_charge_json(c) ORDER BY c.sort_order)) AS j
              FROM billing_bills b JOIN billing_charges c ON c.bill_id = b.id JOIN billing_runs r ON r.id = b.run_id
             WHERE c.payer_guardian_id = ANY (v_g) AND c.status <> 'void' AND NOT b.voided AND r.status = 'submitted'
               AND (p_before IS NULL OR b.period_start < p_before)
               AND b.period_start IN (
                 SELECT DISTINCT b2.period_start FROM billing_bills b2 JOIN billing_charges c2 ON c2.bill_id = b2.id
                  WHERE c2.payer_guardian_id = ANY (v_g) AND c2.status <> 'void' AND NOT b2.voided
                    AND (p_before IS NULL OR b2.period_start < p_before)
                  ORDER BY b2.period_start DESC LIMIT 20)
             GROUP BY b.id) x), '[]');
END $$;

-- One bill: its fee lines, and this parent's charges on it with what paid them. NULL if it isn't theirs.
CREATE OR REPLACE FUNCTION public.parent_billing_bill(p_token_hash text, p_bill_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_g uuid[]; v_b billing_bills%ROWTYPE;
BEGIN
  v_g := public.parent_billing_guardians(p_token_hash);
  IF cardinality(v_g) = 0 THEN RETURN NULL; END IF;
  SELECT b.* INTO v_b FROM billing_bills b JOIN billing_runs r ON r.id = b.run_id
   WHERE b.id = p_bill_id AND NOT b.voided AND r.status = 'submitted'
     AND EXISTS (SELECT 1 FROM billing_charges c WHERE c.bill_id = b.id AND c.payer_guardian_id = ANY (v_g) AND c.status <> 'void');
  IF v_b.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'bill_id', v_b.id, 'child', public.parent_billing_child_name(v_b.child_id), 'frequency', v_b.frequency,
    'period_start', v_b.period_start, 'period_end', v_b.period_end,
    'list_amount', v_b.list_amount, 'discount_amount', v_b.discount_amount, 'bill_total', v_b.total,
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('fee', l.fee_name, 'frequency', l.frequency, 'list', l.list_amount,
                         'discount', l.discount_amount, 'net', l.net_amount, 'discount_label', l.discount_label) ORDER BY l.fee_period_start, l.fee_name)
                       FROM billing_bill_lines l WHERE l.bill_id = v_b.id AND NOT l.voided), '[]'),
    'charges', (SELECT jsonb_agg(public.parent_billing_charge_json(c) || jsonb_build_object(
                  'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', bp.received_on, 'kind', bp.kind, 'method', bp.method,
                                 'amount', bp.amount) ORDER BY bp.received_on, bp.created_at)
                                FROM billing_payments bp WHERE bp.charge_id = c.id AND NOT bp.voided), '[]')) ORDER BY c.sort_order)
                FROM billing_charges c WHERE c.bill_id = v_b.id AND c.payer_guardian_id = ANY (v_g) AND c.status <> 'void'));
END $$;

-- 4. Bill emails ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_notices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id        uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  run_id           uuid NOT NULL REFERENCES public.billing_runs(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('bill', 'void')),
  email            text NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254),
  name             text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'canceled')),
  attempts         integer NOT NULL DEFAULT 0,
  last_attempt_at  timestamptz,
  sent_at          timestamptz,
  provider_id      text,
  error            text CHECK (error IS NULL OR char_length(error) <= 500),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, kind, email)
);
CREATE INDEX IF NOT EXISTS billing_notices_due_idx ON public.billing_notices (status, last_attempt_at) WHERE status IN ('pending', 'sending', 'failed');
ALTER TABLE public.billing_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_notices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_notices TO service_role;
-- Owners and admins can see who was emailed about a run
GRANT SELECT ON public.billing_notices TO authenticated;
DROP POLICY IF EXISTS "Tuition managers read billing_notices" ON public.billing_notices;
CREATE POLICY "Tuition managers read billing_notices" ON public.billing_notices
  FOR SELECT TO authenticated USING (public.tuition_can_manage(center_id));

-- Filled at commit (a deferred trigger), so a run's charges exist when its people are listed
CREATE OR REPLACE FUNCTION public.billing_notices_fill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run billing_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM billing_runs WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' AND v_run.status = 'submitted' THEN
    IF NOT COALESCE((SELECT tuition_enabled AND parent_billing_enabled FROM centers WHERE id = v_run.center_id), false) THEN RETURN NULL; END IF;
    INSERT INTO billing_notices (center_id, run_id, kind, email, name)
    SELECT DISTINCT ON (lower(btrim(g.email))) v_run.center_id, v_run.id, 'bill', lower(btrim(g.email)), g.name
      FROM billing_charges c JOIN billing_bills b ON b.id = c.bill_id JOIN child_guardians g ON g.id = c.payer_guardian_id
     WHERE b.run_id = v_run.id AND c.status <> 'void' AND NOT b.voided
       AND btrim(COALESCE(g.email, '')) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' AND char_length(btrim(g.email)) <= 254
     ORDER BY lower(btrim(g.email)), g.is_primary DESC, g.created_at
    ON CONFLICT DO NOTHING;
  ELSIF TG_OP = 'UPDATE' AND v_run.status = 'void' AND OLD.status = 'submitted' THEN
    UPDATE billing_notices SET status = 'canceled' WHERE run_id = v_run.id AND kind = 'bill' AND status IN ('pending', 'failed');
    INSERT INTO billing_notices (center_id, run_id, kind, email, name)
    SELECT center_id, run_id, 'void', email, name FROM billing_notices WHERE run_id = v_run.id AND kind = 'bill' AND status IN ('sent', 'sending')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.billing_notices_fill() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_billing_notices_fill ON public.billing_runs;
CREATE CONSTRAINT TRIGGER trg_billing_notices_fill AFTER INSERT OR UPDATE OF status ON public.billing_runs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.billing_notices_fill();

-- What one email says, for the server to write it
CREATE OR REPLACE FUNCTION public.billing_notice_payload(p_notice_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n billing_notices%ROWTYPE; v_run billing_runs%ROWTYPE; v_c centers%ROWTYPE;
BEGIN
  SELECT * INTO v_n FROM billing_notices WHERE id = p_notice_id;
  SELECT * INTO v_run FROM billing_runs WHERE id = v_n.run_id;
  SELECT * INTO v_c FROM centers WHERE id = v_n.center_id;
  RETURN jsonb_build_object(
    'notice_id', v_n.id, 'kind', v_n.kind, 'email', v_n.email, 'name', v_n.name, 'attempts', v_n.attempts,
    'center', jsonb_build_object('name', v_c.name, 'email', NULLIF(btrim(v_c.email), ''), 'phone', v_c.phone, 'domain_key', v_c.domain_key,
                'portal_key', CASE WHEN COALESCE(v_c.parent_portal_enabled, false) THEN v_c.parent_portal_key END),
    'has_pin', EXISTS (SELECT 1 FROM child_guardians g WHERE g.center_id = v_n.center_id AND lower(btrim(g.email)) = v_n.email AND g.parent_access_id IS NOT NULL),
    'run', jsonb_build_object('frequency', v_run.frequency, 'period_start', v_run.period_start, 'period_end', v_run.period_end,
             'draft_date', v_run.draft_date),
    'lines', CASE WHEN v_n.kind = 'void' THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('child', public.parent_billing_child_name(b.child_id), 'bill_total', b.total,
               'share', x.share, 'ach', x.ach, 'due', x.due, 'paid', x.paid, 'last4', x.last4, 'account_type', x.account_type, 'draft_date', x.draft_date)
             ORDER BY public.parent_billing_child_name(b.child_id))
        FROM (SELECT c.bill_id, sum(c.amount) AS share,
                     COALESCE(sum(c.amount - c.paid_amount) FILTER (WHERE c.status = 'ach_scheduled'), 0) AS ach,
                     COALESCE(sum(GREATEST(c.amount - c.paid_amount, 0)) FILTER (WHERE c.status IN ('open', 'partial')), 0) AS due,
                     sum(c.paid_amount) AS paid,
                     max(c.last4) FILTER (WHERE c.status = 'ach_scheduled') AS last4,
                     max(c.account_type) FILTER (WHERE c.status = 'ach_scheduled') AS account_type,
                     max(ab.draft_date) AS draft_date
                FROM billing_charges c JOIN child_guardians g ON g.id = c.payer_guardian_id
                LEFT JOIN billing_ach_batches ab ON ab.id = c.ach_batch_id
               WHERE c.run_id = v_n.run_id AND c.status <> 'void' AND lower(btrim(g.email)) = v_n.email
               GROUP BY c.bill_id) x
        JOIN billing_bills b ON b.id = x.bill_id AND NOT b.voided), '[]') END);
END $$;

-- Claim emails to send now: a run's new ones (right after Submit / Void), or every one that is due a retry.
-- Each claimed row is marked sending with one more attempt. Rows of a center that turned billing for families off
-- (or of a bill that has nothing left to tell) are canceled instead.
CREATE OR REPLACE FUNCTION public.billing_notice_claim(p_run_id uuid, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n billing_notices%ROWTYPE; v_out jsonb := '[]'; v_p jsonb;
BEGIN
  FOR v_n IN
    SELECT * FROM billing_notices n
     WHERE (p_run_id IS NULL OR n.run_id = p_run_id) AND n.attempts < 3
       AND (n.status = 'pending' OR (p_run_id IS NULL AND n.status IN ('failed', 'sending') AND n.last_attempt_at < now() - interval '10 minutes'))
     ORDER BY n.created_at LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
     FOR UPDATE SKIP LOCKED
  LOOP
    IF NOT COALESCE((SELECT tuition_enabled AND parent_billing_enabled FROM centers WHERE id = v_n.center_id), false)
       OR (v_n.kind = 'bill' AND (SELECT status FROM billing_runs WHERE id = v_n.run_id) <> 'submitted') THEN
      UPDATE billing_notices SET status = 'canceled' WHERE id = v_n.id;
      CONTINUE;
    END IF;
    UPDATE billing_notices SET status = 'sending', attempts = attempts + 1, last_attempt_at = now() WHERE id = v_n.id;
    v_p := public.billing_notice_payload(v_n.id);
    IF v_n.kind = 'bill' AND jsonb_array_length(v_p -> 'lines') = 0 THEN
      UPDATE billing_notices SET status = 'canceled', error = 'Nothing billed to this person anymore' WHERE id = v_n.id;
      CONTINUE;
    END IF;
    v_out := v_out || v_p;
  END LOOP;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.billing_notice_result(p_notice_id uuid, p_ok boolean, p_provider_id text, p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE billing_notices
     SET status = CASE WHEN p_ok THEN 'sent' ELSE 'failed' END,
         sent_at = CASE WHEN p_ok THEN now() END,
         provider_id = CASE WHEN p_ok THEN left(p_provider_id, 200) END,
         error = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_error, 'Not sent'), 500) END
   WHERE id = p_notice_id AND status = 'sending';
$$;

-- 5. Grants ----------------------------------------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  -- Service role only (the parent page and the email sender run on the server)
  FOREACH f IN ARRAY ARRAY['parent_billing_guardians(text)', 'parent_billing_child_name(uuid)', 'parent_billing_charge_json(public.billing_charges)',
    'parent_billing_summary(text)', 'parent_billing_bills(text, date)', 'parent_billing_bill(text, uuid)',
    'billing_notice_payload(uuid)', 'billing_notice_claim(uuid, integer)', 'billing_notice_result(uuid, boolean, text, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- Center owners and admins
  FOREACH f IN ARRAY ARRAY['center_parent_billing_get(uuid)', 'center_parent_billing_set(uuid, boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

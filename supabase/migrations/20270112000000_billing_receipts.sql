-- ============================================================
-- Take payments on a child's file (Fee & Payment → Payment card): a payer pays any amount at the center, by card,
-- check, cash or other. The amount pays the payer's oldest open charges first; a partial amount leaves the rest due;
-- anything over what's due is kept as that payer's credit and used automatically by the next billing run.
--
--  - A payment received is a row in billing_receipts. How it was used is in billing_payments (receipt_id): kind
--    'payment' when it paid a charge right away, kind 'credit' when its leftover paid a later charge.
--    Credit left on a receipt = its amount − what it paid (not voided). A payer's credit = the sum over their receipts.
--  - Credit and payments belong to the payer who paid (split payers stay separate: Mom's credit never pays the subsidy).
--  - Card payments are recorded only for now: the center runs the card on its own terminal and enters the amount,
--    card type and last 4. billing_receipts.processor / processor_ref are where a card processor (TBD) plugs in later.
--    Full card numbers are never stored (PCI).
--  - A billing run uses a payer's credit as each new charge is created (trigger on billing_charges). A queued ACH draft
--    is then drafted only for what credit didn't cover, or taken out of the batch if credit covers it all.
--  - Voiding a payment (owner or admin, with a reason) undoes everything it paid; those charges are due again.
--    Voiding a billing run gives back the credit it used.
-- Needs: 20270111000000_billing_runs.sql
-- Rollback: supabase/rollbacks/20270112000000_billing_receipts.down.sql
-- ============================================================

-- 1. Tables ----------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.billing_receipts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id      uuid NOT NULL,
  child_id       uuid NOT NULL,
  payer_id       uuid NOT NULL REFERENCES public.child_payment_payers(id) ON DELETE CASCADE,
  payer_name     text NOT NULL,
  amount         numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 100000),
  method         text NOT NULL CHECK (method IN ('credit_card', 'debit_card', 'check', 'cash', 'other')),
  card_brand     text CHECK (card_brand IS NULL OR char_length(card_brand) <= 20),
  last4          text CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
  reference      text CHECK (reference IS NULL OR char_length(reference) <= 60),   -- check number, terminal receipt / auth code
  processor      text NOT NULL DEFAULT 'manual' CHECK (processor IN ('manual')),     -- card processor goes here later
  processor_ref  text CHECK (processor_ref IS NULL OR char_length(processor_ref) <= 120),
  received_on    date NOT NULL,
  note           text CHECK (note IS NULL OR char_length(note) <= 300),
  voided         boolean NOT NULL DEFAULT false,
  void_reason    text CHECK (void_reason IS NULL OR char_length(void_reason) <= 300),
  voided_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at      timestamptz,
  recorded_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, center_id),
  FOREIGN KEY (child_id, center_id) REFERENCES public.children (id, center_id) ON DELETE CASCADE,
  CONSTRAINT billing_receipts_card CHECK (method IN ('credit_card', 'debit_card') OR (card_brand IS NULL AND last4 IS NULL))
);
CREATE INDEX IF NOT EXISTS billing_receipts_payer_idx ON public.billing_receipts (payer_id, received_on, created_at) WHERE NOT voided;
CREATE INDEX IF NOT EXISTS billing_receipts_child_idx ON public.billing_receipts (child_id, created_at DESC);

ALTER TABLE public.billing_payments ADD COLUMN IF NOT EXISTS receipt_id uuid REFERENCES public.billing_receipts(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS billing_payments_receipt_idx ON public.billing_payments (receipt_id) WHERE receipt_id IS NOT NULL;
ALTER TABLE public.billing_payments DROP CONSTRAINT IF EXISTS billing_payments_kind_check;
ALTER TABLE public.billing_payments ADD CONSTRAINT billing_payments_kind_check CHECK (kind IN ('payment', 'ach', 'ach_return', 'credit'));
ALTER TABLE public.billing_payments DROP CONSTRAINT IF EXISTS billing_payments_method_check;
ALTER TABLE public.billing_payments ADD CONSTRAINT billing_payments_method_check CHECK (method IN ('ach', 'credit_card', 'debit_card', 'check', 'cash', 'other'));
ALTER TABLE public.billing_payments DROP CONSTRAINT IF EXISTS billing_payments_credit_receipt;
ALTER TABLE public.billing_payments ADD CONSTRAINT billing_payments_credit_receipt CHECK (kind <> 'credit' OR receipt_id IS NOT NULL);

ALTER TABLE public.billing_runs ADD COLUMN IF NOT EXISTS credit_total numeric(12,2) NOT NULL DEFAULT 0;   -- paid from payers' credit at submit

ALTER TABLE public.billing_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.billing_receipts TO authenticated;
GRANT ALL ON public.billing_receipts TO service_role;
DROP POLICY IF EXISTS "Owners and admins read billing_receipts" ON public.billing_receipts;
CREATE POLICY "Owners and admins read billing_receipts" ON public.billing_receipts FOR SELECT TO authenticated
  USING (public.can_view_confidential(center_id));

-- 2. Credit and applying money to charges ------------------------------------------------------------------------

-- What's left of a receipt after what it paid
CREATE OR REPLACE FUNCTION public.billing_receipt_left(p_receipt_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN r.voided THEN 0 ELSE r.amount - COALESCE((SELECT sum(p.amount) FROM billing_payments p
           WHERE p.receipt_id = r.id AND NOT p.voided), 0) END
  FROM billing_receipts r WHERE r.id = p_receipt_id
$$;
REVOKE ALL ON FUNCTION public.billing_receipt_left(uuid) FROM PUBLIC, anon, authenticated;

-- A payer's unused credit
CREATE OR REPLACE FUNCTION public.billing_payer_credit(p_payer_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(public.billing_receipt_left(r.id)), 0) FROM billing_receipts r WHERE r.payer_id = p_payer_id AND NOT r.voided
$$;
REVOKE ALL ON FUNCTION public.billing_payer_credit(uuid) FROM PUBLIC, anon, authenticated;

-- Put money from a receipt on a charge (the caller has locked the charge). A queued ACH draft that is now fully paid
-- comes out of its batch; if the batch file was already downloaded, it's flagged so a new file is downloaded.
CREATE OR REPLACE FUNCTION public.billing_apply(p_receipt_id uuid, p_charge_id uuid, p_amount numeric, p_kind text, p_on date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r billing_receipts%ROWTYPE; v_c billing_charges%ROWTYPE;
BEGIN
  IF p_amount <= 0 THEN RETURN; END IF;
  SELECT * INTO v_r FROM billing_receipts WHERE id = p_receipt_id;
  SELECT * INTO v_c FROM billing_charges WHERE id = p_charge_id;
  INSERT INTO billing_payments (center_id, charge_id, bill_id, child_id, kind, amount, method, reference, received_on, note, recorded_by, receipt_id)
  VALUES (v_c.center_id, v_c.id, v_c.bill_id, v_c.child_id, p_kind, p_amount, v_r.method,
    left(COALESCE(v_r.reference, CASE WHEN v_r.last4 IS NOT NULL THEN '····' || v_r.last4 END), 60), p_on,
    CASE WHEN p_kind = 'credit' THEN 'Paid from credit (payment of ' || to_char(v_r.received_on, 'Mon FMDD, YYYY') || ')' END,
    auth.uid(), v_r.id);
  PERFORM public.billing_charge_refresh(v_c.id);
  IF v_c.status = 'ach_scheduled' AND (SELECT paid_amount >= amount FROM billing_charges WHERE id = v_c.id) THEN
    UPDATE billing_charges SET ach_batch_id = NULL, note = 'Paid another way; taken out of the ACH draft' WHERE id = v_c.id;
    UPDATE billing_ach_batches SET file_stale = true WHERE id = v_c.ach_batch_id AND status = 'exported';
  ELSIF v_c.status = 'ach_scheduled' THEN
    UPDATE billing_ach_batches SET file_stale = true WHERE id = v_c.ach_batch_id AND status = 'exported';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.billing_apply(uuid, uuid, numeric, text, date) FROM PUBLIC, anon, authenticated;

-- 3. Take a payment ---------------------------------------------------------------------------------------------
-- p: {payer_id, amount, method, card_brand, last4, reference, received_on, note}
-- Returns {receipt_id, applied, credit, charges}
CREATE OR REPLACE FUNCTION public.billing_receive_payment(p_child_id uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_center uuid; v_payer child_payment_payers%ROWTYPE; v_today date; v_id uuid; v_left numeric; v_c record; v_part numeric;
  v_n int := 0;
  v_amt numeric := NULLIF(btrim(COALESCE(p ->> 'amount', '')), '')::numeric;
  v_method text := NULLIF(p ->> 'method', '');
  v_brand text := NULLIF(btrim(COALESCE(p ->> 'card_brand', '')), '');
  v_last4 text := NULLIF(btrim(COALESCE(p ->> 'last4', '')), '');
  v_ref text := NULLIF(btrim(COALESCE(p ->> 'reference', '')), '');
  v_on date := NULLIF(p ->> 'received_on', '')::date;
  v_note text := NULLIF(btrim(COALESCE(p ->> 'note', '')), '');
BEGIN
  SELECT center_id INTO v_center FROM children WHERE id = p_child_id;
  IF v_center IS NULL THEN RAISE EXCEPTION 'Child not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_center);
  v_today := public.roster_today(v_center);

  SELECT * INTO v_payer FROM child_payment_payers WHERE id = NULLIF(p ->> 'payer_id', '')::uuid AND child_id = p_child_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pick who is paying' USING ERRCODE = '22023'; END IF;
  IF v_method IS NULL OR v_method NOT IN ('credit_card', 'debit_card', 'check', 'cash', 'other') THEN
    RAISE EXCEPTION 'Pick how it was paid' USING ERRCODE = '22023';
  END IF;
  IF v_amt IS NULL OR v_amt <= 0 OR v_amt <> round(v_amt, 2) THEN RAISE EXCEPTION 'Enter the amount paid' USING ERRCODE = '22023'; END IF;
  IF v_amt > 100000 THEN RAISE EXCEPTION 'That amount is too large for one payment' USING ERRCODE = '22023'; END IF;
  IF v_method NOT IN ('credit_card', 'debit_card') THEN v_brand := NULL; v_last4 := NULL; END IF;
  IF v_last4 IS NOT NULL AND v_last4 !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Enter only the last 4 digits of the card' USING ERRCODE = '22023'; END IF;
  IF v_brand IS NOT NULL AND char_length(v_brand) > 20 THEN RAISE EXCEPTION 'Card type is too long' USING ERRCODE = '22023'; END IF;
  IF v_ref IS NOT NULL AND char_length(v_ref) > 60 THEN RAISE EXCEPTION 'Keep the reference to 60 characters' USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN RAISE EXCEPTION 'Keep the note to 300 characters' USING ERRCODE = '22023'; END IF;
  v_on := COALESCE(v_on, v_today);
  IF v_on > v_today THEN RAISE EXCEPTION 'The payment date can''t be in the future' USING ERRCODE = '22023'; END IF;

  INSERT INTO billing_receipts (center_id, child_id, payer_id, payer_name, amount, method, card_brand, last4, reference, received_on, note, recorded_by)
  VALUES (v_center, p_child_id, v_payer.id, v_payer.payer_name, v_amt, v_method, v_brand, v_last4, v_ref, v_on, v_note, auth.uid())
  RETURNING id INTO v_id;

  -- Oldest due first: this payer's charges with money still due that can still be paid here
  v_left := v_amt;
  FOR v_c IN
    SELECT c.id, c.amount - c.paid_amount AS due FROM billing_charges c
    JOIN billing_bills b ON b.id = c.bill_id
    LEFT JOIN billing_ach_batches ab ON ab.id = c.ach_batch_id
    WHERE c.payer_id = v_payer.id AND NOT b.voided AND c.amount > c.paid_amount
      AND (c.status IN ('open', 'partial', 'returned') OR (c.status = 'ach_scheduled' AND ab.status IN ('scheduled', 'exported')))
    ORDER BY b.period_start, c.created_at
    FOR UPDATE OF c
  LOOP
    EXIT WHEN v_left <= 0;
    v_part := LEAST(v_left, v_c.due);
    PERFORM public.billing_apply(v_id, v_c.id, v_part, 'payment', v_on);
    v_left := v_left - v_part; v_n := v_n + 1;
  END LOOP;

  PERFORM public.billing_log(v_center, p_child_id, 'billing_receipts', v_id, 'insert',
    'Payment received: ' || public.tuition_money(v_amt) || ' by ' || CASE v_method WHEN 'credit_card' THEN 'credit card' WHEN 'debit_card' THEN 'debit card' ELSE v_method END
    || COALESCE(' ····' || v_last4, '') || COALESCE(' #' || v_ref, '') || ' from ' || v_payer.payer_name
    || CASE WHEN v_left > 0 THEN ' (' || public.tuition_money(v_left) || ' kept as credit)' ELSE '' END);

  RETURN jsonb_build_object('receipt_id', v_id, 'applied', v_amt - v_left, 'credit', v_left, 'charges', v_n,
    'credit_total', public.billing_payer_credit(v_payer.id));
END $$;

-- Undo a payment taken by mistake: everything it paid is due again, and its credit is gone
CREATE OR REPLACE FUNCTION public.billing_receipt_void(p_receipt_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r billing_receipts%ROWTYPE; v_c uuid;
BEGIN
  SELECT * INTO v_r FROM billing_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_r.center_id);
  IF v_r.voided THEN RAISE EXCEPTION 'This payment was already voided' USING ERRCODE = '22023'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'Give a reason for voiding the payment' USING ERRCODE = '22023'; END IF;
  UPDATE billing_receipts SET voided = true, void_reason = left(btrim(p_reason), 300), voided_by = auth.uid(), voided_at = now() WHERE id = p_receipt_id;
  FOR v_c IN SELECT DISTINCT charge_id FROM billing_payments WHERE receipt_id = p_receipt_id AND NOT voided LOOP
    PERFORM 1 FROM billing_charges WHERE id = v_c FOR UPDATE;
    UPDATE billing_payments SET voided = true, void_reason = left('Payment voided: ' || btrim(p_reason), 300), voided_by = auth.uid(), voided_at = now()
    WHERE receipt_id = p_receipt_id AND charge_id = v_c AND NOT voided;
    PERFORM public.billing_charge_refresh(v_c);
  END LOOP;
  PERFORM public.billing_log(v_r.center_id, v_r.child_id, 'billing_receipts', v_r.id, 'update',
    'Payment voided: ' || public.tuition_money(v_r.amount) || ' from ' || v_r.payer_name || ' (' || btrim(p_reason) || ')');
END $$;

-- A billing run uses the payer's credit as each charge is created
CREATE OR REPLACE FUNCTION public.billing_charges_use_credit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r record; v_need numeric; v_part numeric; v_used numeric := 0; v_on date;
BEGIN
  IF NEW.payer_id IS NULL OR NEW.status NOT IN ('open', 'ach_scheduled') THEN RETURN NULL; END IF;
  v_need := NEW.amount;
  v_on := public.roster_today(NEW.center_id);
  FOR v_r IN SELECT id FROM billing_receipts WHERE payer_id = NEW.payer_id AND NOT voided ORDER BY received_on, created_at FOR UPDATE LOOP
    EXIT WHEN v_need <= 0;
    v_part := LEAST(v_need, public.billing_receipt_left(v_r.id));
    IF v_part > 0 THEN
      PERFORM public.billing_apply(v_r.id, NEW.id, v_part, 'credit', v_on);
      v_need := v_need - v_part; v_used := v_used + v_part;
    END IF;
  END LOOP;
  IF v_used > 0 THEN
    UPDATE billing_runs SET credit_total = credit_total + v_used,
      ach_total = ach_total - CASE WHEN NEW.status = 'ach_scheduled' THEN v_used ELSE 0 END,
      manual_total = manual_total - CASE WHEN NEW.status = 'ach_scheduled' THEN 0 ELSE v_used END
    WHERE id = NEW.run_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.billing_charges_use_credit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS billing_charges_use_credit ON public.billing_charges;
CREATE TRIGGER billing_charges_use_credit AFTER INSERT ON public.billing_charges
  FOR EACH ROW EXECUTE FUNCTION public.billing_charges_use_credit();

-- 4. The Payment card -------------------------------------------------------------------------------------------
-- { today, total_due, total_credit, unassigned_due,
--   payers: [{payer_id, payer_name, method, last4, card_brand, active, due, credit,
--             charges: [{id, label, period_start, amount, paid, balance, status}]}],
--   receipts: [{id, payer_name, amount, method, card_brand, last4, reference, received_on, note, applied, credit_left,
--               voided, void_reason, recorded_by, created_at}] }
CREATE OR REPLACE FUNCTION public.billing_child_account(p_child_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_center uuid; v_today date; v_payers jsonb;
BEGIN
  SELECT center_id INTO v_center FROM children WHERE id = p_child_id;
  IF v_center IS NULL OR NOT public.tuition_can_manage(v_center) THEN
    RAISE EXCEPTION 'You do not have access to this child''s billing' USING ERRCODE = '42501';
  END IF;
  v_today := public.roster_today(v_center);
  SELECT COALESCE(jsonb_agg(x ORDER BY (x ->> 'active')::boolean DESC, (x ->> 'sort_order')::int), '[]') INTO v_payers FROM (
    SELECT jsonb_build_object('payer_id', pp.id, 'payer_name', pp.payer_name, 'method', pp.method, 'last4', pp.last4,
      'card_brand', pp.card_brand, 'sort_order', pp.sort_order,
      'active', pp.effective_from <= v_today AND (pp.effective_to IS NULL OR pp.effective_to >= v_today),
      'due', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c WHERE c.payer_id = pp.id AND c.status <> 'void'), 0),
      'credit', public.billing_payer_credit(pp.id),
      'charges', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'label', public.billing_window_label(b.frequency, b.period_start),
            'period_start', b.period_start, 'amount', c.amount, 'paid', c.paid_amount, 'balance', c.amount - c.paid_amount, 'status', c.status)
            ORDER BY b.period_start, c.created_at)
          FROM billing_charges c JOIN billing_bills b ON b.id = c.bill_id
          WHERE c.payer_id = pp.id AND c.status <> 'void' AND c.amount > c.paid_amount), '[]')) AS x
    FROM child_payment_payers pp
    WHERE pp.child_id = p_child_id
      AND ((pp.effective_from <= v_today AND (pp.effective_to IS NULL OR pp.effective_to >= v_today))
           OR EXISTS (SELECT 1 FROM billing_charges c WHERE c.payer_id = pp.id AND c.status <> 'void' AND c.amount > c.paid_amount)
           OR public.billing_payer_credit(pp.id) > 0)
  ) s;

  RETURN jsonb_build_object(
    'today', v_today,
    'payers', v_payers,
    'total_due', COALESCE((SELECT sum((e ->> 'due')::numeric) FROM jsonb_array_elements(v_payers) e), 0),
    'total_credit', COALESCE((SELECT sum((e ->> 'credit')::numeric) FROM jsonb_array_elements(v_payers) e), 0),
    'unassigned_due', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c
                                WHERE c.child_id = p_child_id AND c.payer_id IS NULL AND c.status <> 'void'), 0),
    'receipts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'payer_name', r.payer_name, 'amount', r.amount,
        'method', r.method, 'card_brand', r.card_brand, 'last4', r.last4, 'reference', r.reference, 'received_on', r.received_on,
        'note', r.note, 'credit_left', public.billing_receipt_left(r.id),
        'applied', CASE WHEN r.voided THEN 0 ELSE r.amount - public.billing_receipt_left(r.id) END,
        'voided', r.voided, 'void_reason', r.void_reason, 'recorded_by', public.center_bank_who(r.recorded_by), 'created_at', r.created_at)
        ORDER BY r.received_on DESC, r.created_at DESC)
      FROM (SELECT * FROM billing_receipts WHERE child_id = p_child_id ORDER BY received_on DESC, created_at DESC LIMIT 25) r), '[]'));
END $$;

-- 5. Billing functions updated for payments and credit (same as 20270111000000 except where noted) ---------------

-- Recompute a charge (a queued ACH draft can now be part-paid from credit; it drafts what's left)
CREATE OR REPLACE FUNCTION public.billing_charge_refresh(p_charge_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_paid numeric;
BEGIN
  SELECT COALESCE(sum(amount), 0) INTO v_paid FROM billing_payments WHERE charge_id = p_charge_id AND NOT voided;
  UPDATE billing_charges SET paid_amount = v_paid, updated_at = now(),
    status = CASE
      WHEN status = 'void' THEN 'void'
      WHEN status IN ('ach_scheduled', 'ach_sent') AND v_paid < amount THEN status
      WHEN v_paid >= amount THEN 'paid'
      WHEN v_paid > 0 THEN 'partial'
      WHEN status = 'returned' THEN 'returned'
      ELSE 'open' END
  WHERE id = p_charge_id;
END $$;


-- The bank file drafts only what credit didn't cover
CREATE OR REPLACE FUNCTION public.billing_ach_export(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_b billing_ach_batches%ROWTYPE; v_bank center_bank_accounts%ROWTYPE; v_items jsonb; v_r record;
BEGIN
  SELECT * INTO v_b FROM billing_ach_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACH batch not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_b.center_id);
  IF NOT public.tuition_is_owner(v_b.center_id) THEN
    RAISE EXCEPTION 'Only the center''s owner can download the ACH file (it has full bank account numbers)' USING ERRCODE = '42501';
  END IF;
  IF v_b.status NOT IN ('scheduled', 'exported') THEN
    RAISE EXCEPTION 'This batch was already sent to the bank' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_bank FROM center_bank_accounts WHERE center_id = v_b.center_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Add the center''s bank account first (About → Center Profile → Bank account for payments)' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('charge_id', c.id, 'payer_name', c.payer_name, 'child_name', b.child_name,
           'routing_number', pp.routing_number, 'account_type', COALESCE(pp.account_type, 'checking'),
           'account_number_enc', pp.account_number_enc, 'last4', pp.last4, 'amount', c.amount - c.paid_amount) ORDER BY b.child_name, c.payer_name), '[]')
    INTO v_items
  FROM billing_charges c JOIN billing_bills b ON b.id = c.bill_id JOIN child_payment_payers pp ON pp.id = c.payer_id
  WHERE c.ach_batch_id = p_batch_id AND c.status = 'ach_scheduled' AND c.amount > c.paid_amount AND pp.account_number_enc IS NOT NULL AND pp.routing_number IS NOT NULL;
  IF jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'No drafts left in this batch' USING ERRCODE = '22023'; END IF;
  -- Every queued draft must be in the file, or marking the batch sent would mark a draft the bank never got
  SELECT c.payer_name INTO v_r FROM billing_charges c LEFT JOIN child_payment_payers pp ON pp.id = c.payer_id
  WHERE c.ach_batch_id = p_batch_id AND c.status = 'ach_scheduled' AND (pp.id IS NULL OR pp.account_number_enc IS NULL OR pp.routing_number IS NULL)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'The bank details for % are no longer on file. Record that payment by hand (it comes out of the batch), then download again', v_r.payer_name
      USING ERRCODE = '22023';
  END IF;

  UPDATE billing_ach_batches SET status = 'exported', file_stale = false, export_count = export_count + 1,
    exported_at = now(), exported_by = auth.uid() WHERE id = p_batch_id;
  FOR v_r IN SELECT DISTINCT c.child_id, c.payer_name, c.last4, c.id FROM billing_charges c
             WHERE c.ach_batch_id = p_batch_id AND c.status = 'ach_scheduled' LOOP
    PERFORM public.billing_log(v_b.center_id, v_r.child_id, 'billing_charges', v_r.id, 'update',
      'ACH file downloaded with ' || v_r.payer_name || '''s account ····' || COALESCE(v_r.last4, ''));
  END LOOP;
  INSERT INTO center_bank_account_events (center_id, bank_account_id, action, user_id, summary)
  VALUES (v_b.center_id, v_bank.id, 'viewed', auth.uid(), 'ACH draft file downloaded (' || jsonb_array_length(v_items) || ' drafts)');

  RETURN jsonb_build_object(
    'batch_id', v_b.id, 'draft_date', v_b.draft_date,
    'center_name', (SELECT name FROM centers WHERE id = v_b.center_id),
    'bank', jsonb_build_object('account_holder_name', v_bank.account_holder_name, 'bank_name', v_bank.bank_name, 'routing_number', v_bank.routing_number,
      'account_type', v_bank.account_type, 'account_number_enc', v_bank.account_number_enc, 'last4', v_bank.last4),
    'items', v_items);
END $$;


-- Money from a receipt is undone by voiding the receipt
CREATE OR REPLACE FUNCTION public.billing_payment_void(p_payment_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p billing_payments%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM billing_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_p.center_id);
  IF v_p.voided THEN RAISE EXCEPTION 'This payment was already voided' USING ERRCODE = '22023'; END IF;
  IF v_p.receipt_id IS NOT NULL THEN RAISE EXCEPTION 'This came from a payment on the child''s Payment card. Void that payment there' USING ERRCODE = '22023'; END IF;
  IF v_p.kind <> 'payment' THEN RAISE EXCEPTION 'ACH payments change through the ACH batch (mark returned)' USING ERRCODE = '22023'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'Give a reason for voiding the payment' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM billing_charges WHERE id = v_p.charge_id FOR UPDATE;
  UPDATE billing_payments SET voided = true, void_reason = left(btrim(p_reason), 300), voided_by = auth.uid(), voided_at = now()
  WHERE id = p_payment_id;
  PERFORM public.billing_charge_refresh(v_p.charge_id);
  PERFORM public.billing_log(v_p.center_id, v_p.child_id, 'billing_payments', v_p.id, 'update',
    'Payment voided: ' || public.tuition_money(v_p.amount) || ' (' || btrim(p_reason) || ')');
END $$;


-- Voiding a run gives back the credit it used
CREATE OR REPLACE FUNCTION public.billing_run_void(p_run_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r billing_runs%ROWTYPE; v_b record;
BEGIN
  SELECT * INTO v_r FROM billing_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing run not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_r.center_id);
  IF NOT public.tuition_is_owner(v_r.center_id) THEN RAISE EXCEPTION 'Only the center''s owner can void a billing run' USING ERRCODE = '42501'; END IF;
  IF v_r.status = 'void' THEN RAISE EXCEPTION 'This run was already voided' USING ERRCODE = '22023'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'Give a reason for voiding the run' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM billing_ach_batches WHERE run_id = p_run_id AND status IN ('sent', 'settled')) THEN
    RAISE EXCEPTION 'The ACH file for this run was already sent to the bank, so it can''t be voided' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM billing_payments p JOIN billing_charges c ON c.id = p.charge_id WHERE c.run_id = p_run_id AND NOT p.voided AND p.kind <> 'credit') THEN
    RAISE EXCEPTION 'Payments were recorded on this run. Void those payments first' USING ERRCODE = '22023';
  END IF;

  -- Credit the run used goes back to the payers
  UPDATE billing_payments SET voided = true, void_reason = 'Billing run voided', voided_by = auth.uid(), voided_at = now()
  WHERE kind = 'credit' AND NOT voided AND charge_id IN (SELECT id FROM billing_charges WHERE run_id = p_run_id);
  UPDATE billing_runs SET status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = left(btrim(p_reason), 300) WHERE id = p_run_id;
  UPDATE billing_ach_batches SET status = 'void' WHERE run_id = p_run_id;
  UPDATE billing_charges SET status = 'void', updated_at = now() WHERE run_id = p_run_id;
  UPDATE billing_bill_lines SET voided = true WHERE bill_id IN (SELECT id FROM billing_bills WHERE run_id = p_run_id);
  UPDATE billing_bills SET voided = true WHERE run_id = p_run_id;
  FOR v_b IN SELECT id, child_id, total FROM billing_bills WHERE run_id = p_run_id LOOP
    PERFORM public.billing_log(v_r.center_id, v_b.child_id, 'billing_bills', v_b.id, 'update',
      'Bill voided: ' || public.billing_window_label(v_r.frequency, v_r.period_start) || ', ' || public.tuition_money(v_b.total)
      || ' (' || btrim(p_reason) || ')');
  END LOOP;
END $$;


-- The preview also shows each payer's credit, which the run will use
CREATE OR REPLACE FUNCTION public.billing_preview(p_center_id uuid, p_frequency text, p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_today date;
BEGIN
  PERFORM public.tuition_require(p_center_id);
  v := public.billing_compute(p_center_id, p_frequency, COALESCE(p_day, public.roster_today(p_center_id)));
  v_today := public.roster_today(p_center_id);
  RETURN v || jsonb_build_object(
    'today', v_today,
    'is_owner', public.tuition_is_owner(p_center_id),
    'default_draft_date', GREATEST(v_today, (v ->> 'period_start')::date),
    'credits', COALESCE((SELECT jsonb_object_agg(pp.id, public.billing_payer_credit(pp.id)) FROM child_payment_payers pp
                         WHERE pp.center_id = p_center_id AND EXISTS (SELECT 1 FROM billing_receipts r WHERE r.payer_id = pp.id AND NOT r.voided)
                           AND public.billing_payer_credit(pp.id) > 0), '{}'),
    'center_bank', EXISTS (SELECT 1 FROM center_bank_accounts WHERE center_id = p_center_id AND status = 'active'),
    'runs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'total', r.total,
                        'child_count', r.child_count, 'submitted_at', r.submitted_at) ORDER BY r.submitted_at)
                      FROM billing_runs r WHERE r.center_id = p_center_id AND r.frequency = p_frequency
                        AND r.period_start = (v ->> 'period_start')::date), '[]'));
END $$;


CREATE OR REPLACE FUNCTION public.billing_charge_json(c public.billing_charges)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', c.id, 'bill_id', c.bill_id, 'payer_id', c.payer_id, 'payer_name', c.payer_name,
    'payer_kind', c.payer_kind, 'method', c.method, 'account_type', c.account_type, 'last4', c.last4,
    'amount', c.amount, 'paid', c.paid_amount, 'balance', CASE WHEN c.status = 'void' THEN 0 ELSE c.amount - c.paid_amount END,
    'status', c.status, 'ach_batch_id', c.ach_batch_id, 'ach_return_code', c.ach_return_code, 'note', c.note,
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'amount', p.amount, 'method', p.method,
        'reference', p.reference, 'received_on', p.received_on, 'note', p.note, 'voided', p.voided, 'void_reason', p.void_reason,
        'recorded_by', public.center_bank_who(p.recorded_by), 'created_at', p.created_at, 'receipt_id', p.receipt_id) ORDER BY p.created_at)
      FROM billing_payments p WHERE p.charge_id = c.id), '[]'))
$$;


CREATE OR REPLACE FUNCTION public.billing_run_summary(r public.billing_runs)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', r.id, 'frequency', r.frequency, 'period_start', r.period_start, 'period_end', r.period_end,
    'label', public.billing_window_label(r.frequency, r.period_start), 'draft_date', r.draft_date, 'status', r.status,
    'child_count', r.child_count, 'list_total', r.list_total, 'discount_total', r.discount_total, 'total', r.total,
    'ach_total', r.ach_total, 'manual_total', r.manual_total, 'credit_total', r.credit_total, 'note', r.note,
    'paid', COALESCE((SELECT sum(c.paid_amount) FROM billing_charges c WHERE c.run_id = r.id AND c.status <> 'void'), 0),
    'balance', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c WHERE c.run_id = r.id AND c.status <> 'void'), 0),
    'submitted_at', r.submitted_at, 'submitted_by', public.center_bank_who(r.submitted_by),
    'voided_at', r.voided_at, 'voided_by', public.center_bank_who(r.voided_by), 'void_reason', r.void_reason,
    'ach', (SELECT jsonb_build_object('id', b.id, 'status', b.status, 'draft_date', b.draft_date, 'file_stale', b.file_stale,
              'export_count', b.export_count, 'exported_at', b.exported_at, 'sent_at', b.sent_at, 'settled_at', b.settled_at,
              'count', (SELECT count(*) FROM billing_charges c WHERE c.ach_batch_id = b.id AND c.status IN ('ach_scheduled', 'ach_sent', 'paid', 'returned', 'partial')),
              'pending_total', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c WHERE c.ach_batch_id = b.id AND c.status IN ('ach_scheduled', 'ach_sent')), 0))
            FROM billing_ach_batches b WHERE b.run_id = r.id))
$$;


-- 6. Grants ----------------------------------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['billing_receive_payment(uuid, jsonb)', 'billing_receipt_void(uuid, text)', 'billing_child_account(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

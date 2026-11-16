-- ============================================================
-- Billing: payments and credit follow the person who pays, not the payer line.
--
--  - Editing payers on Fee & Payment ends the old payer lines and starts new ones (and deletes lines started the same
--    day). Payments were tied to the line, with ON DELETE CASCADE, so re-saving payers on the day a payment was taken
--    deleted the payment, and credit on an ended line was never used by the next billing run.
--  - Now billing_receipts and billing_charges also keep payer_guardian_id (filled from the payer line on insert).
--    The person = the contact (payer_guardian_id), or the payer's name for outside payers (subsidy, employer).
--    Credit, "oldest due first" and the Payment card all match by person, across that person's payer lines.
--  - billing_receipts.payer_id is now ON DELETE SET NULL (never deletes a payment).
--  - The Payment card lists one row per person, and each payment says what it paid ("paid_for") and which bills used
--    its credit ("used_for").
-- Needs: 20270116000000_billing_credit_used.sql
-- Rollback: supabase/rollbacks/20270117000000_billing_payer_identity.down.sql
-- ============================================================

-- 1. Never delete a payment with a payer line; remember who paid -------------------------------------------------
ALTER TABLE public.billing_receipts DROP CONSTRAINT IF EXISTS billing_receipts_payer_id_fkey;
ALTER TABLE public.billing_receipts ALTER COLUMN payer_id DROP NOT NULL;
ALTER TABLE public.billing_receipts ADD CONSTRAINT billing_receipts_payer_id_fkey
  FOREIGN KEY (payer_id) REFERENCES public.child_payment_payers(id) ON DELETE SET NULL;
ALTER TABLE public.billing_receipts ADD COLUMN IF NOT EXISTS payer_guardian_id uuid;
ALTER TABLE public.billing_charges ADD COLUMN IF NOT EXISTS payer_guardian_id uuid;
UPDATE public.billing_receipts r SET payer_guardian_id = pp.payer_guardian_id
  FROM public.child_payment_payers pp WHERE pp.id = r.payer_id AND r.payer_guardian_id IS NULL;
UPDATE public.billing_charges c SET payer_guardian_id = pp.payer_guardian_id
  FROM public.child_payment_payers pp WHERE pp.id = c.payer_id AND c.payer_guardian_id IS NULL;

CREATE OR REPLACE FUNCTION public.billing_fill_payer_guardian()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payer_id IS NOT NULL AND NEW.payer_guardian_id IS NULL THEN
    SELECT payer_guardian_id INTO NEW.payer_guardian_id FROM child_payment_payers WHERE id = NEW.payer_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.billing_fill_payer_guardian() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS billing_receipts_fill_guardian ON public.billing_receipts;
CREATE TRIGGER billing_receipts_fill_guardian BEFORE INSERT ON public.billing_receipts FOR EACH ROW EXECUTE FUNCTION public.billing_fill_payer_guardian();
DROP TRIGGER IF EXISTS billing_charges_fill_guardian ON public.billing_charges;
CREATE TRIGGER billing_charges_fill_guardian BEFORE INSERT ON public.billing_charges FOR EACH ROW EXECUTE FUNCTION public.billing_fill_payer_guardian();

-- 2. The person who pays ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_ident(p_guardian_id uuid, p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(p_guardian_id::text, 'n:' || lower(btrim(COALESCE(p_name, ''))))
$$;

-- Unused credit of a person for a child
CREATE OR REPLACE FUNCTION public.billing_ident_credit(p_child_id uuid, p_ident text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(public.billing_receipt_left(r.id)), 0) FROM billing_receipts r
  WHERE r.child_id = p_child_id AND NOT r.voided AND public.billing_ident(r.payer_guardian_id, r.payer_name) = p_ident
$$;
REVOKE ALL ON FUNCTION public.billing_ident_credit(uuid, text) FROM PUBLIC, anon, authenticated;

-- A payer line's credit = its person's credit
CREATE OR REPLACE FUNCTION public.billing_payer_credit(p_payer_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT public.billing_ident_credit(pp.child_id, public.billing_ident(pp.payer_guardian_id, pp.payer_name))
                   FROM child_payment_payers pp WHERE pp.id = p_payer_id), 0)
$$;

-- 3. Billing functions by person (as in 20270112000000 / 20270114000000 / 20270116000000 otherwise) --------------

CREATE OR REPLACE FUNCTION public.billing_charges_use_credit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r record; v_need numeric; v_part numeric; v_used numeric := 0; v_on date;
BEGIN
  IF NEW.method = 'unassigned' OR NEW.status NOT IN ('open', 'ach_scheduled') THEN RETURN NULL; END IF;
  v_need := NEW.amount;
  v_on := public.roster_today(NEW.center_id);
  FOR v_r IN SELECT id FROM billing_receipts
             WHERE child_id = NEW.child_id AND NOT voided
               AND public.billing_ident(payer_guardian_id, payer_name) = public.billing_ident(NEW.payer_guardian_id, NEW.payer_name)
             ORDER BY received_on, created_at FOR UPDATE LOOP
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
  IF v_method IS NULL OR v_method NOT IN ('credit_card', 'debit_card', 'check', 'cash', 'other', 'credit') THEN
    RAISE EXCEPTION 'Pick how it was paid' USING ERRCODE = '22023';
  END IF;
  IF v_method = 'credit' AND v_note IS NULL THEN RAISE EXCEPTION 'Give a reason for the credit' USING ERRCODE = '22023'; END IF;
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
    WHERE c.child_id = p_child_id AND c.method <> 'unassigned' AND NOT b.voided AND c.amount > c.paid_amount
      AND public.billing_ident(c.payer_guardian_id, c.payer_name) = public.billing_ident(v_payer.payer_guardian_id, v_payer.payer_name)
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
    CASE WHEN v_method = 'credit' THEN 'Credit given: ' || public.tuition_money(v_amt) || ' (' || v_note || ')'
    ELSE 'Payment received: ' || public.tuition_money(v_amt) || ' by ' || CASE v_method WHEN 'credit_card' THEN 'credit card' WHEN 'debit_card' THEN 'debit card' ELSE v_method END END
    || COALESCE(' ····' || v_last4, '') || COALESCE(' #' || v_ref, '') || ' from ' || v_payer.payer_name
    || CASE WHEN v_left > 0 THEN ' (' || public.tuition_money(v_left) || ' kept as credit)' ELSE '' END);

  RETURN jsonb_build_object('receipt_id', v_id, 'applied', v_amt - v_left, 'credit', v_left, 'charges', v_n,
    'credit_total', public.billing_payer_credit(v_payer.id));
END $$;


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
                         WHERE pp.center_id = p_center_id
                           AND EXISTS (SELECT 1 FROM billing_receipts r WHERE r.child_id = pp.child_id AND NOT r.voided)
                           AND public.billing_payer_credit(pp.id) > 0), '{}'),
    'center_bank', EXISTS (SELECT 1 FROM center_bank_accounts WHERE center_id = p_center_id AND status = 'active'),
    'runs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'total', r.total,
                        'child_count', r.child_count, 'submitted_at', r.submitted_at) ORDER BY r.submitted_at)
                      FROM billing_runs r WHERE r.center_id = p_center_id AND r.frequency = p_frequency
                        AND r.period_start = (v ->> 'period_start')::date), '[]'));
END $$;


CREATE OR REPLACE FUNCTION public.billing_child_account(p_child_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_center uuid; v_today date; v_payers jsonb := '[]'; v_i text; v_row child_payment_payers%ROWTYPE; v_active boolean;
  v_due numeric; v_credit numeric;
BEGIN
  SELECT center_id INTO v_center FROM children WHERE id = p_child_id;
  IF v_center IS NULL OR NOT public.tuition_can_manage(v_center) THEN
    RAISE EXCEPTION 'You do not have access to this child''s billing' USING ERRCODE = '42501';
  END IF;
  v_today := public.roster_today(v_center);

  -- One entry per person who pays (contact, or name for outside payers), across all their payer lines
  FOR v_i IN
    SELECT i FROM (
      SELECT public.billing_ident(pp.payer_guardian_id, pp.payer_name) AS i FROM child_payment_payers pp WHERE pp.child_id = p_child_id
      UNION SELECT public.billing_ident(c.payer_guardian_id, c.payer_name) FROM billing_charges c
        WHERE c.child_id = p_child_id AND c.method <> 'unassigned' AND c.status <> 'void' AND c.amount > c.paid_amount
      UNION SELECT public.billing_ident(r.payer_guardian_id, r.payer_name) FROM billing_receipts r WHERE r.child_id = p_child_id AND NOT r.voided
    ) s
  LOOP
    SELECT pp.* INTO v_row FROM child_payment_payers pp
    WHERE pp.child_id = p_child_id AND public.billing_ident(pp.payer_guardian_id, pp.payer_name) = v_i
    ORDER BY (pp.effective_from <= v_today AND (pp.effective_to IS NULL OR pp.effective_to >= v_today)) DESC, pp.effective_from DESC, pp.created_at DESC
    LIMIT 1;
    CONTINUE WHEN NOT FOUND;   -- no payer line left for this person: payments can't be taken for them here
    v_active := v_row.effective_from <= v_today AND (v_row.effective_to IS NULL OR v_row.effective_to >= v_today);
    SELECT COALESCE(sum(c.amount - c.paid_amount), 0) INTO v_due FROM billing_charges c
    WHERE c.child_id = p_child_id AND c.method <> 'unassigned' AND c.status <> 'void' AND public.billing_ident(c.payer_guardian_id, c.payer_name) = v_i;
    v_credit := public.billing_ident_credit(p_child_id, v_i);
    CONTINUE WHEN NOT v_active AND v_due <= 0 AND v_credit <= 0;
    v_payers := v_payers || jsonb_build_object('payer_id', v_row.id, 'payer_name', v_row.payer_name, 'method', v_row.method,
      'last4', v_row.last4, 'card_brand', v_row.card_brand, 'sort_order', v_row.sort_order, 'active', v_active,
      'due', v_due, 'credit', v_credit,
      'charges', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'label', public.billing_window_label(b.frequency, b.period_start),
            'period_start', b.period_start, 'amount', c.amount, 'paid', c.paid_amount, 'balance', c.amount - c.paid_amount, 'status', c.status)
            ORDER BY b.period_start, c.created_at)
          FROM billing_charges c JOIN billing_bills b ON b.id = c.bill_id
          WHERE c.child_id = p_child_id AND c.method <> 'unassigned' AND c.status <> 'void' AND c.amount > c.paid_amount
            AND public.billing_ident(c.payer_guardian_id, c.payer_name) = v_i), '[]'));
  END LOOP;
  SELECT COALESCE(jsonb_agg(e ORDER BY (e ->> 'active')::boolean DESC, (e ->> 'sort_order')::int), '[]') INTO v_payers FROM jsonb_array_elements(v_payers) e;

  RETURN jsonb_build_object(
    'today', v_today,
    'payers', v_payers,
    'adjustments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount, 'reason', a.reason,
        'frequency', a.frequency, 'period_start', a.period_start, 'label', public.billing_window_label(a.frequency, a.period_start),
        'payer_id', a.payer_id, 'payer_name', (SELECT payer_name FROM child_payment_payers WHERE id = a.payer_id),
        'created_by', public.center_bank_who(a.created_by), 'created_at', a.created_at) ORDER BY a.period_start, a.created_at)
      FROM billing_adjustments a WHERE a.child_id = p_child_id AND NOT a.voided
        AND NOT EXISTS (SELECT 1 FROM billing_bill_lines bl WHERE bl.adjustment_id = a.id AND NOT bl.voided)), '[]'),
    'total_due', COALESCE((SELECT sum((e ->> 'due')::numeric) FROM jsonb_array_elements(v_payers) e), 0),
    'total_credit', COALESCE((SELECT sum((e ->> 'credit')::numeric) FROM jsonb_array_elements(v_payers) e), 0),
    'unassigned_due', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c
                                WHERE c.child_id = p_child_id AND c.method = 'unassigned' AND c.status <> 'void'), 0),
    'receipts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'payer_name', r.payer_name, 'amount', r.amount,
        'method', r.method, 'card_brand', r.card_brand, 'last4', r.last4, 'reference', r.reference, 'received_on', r.received_on,
        'note', r.note, 'credit_left', public.billing_receipt_left(r.id),
        'paid_now', CASE WHEN r.voided THEN 0 ELSE COALESCE((SELECT sum(p.amount) FROM billing_payments p
                      WHERE p.receipt_id = r.id AND p.kind = 'payment' AND NOT p.voided), 0) END,
        'credit_used', CASE WHEN r.voided THEN 0 ELSE COALESCE((SELECT sum(p.amount) FROM billing_payments p
                      WHERE p.receipt_id = r.id AND p.kind = 'credit' AND NOT p.voided), 0) END,
        'applied', CASE WHEN r.voided THEN 0 ELSE r.amount - public.billing_receipt_left(r.id) END,
        'paid_for', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', public.billing_window_label(w.frequency, w.ps), 'amount', w.s) ORDER BY w.ps)
            FROM (SELECT b.frequency, b.period_start AS ps, sum(p.amount) AS s FROM billing_payments p JOIN billing_bills b ON b.id = p.bill_id
                  WHERE p.receipt_id = r.id AND p.kind = 'payment' AND NOT p.voided GROUP BY b.frequency, b.period_start) w), '[]'),
        'used_for', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', public.billing_window_label(w.frequency, w.ps), 'amount', w.s) ORDER BY w.ps)
            FROM (SELECT b.frequency, b.period_start AS ps, sum(p.amount) AS s FROM billing_payments p JOIN billing_bills b ON b.id = p.bill_id
                  WHERE p.receipt_id = r.id AND p.kind = 'credit' AND NOT p.voided GROUP BY b.frequency, b.period_start) w), '[]'),
        'voided', r.voided, 'void_reason', r.void_reason, 'recorded_by', public.center_bank_who(r.recorded_by), 'created_at', r.created_at)
        ORDER BY r.received_on DESC, r.created_at DESC)
      FROM (SELECT * FROM billing_receipts WHERE child_id = p_child_id ORDER BY received_on DESC, created_at DESC LIMIT 25) r), '[]'));
END $$;


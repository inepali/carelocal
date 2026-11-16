-- Rollback for 20270112000000_billing_receipts.sql: removes payments taken on the child's Payment card and credit.
-- WARNING: deletes every payment taken there (and what it paid on charges). Export what you need first.
DROP TRIGGER IF EXISTS billing_charges_use_credit ON public.billing_charges;
DROP FUNCTION IF EXISTS public.billing_charges_use_credit();
DROP FUNCTION IF EXISTS public.billing_child_account(uuid);
DROP FUNCTION IF EXISTS public.billing_receipt_void(uuid, text);
DROP FUNCTION IF EXISTS public.billing_receive_payment(uuid, jsonb);
DROP FUNCTION IF EXISTS public.billing_apply(uuid, uuid, numeric, text, date);
DROP FUNCTION IF EXISTS public.billing_payer_credit(uuid);
DROP FUNCTION IF EXISTS public.billing_receipt_left(uuid);
-- payments that came from receipts are removed, then charges are recomputed below
DELETE FROM public.billing_payments WHERE receipt_id IS NOT NULL OR kind = 'credit' OR method = 'debit_card';
ALTER TABLE public.billing_payments DROP COLUMN IF EXISTS receipt_id;
DROP TABLE IF EXISTS public.billing_receipts;
ALTER TABLE public.billing_payments DROP CONSTRAINT IF EXISTS billing_payments_credit_receipt;
ALTER TABLE public.billing_payments DROP CONSTRAINT IF EXISTS billing_payments_kind_check;
ALTER TABLE public.billing_payments ADD CONSTRAINT billing_payments_kind_check CHECK (kind IN ('payment', 'ach', 'ach_return'));
ALTER TABLE public.billing_payments DROP CONSTRAINT IF EXISTS billing_payments_method_check;
ALTER TABLE public.billing_payments ADD CONSTRAINT billing_payments_method_check CHECK (method IN ('ach', 'credit_card', 'check', 'cash', 'other'));
ALTER TABLE public.billing_runs DROP COLUMN IF EXISTS credit_total;

-- Functions as in 20270111000000_billing_runs.sql
CREATE OR REPLACE FUNCTION public.billing_charge_refresh(p_charge_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_paid numeric;
BEGIN
  SELECT COALESCE(sum(amount), 0) INTO v_paid FROM billing_payments WHERE charge_id = p_charge_id AND NOT voided;
  UPDATE billing_charges SET paid_amount = v_paid, updated_at = now(),
    status = CASE
      WHEN status = 'void' THEN 'void'
      WHEN status IN ('ach_scheduled', 'ach_sent') AND v_paid = 0 THEN status
      WHEN v_paid >= amount THEN 'paid'
      WHEN v_paid > 0 THEN 'partial'
      WHEN status = 'returned' THEN 'returned'
      ELSE 'open' END
  WHERE id = p_charge_id;
END $$;


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
           'account_number_enc', pp.account_number_enc, 'last4', pp.last4, 'amount', c.amount) ORDER BY b.child_name, c.payer_name), '[]')
    INTO v_items
  FROM billing_charges c JOIN billing_bills b ON b.id = c.bill_id JOIN child_payment_payers pp ON pp.id = c.payer_id
  WHERE c.ach_batch_id = p_batch_id AND c.status = 'ach_scheduled' AND pp.account_number_enc IS NOT NULL AND pp.routing_number IS NOT NULL;
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


CREATE OR REPLACE FUNCTION public.billing_payment_void(p_payment_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p billing_payments%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM billing_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tuition_require(v_p.center_id);
  IF v_p.voided THEN RAISE EXCEPTION 'This payment was already voided' USING ERRCODE = '22023'; END IF;
  IF v_p.kind <> 'payment' THEN RAISE EXCEPTION 'ACH payments change through the ACH batch (mark returned)' USING ERRCODE = '22023'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'Give a reason for voiding the payment' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM billing_charges WHERE id = v_p.charge_id FOR UPDATE;
  UPDATE billing_payments SET voided = true, void_reason = left(btrim(p_reason), 300), voided_by = auth.uid(), voided_at = now()
  WHERE id = p_payment_id;
  PERFORM public.billing_charge_refresh(v_p.charge_id);
  PERFORM public.billing_log(v_p.center_id, v_p.child_id, 'billing_payments', v_p.id, 'update',
    'Payment voided: ' || public.tuition_money(v_p.amount) || ' (' || btrim(p_reason) || ')');
END $$;


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
  IF EXISTS (SELECT 1 FROM billing_payments p JOIN billing_charges c ON c.id = p.charge_id WHERE c.run_id = p_run_id AND NOT p.voided) THEN
    RAISE EXCEPTION 'Payments were recorded on this run. Void those payments first' USING ERRCODE = '22023';
  END IF;

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
        'recorded_by', public.center_bank_who(p.recorded_by), 'created_at', p.created_at) ORDER BY p.created_at)
      FROM billing_payments p WHERE p.charge_id = c.id), '[]'))
$$;


CREATE OR REPLACE FUNCTION public.billing_run_summary(r public.billing_runs)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', r.id, 'frequency', r.frequency, 'period_start', r.period_start, 'period_end', r.period_end,
    'label', public.billing_window_label(r.frequency, r.period_start), 'draft_date', r.draft_date, 'status', r.status,
    'child_count', r.child_count, 'list_total', r.list_total, 'discount_total', r.discount_total, 'total', r.total,
    'ach_total', r.ach_total, 'manual_total', r.manual_total, 'note', r.note,
    'paid', COALESCE((SELECT sum(c.paid_amount) FROM billing_charges c WHERE c.run_id = r.id AND c.status <> 'void'), 0),
    'balance', COALESCE((SELECT sum(c.amount - c.paid_amount) FROM billing_charges c WHERE c.run_id = r.id AND c.status <> 'void'), 0),
    'submitted_at', r.submitted_at, 'submitted_by', public.center_bank_who(r.submitted_by),
    'voided_at', r.voided_at, 'voided_by', public.center_bank_who(r.voided_by), 'void_reason', r.void_reason,
    'ach', (SELECT jsonb_build_object('id', b.id, 'status', b.status, 'draft_date', b.draft_date, 'file_stale', b.file_stale,
              'export_count', b.export_count, 'exported_at', b.exported_at, 'sent_at', b.sent_at, 'settled_at', b.settled_at,
              'count', (SELECT count(*) FROM billing_charges c WHERE c.ach_batch_id = b.id AND c.status IN ('ach_scheduled', 'ach_sent', 'paid', 'returned', 'partial')),
              'pending_total', COALESCE((SELECT sum(c.amount) FROM billing_charges c WHERE c.ach_batch_id = b.id AND c.status IN ('ach_scheduled', 'ach_sent')), 0))
            FROM billing_ach_batches b WHERE b.run_id = r.id))
$$;


-- Recompute every charge without the removed payments
DO $$ DECLARE c uuid; BEGIN FOR c IN SELECT id FROM public.billing_charges LOOP PERFORM public.billing_charge_refresh(c); END LOOP; END $$;

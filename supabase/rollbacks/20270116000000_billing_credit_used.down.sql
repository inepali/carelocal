-- Rollback for 20270116000000_billing_credit_used.sql: billing_child_account as in 20270114000000.
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
    'adjustments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount, 'reason', a.reason,
        'frequency', a.frequency, 'period_start', a.period_start, 'label', public.billing_window_label(a.frequency, a.period_start),
        'payer_id', a.payer_id, 'payer_name', (SELECT payer_name FROM child_payment_payers WHERE id = a.payer_id),
        'created_by', public.center_bank_who(a.created_by), 'created_at', a.created_at) ORDER BY a.period_start, a.created_at)
      FROM billing_adjustments a WHERE a.child_id = p_child_id AND NOT a.voided
        AND NOT EXISTS (SELECT 1 FROM billing_bill_lines bl WHERE bl.adjustment_id = a.id AND NOT bl.voided)), '[]'),
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


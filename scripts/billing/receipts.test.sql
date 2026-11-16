-- Database tests for payments taken on the child's Payment card (20270112000000_billing_receipts.sql).
-- Runs in the same psql session right after scripts/billing/billing.test.sql (it reuses that data and helpers):
--   ... -f supabase/migrations/20270112000000_billing_receipts.sql -f scripts/billing/billing.test.sql -f scripts/billing/receipts.test.sql
\set ON_ERROR_STOP on

SELECT pg_temp.as_user(NULL);
UPDATE centers SET tuition_enabled = true WHERE id = '10000000-0000-0000-0000-000000000001';
CREATE FUNCTION pg_temp.payer(child text, name text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT pp.id FROM child_payment_payers pp JOIN children ch ON ch.id = pp.child_id
  WHERE ch.first_name || ' ' || ch.last_name = child AND pp.payer_name = name $$;
CREATE FUNCTION pg_temp.acct(child uuid, payer text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(billing_child_account(child) -> 'payers') e WHERE e ->> 'payer_name' = payer $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;
CREATE TEMP TABLE rc (k text PRIMARY KEY, v jsonb);
GRANT ALL ON rc TO PUBLIC;
SET ROLE authenticated;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');   -- Dan, admin

-- 1. What's due ------------------------------------------------------------------------------------------------
SELECT pg_temp.eq((pg_temp.acct('d0000000-0000-0000-0000-000000000002', 'Ben Mom') ->> 'due')::numeric, 142.50, 'Ben Mom owes her half');
SELECT pg_temp.eq((pg_temp.acct('d0000000-0000-0000-0000-000000000002', 'Ben Dad') ->> 'due')::numeric, 0.00, 'Ben Dad paid');
SELECT pg_temp.eq((billing_child_account('d0000000-0000-0000-0000-000000000003') ->> 'unassigned_due')::numeric, 385.00, 'Cal: due with no payer');

-- 2. Checks ----------------------------------------------------------------------------------------------------
SELECT pg_temp.fails(format($$SELECT billing_receive_payment('d0000000-0000-0000-0000-000000000002', jsonb_build_object('payer_id', %L, 'amount', '10', 'method', 'cash'))$$, pg_temp.payer('Ava A', 'Ava Mom')), 'Pick who is paying');
SELECT pg_temp.fails(format($$SELECT billing_receive_payment('d0000000-0000-0000-0000-000000000002', jsonb_build_object('payer_id', %L, 'amount', '0', 'method', 'cash'))$$, pg_temp.payer('Ben B', 'Ben Mom')), 'amount');
SELECT pg_temp.fails(format($$SELECT billing_receive_payment('d0000000-0000-0000-0000-000000000002', jsonb_build_object('payer_id', %L, 'amount', '10', 'method', 'ach'))$$, pg_temp.payer('Ben B', 'Ben Mom')), 'how it was paid');
SELECT pg_temp.fails(format($$SELECT billing_receive_payment('d0000000-0000-0000-0000-000000000002', jsonb_build_object('payer_id', %L, 'amount', '10', 'method', 'credit_card', 'last4', '42x2'))$$, pg_temp.payer('Ben B', 'Ben Mom')), 'last 4');
SELECT pg_temp.fails(format($$SELECT billing_receive_payment('d0000000-0000-0000-0000-000000000002', jsonb_build_object('payer_id', %L, 'amount', '10', 'method', 'cash', 'received_on', pg_temp.today() + 1))$$, pg_temp.payer('Ben B', 'Ben Mom')), 'future');

-- 3. Partial, then more than due (the rest is credit) ---------------------------------------------------------
INSERT INTO rc SELECT 'p1', billing_receive_payment('d0000000-0000-0000-0000-000000000002', jsonb_build_object('payer_id', pg_temp.payer('Ben B', 'Ben Mom'), 'amount', '50', 'method', 'cash'));
SELECT pg_temp.eq(((SELECT v FROM rc WHERE k = 'p1') ->> 'credit')::numeric, 0.00, 'partial: no credit');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ben B', 'Ben Mom')).status, 'partial', 'charge part paid');
SELECT pg_temp.eq((pg_temp.acct('d0000000-0000-0000-0000-000000000002', 'Ben Mom') ->> 'due')::numeric, 92.50, 'rest still due');

INSERT INTO rc SELECT 'p2', billing_receive_payment('d0000000-0000-0000-0000-000000000002', jsonb_build_object('payer_id', pg_temp.payer('Ben B', 'Ben Mom'), 'amount', '200', 'method', 'credit_card', 'card_brand', 'Visa', 'last4', '4242', 'reference', 'AUTH 81723'));
SELECT pg_temp.eq(((SELECT v FROM rc WHERE k = 'p2') ->> 'applied')::numeric, 92.50, 'pays what is due');
SELECT pg_temp.eq(((SELECT v FROM rc WHERE k = 'p2') ->> 'credit')::numeric, 107.50, 'the rest is credit');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ben B', 'Ben Mom')).status, 'paid', 'charge paid');
SELECT pg_temp.eq((pg_temp.acct('d0000000-0000-0000-0000-000000000002', 'Ben Mom') ->> 'credit')::numeric, 107.50, 'credit on the card');
SELECT pg_temp.eq((SELECT count(*) FROM jsonb_array_elements(billing_child_account('d0000000-0000-0000-0000-000000000002') -> 'receipts'))::int, 2, 'payments listed');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM child_audit_log WHERE summary LIKE 'Payment received: $200.00 by credit card ····4242%kept as credit%'), 'logged');
SELECT pg_temp.fails(format($$SELECT billing_payment_void(%L, 'x')$$, (SELECT id FROM billing_payments WHERE receipt_id = ((SELECT v FROM rc WHERE k = 'p2') ->> 'receipt_id')::uuid LIMIT 1)), 'Payment card');

-- Ava's mom pays $50 ahead (nothing due): all credit
INSERT INTO rc SELECT 'p3', billing_receive_payment('d0000000-0000-0000-0000-000000000001', jsonb_build_object('payer_id', pg_temp.payer('Ava A', 'Ava Mom'), 'amount', '50', 'method', 'debit_card'));
SELECT pg_temp.eq(((SELECT v FROM rc WHERE k = 'p3') ->> 'credit')::numeric, 50.00, 'advance payment is credit');

-- 4. The next billing run uses the credit ---------------------------------------------------------------------
DO $$
DECLARE p jsonb := billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm() + 7);
BEGIN
  PERFORM pg_temp.eq((p -> 'credits' ->> pg_temp.payer('Ben B', 'Ben Mom')::text)::numeric, 107.50, 'preview shows Ben Mom credit');
  PERFORM pg_temp.eq((p -> 'credits' ->> pg_temp.payer('Ava A', 'Ava Mom')::text)::numeric, 50.00, 'preview shows Ava Mom credit');
  INSERT INTO r SELECT 'w3', billing_run_submit('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm() + 7, (p -> 'totals' ->> 'total')::numeric);
END $$;
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w3'), 'Ben B', 'Ben Mom')).paid_amount, 107.50, 'credit paid part of the new charge');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w3'), 'Ben B', 'Ben Mom')).status, 'partial', 'rest due');
SELECT pg_temp.eq((pg_temp.acct('d0000000-0000-0000-0000-000000000002', 'Ben Mom') ->> 'credit')::numeric, 0.00, 'credit used up');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w3'), 'Ava A', 'Ava Mom')).status, 'ach_scheduled', 'ACH still drafts the rest');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w3'), 'Ava A', 'Ava Mom')).paid_amount, 50.00, 'credit applied before the draft');
SELECT pg_temp.eq((SELECT credit_total FROM billing_runs WHERE id = (SELECT id FROM r WHERE k = 'w3')), 157.50, 'run: paid from credit');
SELECT pg_temp.eq((SELECT ach_total FROM billing_runs WHERE id = (SELECT id FROM r WHERE k = 'w3')), 326.50, 'run: ACH less credit (Hal 285 + Ava 91.50 - 50)');

SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');   -- Olive, owner
SELECT pg_temp.eq((billing_ach_export((pg_temp.charge((SELECT id FROM r WHERE k = 'w3'), 'Ava A', 'Ava Mom')).ach_batch_id) -> 'items' -> 0 ->> 'amount')::numeric, 41.50, 'bank file drafts the rest only');

-- A payment covering a queued draft takes it out of the batch (and the downloaded file is now out of date)
INSERT INTO rc SELECT 'p4', billing_receive_payment('d0000000-0000-0000-0000-000000000001', jsonb_build_object('payer_id', pg_temp.payer('Ava A', 'Ava Mom'), 'amount', '41.50', 'method', 'cash'));
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w3'), 'Ava A', 'Ava Mom')).status, 'paid', 'paid at the center');
SELECT pg_temp.ok((pg_temp.charge((SELECT id FROM r WHERE k = 'w3'), 'Ava A', 'Ava Mom')).ach_batch_id IS NULL, 'out of the ACH batch');
SELECT pg_temp.eq((SELECT file_stale FROM billing_ach_batches WHERE run_id = (SELECT id FROM r WHERE k = 'w3')), true, 'file flagged out of date');

-- 5. Voiding ---------------------------------------------------------------------------------------------------
SELECT pg_temp.fails(format($$SELECT billing_receipt_void(%L, ' ')$$, (SELECT v FROM rc WHERE k = 'p2') ->> 'receipt_id'), 'reason');
SELECT billing_receipt_void(((SELECT v FROM rc WHERE k = 'p2') ->> 'receipt_id')::uuid, 'Card declined after all');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ben B', 'Ben Mom')).paid_amount, 50.00, 'void undoes what it paid');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w3'), 'Ben B', 'Ben Mom')).status, 'open', '... including the credit it gave');
SELECT pg_temp.eq((pg_temp.acct('d0000000-0000-0000-0000-000000000002', 'Ben Mom') ->> 'due')::numeric, 235.00, 'due again');
SELECT pg_temp.fails(format($$SELECT billing_receipt_void(%L, 'again')$$, (SELECT v FROM rc WHERE k = 'p2') ->> 'receipt_id'), 'already voided');

-- Voiding a run gives back the credit it used (the cash payment p4 blocks it until voided)
SELECT pg_temp.fails(format($$SELECT billing_run_void(%L, 'wrong week')$$, (SELECT id FROM r WHERE k = 'w3')), 'Payments were recorded');
SELECT billing_receipt_void(((SELECT v FROM rc WHERE k = 'p4') ->> 'receipt_id')::uuid, 'Test');
SELECT billing_run_void((SELECT id FROM r WHERE k = 'w3'), 'wrong week');
SELECT pg_temp.eq((pg_temp.acct('d0000000-0000-0000-0000-000000000001', 'Ava Mom') ->> 'credit')::numeric, 50.00, 'credit back after run void');

-- 6. Access ----------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
SELECT pg_temp.eq((SELECT count(*) FROM billing_receipts)::int, 0, 'no dashboard access: no receipts');
SELECT pg_temp.fails($$SELECT billing_child_account('d0000000-0000-0000-0000-000000000001')$$, 'do not have access');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
SELECT pg_temp.fails(format($$SELECT billing_receive_payment('d0000000-0000-0000-0000-000000000001', jsonb_build_object('payer_id', %L, 'amount', '1', 'method', 'cash'))$$, pg_temp.payer('Ava A', 'Ava Mom')), 'not turned on');
SELECT pg_temp.fails($$INSERT INTO billing_receipts (center_id, child_id, payer_id, payer_name, amount, method, received_on) SELECT center_id, child_id, id, 'x', 1, 'cash', current_date FROM child_payment_payers LIMIT 1$$, 'permission denied');

-- 7. Prepay: next week's run (made today) includes a child who starts Wednesday of that week --------------------
RESET ROLE;
SELECT pg_temp.as_user(NULL);
INSERT INTO children (id, center_id, first_name, last_name, status, enrolled_on) VALUES
  ('d0000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 'Joy', 'J', 'enrolled', pg_temp.nm() + 23);
INSERT INTO child_tuition (center_id, child_id, fee_id, start_date) VALUES
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000010', 'f0000000-0000-0000-0000-000000000001', pg_temp.nm() + 23);
INSERT INTO child_payment_payers (center_id, child_id, payer_name, share_type, method, effective_from)
VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000010', 'Joy Mom', 'remainder', 'check', pg_temp.today());
SET ROLE authenticated;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.ok(pg_temp.kid(billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm() + 14), 'Joy J') IS NULL, 'not in the week before she starts');
SELECT pg_temp.eq((pg_temp.kid(billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm() + 21), 'Joy J') ->> 'total')::numeric, 285.00, 'starts Wednesday: billed the full week in advance');
SELECT pg_temp.eq((SELECT c ->> 'payer_name' FROM jsonb_array_elements(pg_temp.kid(billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm() + 21), 'Joy J') -> 'charges') c), 'Joy Mom', 'her payer gets the charge');
SELECT pg_temp.eq((pg_temp.kid(billing_preview('10000000-0000-0000-0000-000000000001', 'monthly', pg_temp.nm() + 23), 'Joy J') ->> 'billable')::boolean, false, 'weekly fee not in a monthly run');

RESET ROLE;
SELECT 'RECEIPTS ALL PASSED' AS result;

-- Database tests for Run Billing (20270111000000_billing_runs.sql), on a throwaway local Postgres:
--   createdb bil && psql -q -d bil -f scripts/tuition/stub.sql \
--     -f supabase/migrations/20270109000000_tuition_fees.sql -f supabase/migrations/20270109100000_tuition_bank_details.sql \
--     -f supabase/migrations/20270110000000_center_bank_account.sql -f supabase/migrations/20270111000000_billing_runs.sql \
--     -f scripts/billing/billing.test.sql
-- It prints ALL PASSED or stops at the first failed check. Dates are relative to today (next Monday, next month).
\set ON_ERROR_STOP on

CREATE FUNCTION pg_temp.ok(cond boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', what; END IF; END $$;
CREATE FUNCTION pg_temp.eq(got anyelement, want anyelement, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL: % (got %, want %)', what, got, want; END IF; END $$;
CREATE FUNCTION pg_temp.fails(q text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RAISE EXCEPTION 'FAIL: expected an error like "%" from: %', pat, q;
EXCEPTION WHEN others THEN
  IF SQLERRM LIKE 'FAIL:%' OR SQLERRM NOT ILIKE '%' || pat || '%' THEN RAISE EXCEPTION 'FAIL: % (got: %)', q, SQLERRM; END IF;
END $$;
CREATE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(u, ''), false), set_config('request.jwt.claims', '{}', false) $$;
CREATE FUNCTION pg_temp.today() RETURNS date LANGUAGE sql AS $$ SELECT public.roster_today('10000000-0000-0000-0000-000000000001') $$;
CREATE FUNCTION pg_temp.nm() RETURNS date LANGUAGE sql AS $$ SELECT date_trunc('week', pg_temp.today())::date + 7 $$;            -- next Monday
CREATE FUNCTION pg_temp.nmo() RETURNS date LANGUAGE sql AS $$ SELECT (date_trunc('month', pg_temp.today()) + interval '1 month')::date $$; -- next 1st
-- a child's preview entry
CREATE FUNCTION pg_temp.kid(p jsonb, name text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(p -> 'children') e WHERE e ->> 'name' = name $$;
CREATE FUNCTION pg_temp.charge(run uuid, child text, payer text) RETURNS billing_charges LANGUAGE sql SECURITY DEFINER AS $$
  SELECT c.* FROM billing_charges c JOIN billing_bills b ON b.id = c.bill_id
  WHERE c.run_id = run AND b.child_name = child AND c.payer_name = payer $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- People: Olive (owner A), Dan (admin A), Tess (no dashboard access), Bea (owner B)
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'olive@a.test'), ('a0000000-0000-0000-0000-000000000002', 'dan@a.test'),
  ('a0000000-0000-0000-0000-000000000003', 'tess@a.test'), ('a0000000-0000-0000-0000-000000000004', 'bea@b.test');
INSERT INTO centers (id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A'), ('10000000-0000-0000-0000-000000000002', 'Center B');
UPDATE centers SET tuition_enabled = true;
INSERT INTO center_admins VALUES
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner'),
  ('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'owner');
INSERT INTO work_areas (id, center_id, name) VALUES ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Room 1');

-- Rate card
INSERT INTO tuition_fees (id, center_id, name, kind, frequency) VALUES
  ('f0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Full-time', 'tuition', 'weekly'),
  ('f0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Before care', 'activity', 'weekly'),
  ('f0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Preschool monthly', 'tuition', 'monthly'),
  ('f0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Registration', 'registration', 'one_time'),
  ('f0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Biweekly care', 'tuition', 'biweekly');
INSERT INTO tuition_fee_rates (center_id, fee_id, amount, effective_from)
SELECT '10000000-0000-0000-0000-000000000001', f, a, '2026-01-01' FROM (VALUES
  ('f0000000-0000-0000-0000-000000000001'::uuid, 285), ('f0000000-0000-0000-0000-000000000002'::uuid, 45),
  ('f0000000-0000-0000-0000-000000000003'::uuid, 1000), ('f0000000-0000-0000-0000-000000000004'::uuid, 100),
  ('f0000000-0000-0000-0000-000000000005'::uuid, 500)) v(f, a);

-- Children (d…01 Ava, 02 Ben, 03 Cal, 04 Dee starts later, 05 Eve withdrawn, 06 Fay monthly, 07 Gus no fees, 08 Hal, 09 Ivy biweekly)
INSERT INTO children (id, center_id, first_name, last_name, classroom_id, status, enrolled_on, withdrawn_on) VALUES
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Ava', 'A', 'c0000000-0000-0000-0000-000000000001', 'enrolled', pg_temp.today(), NULL),
  ('d0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Ben', 'B', NULL, 'enrolled', pg_temp.today(), NULL),
  ('d0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Cal', 'C', NULL, 'enrolled', pg_temp.today(), NULL),
  ('d0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Dee', 'D', NULL, 'enrolled', pg_temp.nm() + 10, NULL),
  ('d0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Eve', 'E', NULL, 'withdrawn', pg_temp.today() - 100, pg_temp.today() - 30),
  ('d0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'Fay', 'F', NULL, 'enrolled', pg_temp.today(), NULL),
  ('d0000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'Gus', 'G', NULL, 'enrolled', pg_temp.today(), NULL);

INSERT INTO child_tuition (center_id, child_id, fee_id, start_date, end_date, discount_type, discount_value, discount_reason) VALUES
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', pg_temp.nm(), NULL, 'percent', 10, 'Sibling'),
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', pg_temp.nm(), NULL, NULL, NULL, NULL),
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', pg_temp.nm(), NULL, NULL, NULL, NULL),
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', pg_temp.nm(), NULL, NULL, NULL, NULL),
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000004', pg_temp.nm() + 2, pg_temp.nm() + 2, NULL, NULL, NULL),
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000001', pg_temp.nm() + 10, NULL, NULL, NULL, NULL),
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000003', pg_temp.today(), NULL, NULL, NULL, NULL);

-- Who pays. Ava: subsidy $210/week (other) + Mom the rest by ACH (ready). Ben: Mom 50% ACH (no authorization) + Dad 50% card.
-- Cal: nobody. Fay: Dad the rest by check.
INSERT INTO child_payment_payers (center_id, child_id, payer_name, payer_kind, share_type, share_value, fixed_frequency, method,
  routing_number, account_number_enc, last4, account_type, authorization_on_file, effective_from, sort_order) VALUES
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'NC subsidy', 'subsidy', 'fixed', 210, 'weekly', 'other', NULL, NULL, NULL, NULL, false, pg_temp.today(), 1),
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Ava Mom', 'family', 'remainder', NULL, NULL, 'ach', '021000021', 'v1:aa:bb:cc', '4417', 'checking', true, pg_temp.today(), 2),
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'Ben Mom', 'family', 'percent', 50, NULL, 'ach', '021000021', 'v1:aa:bb:dd', '1111', 'savings', false, pg_temp.today(), 1),
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'Ben Dad', 'family', 'percent', 50, NULL, 'credit_card', NULL, NULL, '2222', NULL, false, pg_temp.today(), 2),
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006', 'Fay Dad', 'family', 'remainder', NULL, NULL, 'check', NULL, NULL, NULL, NULL, false, pg_temp.today(), 1);

SET ROLE authenticated;

-- 1. Access ----------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
SELECT pg_temp.fails($$SELECT billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm())$$, 'not turned on');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
SELECT pg_temp.fails($$SELECT billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm())$$, 'not turned on');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.fails($$INSERT INTO billing_runs (center_id, frequency, period_start, period_end) VALUES ('10000000-0000-0000-0000-000000000001', 'weekly', '2026-01-05', '2026-01-11')$$, 'permission denied');
SELECT pg_temp.fails($$SELECT billing_preview('10000000-0000-0000-0000-000000000001', 'daily', pg_temp.nm())$$, 'weekly or monthly');

-- 2. Weekly preview --------------------------------------------------------------------------------------------
DO $$
DECLARE p jsonb := billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm() + 3);
BEGIN
  PERFORM pg_temp.eq((p ->> 'period_start')::date, pg_temp.nm(), 'window snaps to Monday');
  PERFORM pg_temp.eq((p ->> 'period_end')::date, pg_temp.nm() + 6, 'window ends Sunday');
  PERFORM pg_temp.ok(pg_temp.kid(p, 'Dee D') IS NULL, 'child starting after the window is left out');
  PERFORM pg_temp.ok(pg_temp.kid(p, 'Eve E') IS NULL, 'child withdrawn before the window is left out');
  PERFORM pg_temp.eq((pg_temp.kid(p, 'Gus G') ->> 'billable')::boolean, false, 'child without fees listed, not billable');
  PERFORM pg_temp.eq((pg_temp.kid(p, 'Fay F') ->> 'billable')::boolean, false, 'monthly-only child not billed weekly');
  PERFORM pg_temp.eq((pg_temp.kid(p, 'Ava A') ->> 'list')::numeric, 330.00, 'Ava billing amount');
  PERFORM pg_temp.eq((pg_temp.kid(p, 'Ava A') ->> 'discount')::numeric, 28.50, 'Ava discount');
  PERFORM pg_temp.eq((pg_temp.kid(p, 'Ava A') ->> 'total')::numeric, 301.50, 'Ava total');
  PERFORM pg_temp.eq((SELECT (c ->> 'amount')::numeric FROM jsonb_array_elements(pg_temp.kid(p, 'Ava A') -> 'charges') c WHERE c ->> 'payer_name' = 'NC subsidy'), 210.00, 'subsidy share');
  PERFORM pg_temp.eq((SELECT (c ->> 'amount')::numeric FROM jsonb_array_elements(pg_temp.kid(p, 'Ava A') -> 'charges') c WHERE c ->> 'payer_name' = 'Ava Mom'), 91.50, 'mom gets the rest');
  PERFORM pg_temp.eq((SELECT (c ->> 'ach_ready')::boolean FROM jsonb_array_elements(pg_temp.kid(p, 'Ava A') -> 'charges') c WHERE c ->> 'payer_name' = 'Ava Mom'), true, 'ACH ready');
  PERFORM pg_temp.eq((SELECT (c ->> 'ach_ready')::boolean FROM jsonb_array_elements(pg_temp.kid(p, 'Ben B') -> 'charges') c WHERE c ->> 'payer_name' = 'Ben Mom'), false, 'ACH without authorization not drafted');
  PERFORM pg_temp.ok((SELECT c ->> 'problem' FROM jsonb_array_elements(pg_temp.kid(p, 'Ben B') -> 'charges') c WHERE c ->> 'payer_name' = 'Ben Mom') ILIKE '%authorization%', 'says why');
  PERFORM pg_temp.eq((pg_temp.kid(p, 'Cal C') ->> 'total')::numeric, 385.00, 'Cal tuition + registration (one-time in window)');
  PERFORM pg_temp.eq((SELECT c ->> 'method' FROM jsonb_array_elements(pg_temp.kid(p, 'Cal C') -> 'charges') c), 'unassigned', 'no payer = unassigned charge');
  PERFORM pg_temp.eq((p -> 'totals' ->> 'total')::numeric, 971.50, 'grand total weekly');
  PERFORM pg_temp.eq((p -> 'totals' ->> 'list')::numeric, 1000.00, 'total billing amount');
  PERFORM pg_temp.eq((p -> 'totals' ->> 'discount')::numeric, 28.50, 'total discount');
  PERFORM pg_temp.eq((p -> 'totals' ->> 'ach_total')::numeric, 91.50, 'ACH total');
  PERFORM pg_temp.eq((p -> 'totals' ->> 'ach_count')::int, 1, 'ACH count');
  PERFORM pg_temp.eq((p -> 'totals' ->> 'manual_total')::numeric, 880.00, 'manual total');
  PERFORM pg_temp.eq((p -> 'totals' ->> 'unassigned_total')::numeric, 385.00, 'unassigned total');
  PERFORM pg_temp.eq((p -> 'totals' ->> 'billable')::int, 3, 'billable children');
  PERFORM pg_temp.eq((p -> 'totals' -> 'by_frequency' ->> 'one_time')::numeric, 100.00, 'one-time total');
END $$;

-- 3. Submit ----------------------------------------------------------------------------------------------------
SELECT pg_temp.fails($$SELECT billing_run_submit('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm(), 900)$$, 'changed since you looked');
SELECT pg_temp.fails($$SELECT billing_run_submit('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm(), 971.50, pg_temp.today() - 1)$$, 'before today');
CREATE TEMP TABLE r (k text PRIMARY KEY, id uuid);
GRANT ALL ON r TO PUBLIC;
INSERT INTO r SELECT 'w1', billing_run_submit('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm() + 4, 971.50, pg_temp.nm(), 'First run');
SELECT pg_temp.eq((SELECT count(*) FROM billing_bills WHERE run_id = (SELECT id FROM r WHERE k = 'w1'))::int, 3, 'three bills');
SELECT pg_temp.eq((SELECT total FROM billing_runs WHERE id = (SELECT id FROM r WHERE k = 'w1')), 971.50, 'run total');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).status, 'ach_scheduled', 'ACH queued');
SELECT pg_temp.ok((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).ach_batch_id IS NOT NULL, 'in the batch');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'NC subsidy')).status, 'open', 'subsidy open');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ben B', 'Ben Mom')).status, 'open', 'ACH not ready stays open');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Cal C', 'No payer set')).amount, 385.00, 'unassigned charge');
SELECT pg_temp.eq((SELECT draft_date FROM billing_ach_batches WHERE run_id = (SELECT id FROM r WHERE k = 'w1')), pg_temp.nm(), 'draft date');
SELECT pg_temp.ok((SELECT count(*) FROM child_audit_log WHERE table_name = 'billing_bills' AND summary LIKE 'Billed week of%') = 3, 'bills logged in Activity');

-- The same week can't be billed twice
DO $$
DECLARE p jsonb := billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm());
BEGIN
  PERFORM pg_temp.eq((p -> 'totals' ->> 'billable')::int, 0, 'nothing left to bill');
  PERFORM pg_temp.eq(jsonb_array_length(pg_temp.kid(p, 'Ava A') -> 'skipped'), 1, 'Ava shows as already billed');
  PERFORM pg_temp.eq(jsonb_array_length(p -> 'runs'), 1, 'existing run listed');
END $$;
SELECT pg_temp.fails($$SELECT billing_run_submit('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm(), 0)$$, 'already billed');

-- A child added after the week was billed is not billed in it (one run per window); Hal is billed this week instead
RESET ROLE;
INSERT INTO children (id, center_id, first_name, last_name, status, enrolled_on) VALUES
  ('d0000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'Hal', 'H', 'enrolled', pg_temp.today());
INSERT INTO child_tuition (center_id, child_id, fee_id, start_date) VALUES
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000001', pg_temp.today());
INSERT INTO child_payment_payers (center_id, child_id, payer_name, share_type, method, routing_number, account_number_enc, last4, account_type, authorization_on_file, effective_from)
VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000008', 'Hal Mom', 'remainder', 'ach', '021000021', 'v1:aa:bb:ee', '3333', 'checking', true, pg_temp.today());
SET ROLE authenticated;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.fails($$SELECT billing_run_submit('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm(), 285)$$, 'void that run first');
SELECT pg_temp.eq((billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.today()) -> 'totals' ->> 'total')::numeric, 285.00, 'this week: only Hal');
INSERT INTO r SELECT 'w2', billing_run_submit('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.today(), 285);
SELECT pg_temp.eq((SELECT child_count FROM billing_runs WHERE id = (SELECT id FROM r WHERE k = 'w2')), 1, 'run bills Hal only');

-- 4. Payments --------------------------------------------------------------------------------------------------
SELECT billing_payment_record((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ben B', 'Ben Dad')).id,
  '{"amount":"100","method":"check","reference":"1042"}');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ben B', 'Ben Dad')).status, 'partial', 'partial payment');
SELECT pg_temp.fails(format($$SELECT billing_payment_record(%L, '{"amount":"50","method":"cash"}')$$,
  (pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ben B', 'Ben Dad')).id), 'more than the $42.50');
SELECT pg_temp.fails(format($$SELECT billing_payment_record(%L, '{"amount":"10","method":"ach"}')$$,
  (pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ben B', 'Ben Dad')).id), 'Pick how it was paid');
SELECT pg_temp.fails(format($$SELECT billing_payment_record(%L, jsonb_build_object('amount', '1', 'method', 'cash', 'received_on', pg_temp.today() + 1))$$,
  (pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ben B', 'Ben Dad')).id), 'future');
SELECT billing_payment_record((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ben B', 'Ben Dad')).id, '{"amount":"42.50","method":"credit_card"}');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ben B', 'Ben Dad')).status, 'paid', 'paid in full');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ben B', 'Ben Dad')).paid_amount, 142.50, 'paid amount');

-- Hal's family paid cash before the draft went out: the draft comes out of the batch
SELECT billing_payment_record((pg_temp.charge((SELECT id FROM r WHERE k = 'w2'), 'Hal H', 'Hal Mom')).id, '{"amount":"285","method":"cash"}');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w2'), 'Hal H', 'Hal Mom')).status, 'paid', 'cash paid');
SELECT pg_temp.ok((pg_temp.charge((SELECT id FROM r WHERE k = 'w2'), 'Hal H', 'Hal Mom')).ach_batch_id IS NULL, 'taken out of the ACH batch');

-- 5. ACH batch -------------------------------------------------------------------------------------------------
SELECT pg_temp.fails(format($$SELECT billing_ach_export(%L)$$, (pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).ach_batch_id), 'Only the center''s owner');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SELECT pg_temp.fails(format($$SELECT billing_ach_export(%L)$$, (pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).ach_batch_id), 'bank account first');
SELECT pg_temp.fails(format($$SELECT billing_ach_batch_mark(%L, 'sent')$$, (pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).ach_batch_id), 'Download the ACH file');
RESET ROLE;
INSERT INTO center_bank_accounts (center_id, account_holder_name, bank_name, account_type, routing_number, account_number_enc, last4)
VALUES ('10000000-0000-0000-0000-000000000001', 'Center A LLC', 'Truist', 'checking', '011000015', 'v1:cc:dd:ee', '9999');
SET ROLE authenticated;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
DO $$
DECLARE b uuid := (pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).ach_batch_id; x jsonb;
BEGIN
  x := billing_ach_export(b);
  PERFORM pg_temp.eq(jsonb_array_length(x -> 'items'), 1, 'one draft in the file');
  PERFORM pg_temp.eq((x -> 'items' -> 0 ->> 'amount')::numeric, 91.50, 'draft amount');
  PERFORM pg_temp.eq(x -> 'items' -> 0 ->> 'account_number_enc', 'v1:aa:bb:cc', 'encrypted account for the server');
  PERFORM pg_temp.eq(x -> 'bank' ->> 'routing_number', '011000015', 'center bank');
  PERFORM pg_temp.eq((SELECT status FROM billing_ach_batches WHERE id = b), 'exported', 'batch exported');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM child_audit_log WHERE summary LIKE 'ACH file downloaded%'), 'download logged');
  PERFORM billing_ach_batch_mark(b, 'sent');
  PERFORM pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).status, 'ach_sent', 'draft sent');
  PERFORM pg_temp.fails(format($q$SELECT billing_payment_record(%L, '{"amount":"10","method":"cash"}')$q$,
    (pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).id), 'already sent');
  PERFORM pg_temp.fails(format($q$SELECT billing_ach_export(%L)$q$, b), 'already sent');
  PERFORM billing_ach_batch_mark(b, 'settled');
  PERFORM pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).status, 'paid', 'cleared = paid');
END $$;

-- Return after clearing: payment reversed, balance due again, then collected by hand
SELECT pg_temp.fails(format($$SELECT billing_charge_ach_return(%L, 'X1')$$, (pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).id), 'return code');
SELECT billing_charge_ach_return((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).id, 'r01', 'NSF');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).status, 'returned', 'returned');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).paid_amount, 0.00, 'reversed');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).ach_return_code, 'R01', 'code kept');
SELECT billing_payment_record((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).id, '{"amount":"91.50","method":"cash"}');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w1'), 'Ava A', 'Ava Mom')).status, 'paid', 'paid by hand after return');

-- 6. Void a run ------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.fails(format($$SELECT billing_run_void(%L, 'oops')$$, (SELECT id FROM r WHERE k = 'w2')), 'Only the center''s owner');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SELECT pg_temp.fails(format($$SELECT billing_run_void(%L, 'oops')$$, (SELECT id FROM r WHERE k = 'w1')), 'already sent');
SELECT pg_temp.fails(format($$SELECT billing_run_void(%L, 'oops')$$, (SELECT id FROM r WHERE k = 'w2')), 'Payments were recorded');
SELECT pg_temp.fails(format($$SELECT billing_payment_void(%L, '')$$, (SELECT p.id FROM billing_payments p JOIN billing_charges c ON c.id = p.charge_id WHERE c.run_id = (SELECT id FROM r WHERE k = 'w2'))), 'reason');
SELECT billing_payment_void((SELECT p.id FROM billing_payments p JOIN billing_charges c ON c.id = p.charge_id WHERE c.run_id = (SELECT id FROM r WHERE k = 'w2')), 'Entered on the wrong child');
SELECT pg_temp.eq((pg_temp.charge((SELECT id FROM r WHERE k = 'w2'), 'Hal H', 'Hal Mom')).status, 'open', 'open again after void');
SELECT billing_run_void((SELECT id FROM r WHERE k = 'w2'), 'Billed by mistake');
SELECT pg_temp.eq((SELECT status FROM billing_runs WHERE id = (SELECT id FROM r WHERE k = 'w2')), 'void', 'run voided');
SELECT pg_temp.eq((billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.today()) -> 'totals' ->> 'total')::numeric, 285.00, 'voided period can be billed again');

-- 7. Monthly run: monthly fees only -----------------------------------------------------------------------------
DO $$
DECLARE p jsonb := billing_preview('10000000-0000-0000-0000-000000000001', 'monthly', pg_temp.nmo() + 9);
BEGIN
  PERFORM pg_temp.eq((p ->> 'period_start')::date, pg_temp.nmo(), 'month starts on the 1st');
  PERFORM pg_temp.eq((p -> 'totals' ->> 'total')::numeric, 1000.00, 'grand total monthly');
  PERFORM pg_temp.eq((p -> 'totals' ->> 'billable')::int, 1, 'only Fay has monthly fees');
  PERFORM pg_temp.eq((SELECT c ->> 'method' FROM jsonb_array_elements(pg_temp.kid(p, 'Fay F') -> 'charges') c), 'check', 'Fay pays by check');
END $$;
INSERT INTO r SELECT 'm1', billing_run_submit('10000000-0000-0000-0000-000000000001', 'monthly', pg_temp.nmo(), 1000);
SELECT pg_temp.ok((SELECT count(*) FROM billing_ach_batches WHERE run_id = (SELECT id FROM r WHERE k = 'm1')) = 0, 'no ACH batch without ACH drafts');

-- 8. Biweekly fees ride on the weekly run of the week their period starts ---------------------------------------
RESET ROLE;
INSERT INTO children (id, center_id, first_name, last_name, status, enrolled_on) VALUES
  ('d0000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'Ivy', 'I', 'enrolled', pg_temp.nm());
INSERT INTO child_tuition (center_id, child_id, fee_id, start_date) VALUES
  ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-000000000005', pg_temp.nm());
SET ROLE authenticated;
SELECT pg_temp.eq((pg_temp.kid(billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm()), 'Ivy I') ->> 'total')::numeric, 500.00, 'biweekly billed in its first week');
SELECT pg_temp.eq((pg_temp.kid(billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm() + 7), 'Ivy I') ->> 'billable')::boolean, false, 'not in its second week');
SELECT pg_temp.eq((pg_temp.kid(billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm() + 14), 'Ivy I') ->> 'total')::numeric, 500.00, 'again two weeks later');

-- 9. Child history and year to date -----------------------------------------------------------------------------
DO $$
DECLARE h jsonb := billing_child_history('d0000000-0000-0000-0000-000000000001', extract(year FROM pg_temp.nm())::int);
BEGIN
  PERFORM pg_temp.eq(jsonb_array_length(h -> 'bills'), 1, 'one bill in history');
  PERFORM pg_temp.eq((h -> 'ytd' ->> 'list')::numeric, 330.00, 'YTD bill amount');
  PERFORM pg_temp.eq((h -> 'ytd' ->> 'discount')::numeric, 28.50, 'YTD discount');
  PERFORM pg_temp.eq((h -> 'ytd' ->> 'total')::numeric, 301.50, 'YTD total');
  PERFORM pg_temp.eq((h -> 'ytd' ->> 'paid')::numeric, 91.50, 'YTD paid (subsidy still open)');
  PERFORM pg_temp.eq((h -> 'ytd' ->> 'balance')::numeric, 210.00, 'YTD balance');
  PERFORM pg_temp.eq(jsonb_array_length(h -> 'bills' -> 0 -> 'charges' -> 1 -> 'payments'), 3, 'mom (2nd payer): ACH, return, cash');
  PERFORM pg_temp.eq(h -> 'bills' -> 0 -> 'charges' -> 0 ->> 'payer_name', 'NC subsidy', 'charges in payer order');
  PERFORM pg_temp.eq(0, 0, 'mom: ACH, return, cash');
END $$;
DO $$
DECLARE h jsonb := billing_child_history('d0000000-0000-0000-0000-000000000008', extract(year FROM pg_temp.nm())::int);
BEGIN
  PERFORM pg_temp.eq((h -> 'ytd' ->> 'total')::numeric, 0.00, 'voided bills are not in YTD');
  PERFORM pg_temp.eq((h -> 'bills' -> 0 ->> 'voided')::boolean, true, 'voided bill still shown');
END $$;
SELECT pg_temp.eq(jsonb_array_length(billing_runs_list('10000000-0000-0000-0000-000000000001')), 3, 'run list');
SELECT pg_temp.eq((billing_run_get((SELECT id FROM r WHERE k = 'w1')) -> 'run' ->> 'balance')::numeric, 737.50, 'run balance: subsidy 210 + Ben Mom 142.50 + Cal 385');

-- 10. RLS -------------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
SELECT pg_temp.eq((SELECT count(*) FROM billing_bills)::int, 0, 'no dashboard access: no bills');
SELECT pg_temp.fails($$SELECT billing_child_history('d0000000-0000-0000-0000-000000000001')$$, 'do not have access');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
SELECT pg_temp.eq((SELECT count(*) FROM billing_payments)::int, 0, 'other center: no payments');
SELECT pg_temp.fails(format($$SELECT billing_run_get(%L)$$, (SELECT id FROM r WHERE k = 'w1')), 'not found');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.ok((SELECT count(*) FROM billing_bills) > 0, 'admin reads bills');
SELECT pg_temp.fails($$UPDATE billing_charges SET paid_amount = amount$$, 'permission denied');

-- Tuition off: billing off too
RESET ROLE;
SELECT pg_temp.as_user(NULL);   -- the module switch only changes without a signed-in user (or for a super admin)
UPDATE centers SET tuition_enabled = false WHERE id = '10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT pg_temp.fails($$SELECT billing_preview('10000000-0000-0000-0000-000000000001', 'weekly', pg_temp.nm())$$, 'not turned on');

RESET ROLE;
SELECT 'ALL PASSED' AS result;

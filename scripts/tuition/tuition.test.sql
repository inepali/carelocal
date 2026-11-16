-- Database tests for tuition fees and payment (20270109000000_tuition_fees.sql), on a throwaway local Postgres:
--   createdb tui && psql -q -d tui -f scripts/tuition/stub.sql \
--     -f supabase/migrations/20270109000000_tuition_fees.sql -f scripts/tuition/tuition.test.sql
-- It prints ALL PASSED or stops at the first failed check.
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
CREATE FUNCTION pg_temp.as_user(u text, claims text DEFAULT '{}') RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(u, ''), false), set_config('request.jwt.claims', claims, false) $$;
CREATE FUNCTION pg_temp.today() RETURNS date LANGUAGE sql AS $$ SELECT public.roster_today('10000000-0000-0000-0000-000000000001') $$;
-- next Monday
CREATE FUNCTION pg_temp.nm() RETURNS date LANGUAGE sql AS $$ SELECT date_trunc('week', pg_temp.today())::date + 7 $$;
-- net amount of a child's fee in the period holding a day
CREATE FUNCTION pg_temp.net(child text, fee text, d date) RETURNS numeric LANGUAGE sql SECURITY DEFINER AS $$
  SELECT l.net_amount FROM public.tuition_lines(child::uuid, d) l WHERE l.fee_name = fee $$;
CREATE FUNCTION pg_temp.list(child text, fee text, d date) RETURNS numeric LANGUAGE sql SECURITY DEFINER AS $$
  SELECT l.list_amount FROM public.tuition_lines(child::uuid, d) l WHERE l.fee_name = fee $$;
-- a payer's amount in the split for a frequency
CREATE FUNCTION pg_temp.paid(child text, d date, freq text, who text) RETURNS numeric LANGUAGE sql SECURITY DEFINER AS $$
  SELECT (p ->> 'amount')::numeric
  FROM jsonb_array_elements(public.tuition_split(child::uuid, d)) s, jsonb_array_elements(s -> 'payers') p
  JOIN public.child_payment_payers pp ON pp.id = (p ->> 'payer_id')::uuid
  WHERE s ->> 'frequency' = freq AND pp.payer_name = who $$;
CREATE FUNCTION pg_temp.split_of(child text, d date, freq text, k text) RETURNS numeric LANGUAGE sql SECURITY DEFINER AS $$
  SELECT (s ->> k)::numeric FROM jsonb_array_elements(public.tuition_split(child::uuid, d)) s WHERE s ->> 'frequency' = freq $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- People: Olive (owner A), Dan (director = admin A), Tess (no dashboard access), Bea (owner B)
INSERT INTO auth.users (id) SELECT ('a0000000-0000-0000-0000-0000000000' || x)::uuid FROM unnest(ARRAY['01', '02', '03', '04']) x;
INSERT INTO centers (id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A'), ('10000000-0000-0000-0000-000000000002', 'Center B');
UPDATE centers SET tuition_enabled = true;
INSERT INTO center_admins VALUES
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner'),
  ('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'owner');
INSERT INTO center_programs (id, center_id, name, sort_order) VALUES
  ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Toddler', 1),
  ('b0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Preschool', 2),
  ('b0000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'Other center', 1);
INSERT INTO work_areas (id, center_id, name, program_id) VALUES
  ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Toddler A', 'b0000000-0000-0000-0000-000000000001');
-- Mia (since Jan 5 2026, Toddler A) and her brother Leo share Mom's email. Dad is Mia's contact only.
INSERT INTO children (id, center_id, first_name, classroom_id, enrolled_on) VALUES
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Mia', 'c0000000-0000-0000-0000-000000000001', '2026-01-05'),
  ('d0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Leo', NULL, '2026-01-05'),
  ('d0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Ava', NULL, '2026-01-05');
INSERT INTO child_guardians (id, center_id, child_id, name, relationship, email, is_primary) VALUES
  ('e0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Priya', 'Mother', 'Priya@x.com', true),
  ('e0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Raj', 'Father', 'raj@x.com', false),
  ('e0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'Priya S', 'Mother', ' priya@x.com ', true),
  ('e0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'Kim', 'Mother', 'kim@x.com', true);
INSERT INTO child_files (id, center_id, child_id, file_name) VALUES
  ('f0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'ACH form.pdf'),
  ('f0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'Leo form.pdf');

SET ROLE authenticated;

-- 1. Module switch -------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
UPDATE centers SET tuition_enabled = false WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT tuition_enabled FROM centers WHERE id = '10000000-0000-0000-0000-000000000001'), 'only a super admin turns Tuition off');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002', '{"app_metadata":{"is_super_admin":true}}');
UPDATE centers SET tuition_enabled = false WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.fails($$SELECT tuition_fees_list('10000000-0000-0000-0000-000000000001')$$, 'not turned on');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002', '{"app_metadata":{"is_super_admin":true}}');
UPDATE centers SET tuition_enabled = true WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');

-- 2. Rate card -----------------------------------------------------------------------------------------------
SELECT tuition_fee_save('10000000-0000-0000-0000-000000000001',
  '{"program_id":"b0000000-0000-0000-0000-000000000001","name":"Full-time","frequency":"weekly","amount":"285","from":"2026-01-05"}');
SELECT tuition_fee_save('10000000-0000-0000-0000-000000000001',
  '{"program_id":"b0000000-0000-0000-0000-000000000001","name":"After care","frequency":"monthly","amount":"180","from":"2026-01-01"}');
SELECT tuition_fee_save('10000000-0000-0000-0000-000000000001',
  '{"name":"Registration","kind":"registration","frequency":"one_time","amount":"150","from":"2026-01-01"}');
SELECT tuition_fee_save('10000000-0000-0000-0000-000000000001',
  '{"program_id":"b0000000-0000-0000-0000-000000000001","name":"Biweekly","frequency":"biweekly","amount":"500","from":"2026-01-01"}');
SELECT pg_temp.fails($$SELECT tuition_fee_save('10000000-0000-0000-0000-000000000001',
  '{"program_id":"b0000000-0000-0000-0000-000000000001","name":" full-TIME ","frequency":"weekly","amount":"1","from":"2026-01-05"}')$$, 'tuition_fees_name_unique');
SELECT pg_temp.fails($$SELECT tuition_fee_save('10000000-0000-0000-0000-000000000001',
  '{"program_id":"b0000000-0000-0000-0000-000000000009","name":"X","frequency":"weekly","amount":"1","from":"2026-01-05"}')$$, 'another center');
SELECT pg_temp.fails($$SELECT tuition_fee_save('10000000-0000-0000-0000-000000000001', '{"name":"X","frequency":"weekly","from":"2026-01-05"}')$$, 'amount');

CREATE TEMP TABLE ids AS SELECT name, id FROM tuition_fees;
GRANT SELECT ON ids TO PUBLIC;
CREATE FUNCTION pg_temp.fee(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM ids WHERE name = n $$;
GRANT EXECUTE ON FUNCTION pg_temp.fee(text) TO PUBLIC;

-- A price change from next Monday keeps today's price
SELECT tuition_rate_set(pg_temp.fee('Full-time'), 295, pg_temp.nm());
SELECT pg_temp.eq((SELECT (f -> 'current' ->> 'amount')::numeric FROM jsonb_array_elements(tuition_fees_list('10000000-0000-0000-0000-000000000001') -> 'fees') f WHERE f ->> 'name' = 'Full-time'), 285.00, 'current rate');
SELECT pg_temp.eq((SELECT (f -> 'upcoming' ->> 'amount')::numeric FROM jsonb_array_elements(tuition_fees_list('10000000-0000-0000-0000-000000000001') -> 'fees') f WHERE f ->> 'name' = 'Full-time'), 295.00, 'upcoming rate');
SELECT pg_temp.eq((SELECT effective_to FROM tuition_fee_rates WHERE fee_id = pg_temp.fee('Full-time') AND amount = 285), pg_temp.nm() - 1, 'old rate closes the day before');
-- Setting the same start again changes that rate's amount
SELECT tuition_rate_set(pg_temp.fee('Full-time'), 296, pg_temp.nm());
SELECT pg_temp.eq((SELECT count(*) FROM tuition_fee_rates WHERE fee_id = pg_temp.fee('Full-time')), 2::bigint, 'same start edits, no new row');
SELECT tuition_rate_set(pg_temp.fee('Full-time'), 295, pg_temp.nm());
-- A rate inserted between two rates fills only the gap up to the next one
SELECT tuition_rate_set(pg_temp.fee('Full-time'), 310, pg_temp.nm() + 28);
SELECT tuition_rate_set(pg_temp.fee('Full-time'), 300, pg_temp.nm() + 14);
SELECT pg_temp.eq((SELECT effective_to FROM tuition_fee_rates WHERE fee_id = pg_temp.fee('Full-time') AND amount = 300), pg_temp.nm() + 27, 'middle rate stops before the next');
SELECT pg_temp.eq((SELECT effective_to FROM tuition_fee_rates WHERE fee_id = pg_temp.fee('Full-time') AND amount = 295), pg_temp.nm() + 13, '295 stops before 300');

-- Past changes: the owner only, with a reason
SELECT pg_temp.fails($$SELECT tuition_rate_set(pg_temp.fee('Full-time'), 1, pg_temp.today() - 1)$$, 'Only the center''s owner');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SELECT pg_temp.fails($$SELECT tuition_rate_set(pg_temp.fee('Full-time'), 1, pg_temp.today() - 1)$$, 'reason');
SELECT tuition_rate_set(pg_temp.fee('Full-time'), 1, '2026-03-02', 'Test fix');
SELECT pg_temp.eq((SELECT effective_to FROM tuition_fee_rates WHERE fee_id = pg_temp.fee('Full-time') AND amount = 285), '2026-03-01'::date, 'past fix splits the old rate');
SELECT tuition_rate_delete((SELECT id FROM tuition_fee_rates WHERE fee_id = pg_temp.fee('Full-time') AND amount = 1), 'Undo test');
SELECT pg_temp.eq((SELECT effective_to FROM tuition_fee_rates WHERE fee_id = pg_temp.fee('Full-time') AND amount = 285), pg_temp.nm() - 1, 'deleting a rate lets the one before run on');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.fails($$SELECT tuition_rate_delete((SELECT id FROM tuition_fee_rates WHERE fee_id = pg_temp.fee('Full-time') AND amount = 285))$$, 'owner');
SELECT pg_temp.fails($$SELECT tuition_rate_delete((SELECT id FROM tuition_fee_rates WHERE fee_id = pg_temp.fee('Registration')))$$, 'at least one rate');
-- The database itself refuses overlapping rates
RESET ROLE;
SELECT pg_temp.fails($$INSERT INTO tuition_fee_rates (center_id, fee_id, amount, effective_from) VALUES ('10000000-0000-0000-0000-000000000001', pg_temp.fee('Full-time'), 9, '2026-02-02')$$, 'tuition_fee_rates_no_overlap');
SET ROLE authenticated;
-- Nobody writes the tables directly
SELECT pg_temp.fails($$UPDATE tuition_fee_rates SET amount = 0$$, 'permission denied');
SELECT pg_temp.fails($$INSERT INTO child_tuition (center_id, child_id, fee_id, start_date) VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', pg_temp.fee('Full-time'), '2026-01-05')$$, 'permission denied');

-- 3. Fees on a child and the period-start rule -----------------------------------------------------------------
SELECT pg_temp.fails($$SELECT child_tuition_add('d0000000-0000-0000-0000-000000000001', jsonb_build_object('fee_id', pg_temp.fee('Full-time'), 'start', '2025-12-01'))$$, 'before the child''s enrollment');
SELECT child_tuition_add('d0000000-0000-0000-0000-000000000001', jsonb_build_object('fee_id', pg_temp.fee('Full-time'), 'start', '2026-01-05',
  'discount_type', 'percent', 'discount_value', '10', 'discount_reason', 'Sibling'));
SELECT pg_temp.fails($$SELECT child_tuition_add('d0000000-0000-0000-0000-000000000001', jsonb_build_object('fee_id', pg_temp.fee('Full-time'), 'start', '2026-03-02'))$$, 'already has this fee');
SELECT pg_temp.fails($$SELECT child_tuition_add('d0000000-0000-0000-0000-000000000001', jsonb_build_object('fee_id', pg_temp.fee('After care'), 'discount_type', 'percent', 'discount_value', '10', 'override_amount', '50'))$$, 'not both');
SELECT pg_temp.fails($$SELECT child_tuition_add('d0000000-0000-0000-0000-000000000001', jsonb_build_object('fee_id', pg_temp.fee('After care'), 'discount_type', 'percent', 'discount_value', '120'))$$, 'more than 100%');
SELECT child_tuition_add('d0000000-0000-0000-0000-000000000001', jsonb_build_object('fee_id', pg_temp.fee('After care'), 'start', '2026-01-05'));
SELECT child_tuition_add('d0000000-0000-0000-0000-000000000001', jsonb_build_object('fee_id', pg_temp.fee('Registration'), 'start', '2026-01-05',
  'discount_type', 'amount', 'discount_value', '200'));

SELECT pg_temp.eq(pg_temp.list('d0000000-0000-0000-0000-000000000001', 'Full-time', pg_temp.today()), 285.00, 'today: list 285');
SELECT pg_temp.eq(pg_temp.net('d0000000-0000-0000-0000-000000000001', 'Full-time', pg_temp.today()), 256.50, 'today: 10% off');
SELECT pg_temp.eq(pg_temp.net('d0000000-0000-0000-0000-000000000001', 'Full-time', pg_temp.nm() + 2), 265.50, 'next week: new rate, 10% off');
SELECT pg_temp.eq(pg_temp.net('d0000000-0000-0000-0000-000000000001', 'Full-time', '2026-02-04'), 256.50, 'a past week keeps the old price');
SELECT pg_temp.eq(pg_temp.net('d0000000-0000-0000-0000-000000000001', 'Registration', '2026-01-05'), 0.00, 'a $ discount never goes below 0');
SELECT pg_temp.eq(pg_temp.net('d0000000-0000-0000-0000-000000000001', 'Registration', '2026-01-06'), NULL::numeric, 'a one-time fee only on its day');
SELECT pg_temp.eq((SELECT end_date FROM child_tuition WHERE fee_id = pg_temp.fee('Registration')), '2026-01-05'::date, 'one-time fee ends on its day');

-- A change on Wednesday of a week doesn't touch that week: the week uses Monday's rate
SELECT tuition_rate_set(pg_temp.fee('After care'), 200, pg_temp.nm() + 2);  -- mid-month or not, it starts after a period start
SELECT pg_temp.eq(pg_temp.list('d0000000-0000-0000-0000-000000000001', 'After care', pg_temp.nm() + 2),
  (SELECT CASE WHEN date_trunc('month', pg_temp.nm() + 2)::date = pg_temp.nm() + 2 THEN 200.00 ELSE 180.00 END), 'the month uses the rate on its 1st');
SELECT pg_temp.eq(pg_temp.list('d0000000-0000-0000-0000-000000000001', 'After care', (date_trunc('month', pg_temp.nm() + 2) + interval '1 month')::date), 200.00, 'next month: new rate');
-- weekly, mid-week change
SELECT tuition_rate_set(pg_temp.fee('Full-time'), 299, pg_temp.nm() + 16);  -- Wednesday two weeks out
SELECT pg_temp.eq(pg_temp.list('d0000000-0000-0000-0000-000000000001', 'Full-time', pg_temp.nm() + 18), 300.00, 'mid-week change waits for the next week');
SELECT pg_temp.eq(pg_temp.list('d0000000-0000-0000-0000-000000000001', 'Full-time', pg_temp.nm() + 21), 299.00, 'and applies the week after');
-- biweekly periods count from the child's start day
SELECT child_tuition_add('d0000000-0000-0000-0000-000000000003', jsonb_build_object('fee_id', pg_temp.fee('Biweekly'), 'start', '2026-01-07'));
SELECT pg_temp.eq((SELECT period_start FROM child_tuition_on('d0000000-0000-0000-0000-000000000003', '2026-01-22')), '2026-01-21'::date, 'two-week period from the start day');

-- Changing a discount from a day keeps the old terms before it
SELECT child_tuition_change((SELECT id FROM child_tuition WHERE fee_id = pg_temp.fee('Full-time') AND child_id = 'd0000000-0000-0000-0000-000000000001'),
  pg_temp.nm(), '{"discount_type":"percent","discount_value":"15","discount_reason":"Sibling"}');
SELECT pg_temp.eq(pg_temp.net('d0000000-0000-0000-0000-000000000001', 'Full-time', pg_temp.today()), 256.50, 'old discount this week');
SELECT pg_temp.eq(pg_temp.net('d0000000-0000-0000-0000-000000000001', 'Full-time', pg_temp.nm()), 250.75, 'new discount next week (295 - 15%)');
SELECT pg_temp.fails($$SELECT child_tuition_change((SELECT id FROM child_tuition WHERE fee_id = pg_temp.fee('Full-time') AND start_date = '2026-01-05'), '2026-02-02', '{}')$$, 'owner');
-- Frequency is fixed once used; a used fee can't be deleted
SELECT pg_temp.fails($$SELECT tuition_fee_save('10000000-0000-0000-0000-000000000001', jsonb_build_object('id', pg_temp.fee('Full-time'), 'name', 'Full-time', 'frequency', 'monthly', 'program_id', 'b0000000-0000-0000-0000-000000000001'))$$, 'can''t change');
SELECT pg_temp.fails($$SELECT tuition_fee_delete(pg_temp.fee('Full-time'))$$, 'Turn it off');
-- An inactive fee can't be added, but children who have it keep it
SELECT tuition_fee_save('10000000-0000-0000-0000-000000000001', jsonb_build_object('id', pg_temp.fee('After care'), 'name', 'After care', 'frequency', 'monthly', 'program_id', 'b0000000-0000-0000-0000-000000000001', 'is_active', false));
SELECT pg_temp.fails($$SELECT child_tuition_add('d0000000-0000-0000-0000-000000000002', jsonb_build_object('fee_id', pg_temp.fee('After care')))$$, 'turned off');
SELECT pg_temp.ok(pg_temp.net('d0000000-0000-0000-0000-000000000001', 'After care', pg_temp.today()) IS NOT NULL, 'inactive fee still on the child');
SELECT tuition_fee_save('10000000-0000-0000-0000-000000000001', jsonb_build_object('id', pg_temp.fee('After care'), 'name', 'After care', 'frequency', 'monthly', 'program_id', 'b0000000-0000-0000-0000-000000000001', 'is_active', true));
-- A fee added by mistake today can be removed even though it starts in the past
SELECT child_tuition_add('d0000000-0000-0000-0000-000000000002', jsonb_build_object('fee_id', pg_temp.fee('After care'), 'start', '2026-01-05'));
SELECT child_tuition_end((SELECT id FROM child_tuition WHERE child_id = 'd0000000-0000-0000-0000-000000000002'), NULL);
SELECT pg_temp.eq((SELECT count(*) FROM child_tuition WHERE child_id = 'd0000000-0000-0000-0000-000000000002'), 0::bigint, 'mistake removed');
SELECT pg_temp.fails($$SELECT child_tuition_end((SELECT id FROM child_tuition WHERE fee_id = pg_temp.fee('After care') AND child_id = 'd0000000-0000-0000-0000-000000000001'), pg_temp.today() - 3)$$, 'owner');
-- Options for the enrollment step: the program's fees first
SELECT pg_temp.eq((SELECT tuition_fee_options('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001') -> 0 ->> 'program_id'), 'b0000000-0000-0000-0000-000000000001', 'program fees first');

-- 4. Who pays ---------------------------------------------------------------------------------------------------
-- Subsidy pays a fixed $200 a week, Mom pays the rest by ACH
SELECT pg_temp.eq(child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), jsonb_build_array(
  jsonb_build_object('payer_name', 'NC DCDEE subsidy', 'payer_kind', 'subsidy', 'share_type', 'fixed', 'share_value', '200', 'fixed_frequency', 'weekly', 'method', 'other', 'other_details', 'Paid monthly by the state'),
  jsonb_build_object('payer_guardian_id', 'e0000000-0000-0000-0000-000000000001', 'share_type', 'remainder', 'method', 'ach', 'bank_name', 'Wells Fargo', 'account_type', 'checking',
    'routing_number', '053000219', 'account_number_enc', 'v1:iv:tag:ciphertext', 'last4', '4417',
    'authorization_on_file', true, 'authorization_signed_on', '2026-01-02', 'authorization_file_id', 'f0000000-0000-0000-0000-000000000001'))), 2, 'plan saved');
SELECT pg_temp.eq(pg_temp.paid('d0000000-0000-0000-0000-000000000001', pg_temp.today(), 'weekly', 'NC DCDEE subsidy'), 200::numeric, 'subsidy pays its fixed amount');
SELECT pg_temp.eq(pg_temp.paid('d0000000-0000-0000-0000-000000000001', pg_temp.today(), 'weekly', 'Priya'), 56.50, 'Mom pays the rest of the week');
SELECT pg_temp.eq(pg_temp.paid('d0000000-0000-0000-0000-000000000001', pg_temp.today(), 'monthly', 'Priya'),
  pg_temp.net('d0000000-0000-0000-0000-000000000001', 'After care', pg_temp.today()), 'Mom pays all of the monthly fee');
SELECT pg_temp.eq(pg_temp.split_of('d0000000-0000-0000-0000-000000000001', pg_temp.today(), 'weekly', 'unassigned'), 0::numeric, 'nothing unassigned');

-- Bad plans
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"payer_name":"A","share_type":"percent","share_value":"60","method":"check"},{"payer_name":"B","share_type":"percent","share_value":"30","method":"check"}]')$$, 'add up to 90%');
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"payer_name":"A","share_type":"remainder","method":"check"},{"payer_name":"B","share_type":"remainder","method":"check"}]')$$, 'Only one payer');
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"payer_name":"A","share_type":"remainder","method":"credit_card","last4":"123456789"}]')$$, 'last 4 digits');
-- ACH needs bank, type, a valid routing number and an encrypted account number
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"payer_name":"A","share_type":"remainder","method":"ach","bank_name":"B","account_type":"checking","routing_number":"053000219"}]')$$, 'bank account number');
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"payer_name":"A","share_type":"remainder","method":"ach","bank_name":"B","account_type":"checking","routing_number":"053000218","account_number_enc":"v1:x","last4":"1234"}]')$$, 'routing number isn''t valid');
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"payer_name":"A","share_type":"remainder","method":"ach","bank_name":"B","account_type":"checking","routing_number":"053000219","account_number_enc":"12345678","last4":"5678"}]')$$, 'not saved securely');
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"payer_name":"A","share_type":"remainder","method":"ach","account_type":"checking","routing_number":"053000219","account_number_enc":"v1:x","last4":"5678"}]')$$, 'bank name');
SELECT pg_temp.ok(tuition_aba_ok('021000021') AND tuition_aba_ok('053000219') AND NOT tuition_aba_ok('123456789') AND NOT tuition_aba_ok('000000000'), 'ABA checksum');
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"payer_guardian_id":"e0000000-0000-0000-0000-000000000004","share_type":"remainder","method":"check"}]')$$, 'not one of this child');
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"payer_name":"A","share_type":"remainder","method":"check","authorization_file_id":"f0000000-0000-0000-0000-000000000002"}]')$$, 'this child''s files');
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.today(), '[{"payer_name":"A","share_type":"half","method":"check"}]')$$, 'Pick each payer''s share');
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.today() - 1, '[]')$$, 'owner');

-- 50/50 between the parents from next Monday; the odd cent goes to the first parent
SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', pg_temp.nm(), jsonb_build_array(
  jsonb_build_object('payer_guardian_id', 'e0000000-0000-0000-0000-000000000001', 'share_type', 'percent', 'share_value', '50', 'method', 'ach', 'bank_name', 'Wells Fargo', 'account_type', 'checking',
    'routing_number', '053000219', 'keep_account_from', (SELECT id FROM child_payment_payers WHERE payer_name = 'Priya' AND effective_to IS NULL)),
  jsonb_build_object('payer_guardian_id', 'e0000000-0000-0000-0000-000000000002', 'share_type', 'percent', 'share_value', '50', 'method', 'credit_card', 'card_brand', 'Visa', 'last4', '1881', 'routing_number', '021000021')));
RESET ROLE;
SELECT pg_temp.ok((SELECT account_number_enc = 'v1:iv:tag:ciphertext' AND last4 = '4417' FROM child_payment_payers WHERE payer_name = 'Priya' AND effective_from = pg_temp.nm()), 'kept account carries over');
SELECT pg_temp.ok((SELECT routing_number IS NULL FROM child_payment_payers WHERE payer_name = 'Raj'), 'cards keep no routing number');
SET ROLE authenticated;
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000002', pg_temp.today(), jsonb_build_array(jsonb_build_object('payer_name', 'X', 'share_type', 'remainder', 'method', 'ach', 'bank_name', 'B', 'account_type', 'checking', 'routing_number', '053000219',
  'keep_account_from', (SELECT id FROM child_payment_payers WHERE payer_name = 'Priya' AND effective_to IS NULL))))$$, 'account number again');
SELECT pg_temp.eq(pg_temp.paid('d0000000-0000-0000-0000-000000000001', pg_temp.today(), 'weekly', 'Priya'), 56.50, 'today the old plan holds');
SELECT pg_temp.eq(pg_temp.paid('d0000000-0000-0000-0000-000000000001', pg_temp.nm(), 'weekly', 'Priya'), 125.38, 'first parent gets the odd cent (250.75)');
SELECT pg_temp.eq(pg_temp.paid('d0000000-0000-0000-0000-000000000001', pg_temp.nm(), 'weekly', 'Raj'), 125.37, 'second parent');
SELECT pg_temp.eq((SELECT effective_to FROM child_payment_payers WHERE payer_name = 'NC DCDEE subsidy'), pg_temp.nm() - 1, 'old plan ends the day before');

-- Fixed amounts more than the total are cut down, and the excess is shown
SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000003', pg_temp.today(), '[{"payer_name":"Grant","share_type":"fixed","share_value":"600","fixed_frequency":"biweekly","method":"check"}]');
SELECT pg_temp.eq(pg_temp.paid('d0000000-0000-0000-0000-000000000003', pg_temp.today(), 'biweekly', 'Grant'), 500.00, 'fixed cut to the total');
SELECT pg_temp.eq(pg_temp.split_of('d0000000-0000-0000-0000-000000000003', pg_temp.today(), 'biweekly', 'over'), 100.00, 'excess shown');
-- A fixed-only plan short of the total leaves money unassigned
SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000003', pg_temp.today(), '[{"payer_name":"Grant","share_type":"fixed","share_value":"450","fixed_frequency":"biweekly","method":"check"}]');
SELECT pg_temp.eq(pg_temp.split_of('d0000000-0000-0000-0000-000000000003', pg_temp.today(), 'biweekly', 'unassigned'), 50.00, 'unassigned shown');

-- Copy to a sibling: Mom is matched by email; Dad isn't Leo's contact
SELECT pg_temp.ok((SELECT child_tuition_get('d0000000-0000-0000-0000-000000000001') -> 'siblings' -> 0 ->> 'first_name') = 'Leo', 'Leo is a sibling');
SELECT pg_temp.fails($$SELECT child_payment_plan_copy('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', pg_temp.today())$$, 'only be copied to a sibling');
SELECT pg_temp.eq(child_payment_plan_copy('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', pg_temp.today()), 2, 'copied today''s plan');
SELECT pg_temp.eq((SELECT payer_guardian_id FROM child_payment_payers WHERE child_id = 'd0000000-0000-0000-0000-000000000002' AND share_type = 'remainder'),
  'e0000000-0000-0000-0000-000000000003'::uuid, 'Mom matched to Leo''s own contact row');
SELECT pg_temp.ok((SELECT authorization_file_id IS NULL AND authorization_on_file FROM child_payment_payers WHERE child_id = 'd0000000-0000-0000-0000-000000000002' AND share_type = 'remainder'),
  'form stays with Mia; flag copies');
RESET ROLE;
SELECT pg_temp.ok((SELECT account_number_enc IS NOT NULL AND routing_number = '053000219' FROM child_payment_payers WHERE child_id = 'd0000000-0000-0000-0000-000000000002' AND share_type = 'remainder'),
  'bank details copy to the sibling');
SET ROLE authenticated;

-- The encrypted number is never readable by the app, only through the logged reveal
SELECT pg_temp.fails($$SELECT account_number_enc FROM child_payment_payers LIMIT 1$$, 'permission denied');
SELECT pg_temp.ok((SELECT count(*) FROM child_payment_payers WHERE routing_number IS NOT NULL) > 0, 'other columns readable');
SELECT pg_temp.ok(NOT (child_tuition_get('d0000000-0000-0000-0000-000000000001')::text LIKE '%ciphertext%'), 'tab data never carries the encrypted number');
SELECT pg_temp.ok((SELECT (p ->> 'has_account_number')::boolean FROM jsonb_array_elements(child_tuition_get('d0000000-0000-0000-0000-000000000001') -> 'payers') p WHERE p ->> 'payer_name' = 'Priya'), 'has_account_number flag');
SELECT pg_temp.eq((SELECT child_payment_bank_reveal(id) ->> 'account_number_enc' FROM child_payment_payers WHERE payer_name = 'Priya' AND effective_to IS NOT NULL), 'v1:iv:tag:ciphertext', 'reveal returns it to the server');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM child_audit_log WHERE summary = 'Bank account number viewed: Priya ····4417'), 'every look is logged');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
SELECT pg_temp.fails($$SELECT child_payment_bank_reveal((SELECT id FROM child_payment_payers LIMIT 1))$$, 'do not have access');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
SELECT pg_temp.fails($$SELECT child_payment_bank_reveal('00000000-0000-0000-0000-000000000000')$$, 'do not have access');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');

-- 5. The tab's data ---------------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT jsonb_array_length(child_tuition_get('d0000000-0000-0000-0000-000000000001') -> 'periods') = 2), 'weekly and monthly periods');
SELECT pg_temp.eq((SELECT (p ->> 'total')::numeric FROM jsonb_array_elements(child_tuition_get('d0000000-0000-0000-0000-000000000001') -> 'periods') p WHERE p ->> 'frequency' = 'weekly'), 256.50, 'weekly total');
SELECT pg_temp.ok((SELECT f -> 'upcoming_rate' ->> 'amount' = '295.00' FROM jsonb_array_elements(child_tuition_get('d0000000-0000-0000-0000-000000000001') -> 'fees') f WHERE f ->> 'label' LIKE '%Full-time' AND f -> 'upcoming_rate' IS NOT NULL AND f -> 'upcoming_rate' <> 'null'), 'upcoming rate shown');
SELECT pg_temp.ok((SELECT jsonb_array_length(child_tuition_get('d0000000-0000-0000-0000-000000000001') -> 'upcoming_payers') = 2), 'next week''s payers');
SELECT pg_temp.eq((SELECT (f -> 'upcoming_rate' ->> 'charged_from')::date FROM jsonb_array_elements(child_tuition_get('d0000000-0000-0000-0000-000000000001') -> 'fees') f WHERE f ->> 'label' LIKE '%After care'),
  (date_trunc('month', pg_temp.nm() + 2) + CASE WHEN date_trunc('month', pg_temp.nm() + 2)::date = pg_temp.nm() + 2 THEN interval '0' ELSE interval '1 month' END)::date, 'monthly price is first charged on a 1st');
SELECT pg_temp.eq(tuition_first_charged('weekly', NULL, '2026-11-18'), '2026-11-23'::date, 'Wednesday rate is charged from next Monday');
SELECT pg_temp.eq(tuition_first_charged('weekly', NULL, '2026-11-16'), '2026-11-16'::date, 'Monday rate is charged that Monday');
SELECT pg_temp.ok((SELECT count(*) > 0 FROM child_audit_log WHERE child_id = 'd0000000-0000-0000-0000-000000000001' AND summary LIKE 'Payers:%'), 'payers logged');
SELECT pg_temp.ok((SELECT count(*) > 0 FROM child_audit_log WHERE child_id = 'd0000000-0000-0000-0000-000000000001' AND summary LIKE 'Fee added: Toddler · Full-time%10% off (Sibling)'), 'fee logged');
SELECT pg_temp.eq((SELECT net_amount FROM child_tuition_on('d0000000-0000-0000-0000-000000000001', pg_temp.today()) WHERE fee_name = 'Full-time'), 256.50, 'checked wrapper');

-- 6. Access ------------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
SELECT pg_temp.eq((SELECT count(*) FROM tuition_fees), 0::bigint, 'no dashboard access: sees no fees');
SELECT pg_temp.eq((SELECT count(*) FROM child_payment_payers), 0::bigint, 'no dashboard access: sees no payers');
SELECT pg_temp.fails($$SELECT child_tuition_get('d0000000-0000-0000-0000-000000000001')$$, 'do not have access');
SELECT pg_temp.fails($$SELECT * FROM child_tuition_on('d0000000-0000-0000-0000-000000000001', current_date)$$, 'do not have access');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
SELECT pg_temp.eq((SELECT count(*) FROM tuition_fees), 0::bigint, 'other center owner sees none');
SELECT pg_temp.fails($$SELECT tuition_rate_set(pg_temp.fee('Full-time'), 1, current_date + 30)$$, 'cannot change');
SELECT pg_temp.fails($$SELECT child_payment_plan_save('d0000000-0000-0000-0000-000000000001', current_date + 30, '[]')$$, 'cannot change');
SET ROLE anon;
SELECT pg_temp.fails($$SELECT tuition_fees_list('10000000-0000-0000-0000-000000000001')$$, 'permission denied');
SET ROLE authenticated;

-- 7. Withdrawing ends fees and payers ----------------------------------------------------------------------------
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
UPDATE children SET status = 'withdrawn', withdrawn_on = pg_temp.today() WHERE id = 'd0000000-0000-0000-0000-000000000001';
SELECT pg_temp.eq((SELECT count(*) FROM child_tuition WHERE child_id = 'd0000000-0000-0000-0000-000000000001' AND (end_date IS NULL OR end_date > pg_temp.today())), 0::bigint, 'fees end on the withdrawal day');
SELECT pg_temp.eq((SELECT count(*) FROM child_tuition WHERE child_id = 'd0000000-0000-0000-0000-000000000001' AND start_date > pg_temp.today()), 0::bigint, 'future fee rows removed');
SELECT pg_temp.eq((SELECT count(*) FROM child_payment_payers WHERE child_id = 'd0000000-0000-0000-0000-000000000001' AND effective_from > pg_temp.today()), 0::bigint, 'next week''s payers removed');
SELECT pg_temp.eq((SELECT count(*) FROM child_payment_payers WHERE child_id = 'd0000000-0000-0000-0000-000000000001' AND effective_to IS NULL), 0::bigint, 'payers end');
SELECT pg_temp.fails($$SELECT child_tuition_add('d0000000-0000-0000-0000-000000000001', jsonb_build_object('fee_id', pg_temp.fee('Full-time')))$$, 'Re-enroll');
SELECT pg_temp.ok((SELECT count(*) > 0 FROM child_audit_log WHERE child_id = 'd0000000-0000-0000-0000-000000000001' AND summary LIKE '%(withdrawn)'), 'withdrawal logged');

RESET ROLE;
SELECT 'ALL PASSED' AS result;

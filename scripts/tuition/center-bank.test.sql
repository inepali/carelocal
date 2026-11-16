-- Database tests for the center bank account (20270110000000_center_bank_account.sql), on a throwaway local Postgres:
--   createdb cbank && psql -q -d cbank -f scripts/tuition/stub.sql -f supabase/migrations/20270109000000_tuition_fees.sql \
--     -f supabase/migrations/20270110000000_center_bank_account.sql -f scripts/tuition/center-bank.test.sql
-- It prints ALL PASSED or stops at the first failed check.
\set ON_ERROR_STOP on

CREATE FUNCTION pg_temp.ok(cond boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', what; END IF; END $$;
CREATE FUNCTION pg_temp.fails(q text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RAISE EXCEPTION 'FAIL: expected an error like "%" from: %', pat, q;
EXCEPTION WHEN others THEN
  IF SQLERRM LIKE 'FAIL:%' OR SQLERRM NOT ILIKE '%' || pat || '%' THEN RAISE EXCEPTION 'FAIL: % (got: %)', q, SQLERRM; END IF;
END $$;
CREATE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(u, ''), false), set_config('request.jwt.claims', '{}', false) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- Olive owns A, Dan is A's director (admin), Tess has no dashboard access, Bea owns B
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'olive@a.com'), ('a0000000-0000-0000-0000-000000000002', 'dan@a.com'),
  ('a0000000-0000-0000-0000-000000000003', 'tess@a.com'), ('a0000000-0000-0000-0000-000000000004', 'bea@b.com');
INSERT INTO centers (id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'Center A'), ('10000000-0000-0000-0000-000000000002', 'Center B');
INSERT INTO center_admins VALUES
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner'),
  ('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'owner');
SET ROLE authenticated;
CREATE FUNCTION pg_temp.acct(holder text, bank text, routing text, enc text, last4 text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('account_holder_name', holder, 'bank_name', bank, 'account_type', 'checking', 'routing_number', routing,
    'account_number_enc', enc, 'last4', last4) $$;

-- Only the owner adds the account
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.fails($$SELECT center_bank_save('10000000-0000-0000-0000-000000000001', pg_temp.acct('Acme Kids LLC', 'Truist', '053101121', 'v1:a:b:c', '7788'))$$, 'Only the center''s owner');
SELECT pg_temp.ok((center_bank_get('10000000-0000-0000-0000-000000000001') -> 'current') = 'null'::jsonb, 'nothing on file yet');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SELECT pg_temp.fails($$SELECT center_bank_save('10000000-0000-0000-0000-000000000001', pg_temp.acct('Acme Kids LLC', 'Truist', '053101122', 'v1:a:b:c', '7788'))$$, 'routing number isn''t valid');
SELECT pg_temp.fails($$SELECT center_bank_save('10000000-0000-0000-0000-000000000001', pg_temp.acct('Acme Kids LLC', 'Truist', '053101121', '0001237788', '7788'))$$, 'not saved securely');
SELECT pg_temp.fails($$SELECT center_bank_save('10000000-0000-0000-0000-000000000001', pg_temp.acct(' ', 'Truist', '053101121', 'v1:a:b:c', '7788'))$$, 'name on the account');
SELECT center_bank_save('10000000-0000-0000-0000-000000000001', pg_temp.acct('Acme Kids LLC', 'Truist', '053101121', 'v1:a:b:c', '7788'));
SELECT pg_temp.ok((center_bank_get('10000000-0000-0000-0000-000000000001') -> 'current' ->> 'last4') = '7788', 'added');
SELECT pg_temp.ok(center_bank_get('10000000-0000-0000-0000-000000000001') ->> 'is_owner' = 'true', 'owner flag');

-- Replacing keeps the old one as history and logs both
SELECT center_bank_save('10000000-0000-0000-0000-000000000001', pg_temp.acct('Acme Kids LLC', 'Wells Fargo', '053000219', 'v1:d:e:f', '1234') || '{"note":"Moved banks"}');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM center_bank_accounts WHERE status = 'active' AND center_id = '10000000-0000-0000-0000-000000000001'), 'one active');
SELECT pg_temp.ok((center_bank_get('10000000-0000-0000-0000-000000000001') -> 'history' -> 0 ->> 'status') = 'replaced', 'old one in history');
SELECT pg_temp.ok((center_bank_get('10000000-0000-0000-0000-000000000001') -> 'events' -> 0 ->> 'summary') = 'Wells Fargo ····1234 (was Truist ····7788) · Moved banks', 'replace logged');
SELECT pg_temp.ok((center_bank_get('10000000-0000-0000-0000-000000000001') -> 'events' -> 0 ->> 'who') = 'olive@a.com', 'who is shown');

-- The encrypted number: not readable by the app, never in center_bank_get, revealed to the owner only, logged
SELECT pg_temp.fails($$SELECT account_number_enc FROM center_bank_accounts$$, 'permission denied');
SELECT pg_temp.ok(center_bank_get('10000000-0000-0000-0000-000000000001')::text NOT LIKE '%v1:%', 'get never returns the ciphertext');
SELECT pg_temp.ok((center_bank_reveal('10000000-0000-0000-0000-000000000001') ->> 'account_number_enc') = 'v1:d:e:f', 'owner reveal');
SELECT pg_temp.ok((center_bank_get('10000000-0000-0000-0000-000000000001') -> 'events' -> 0 ->> 'action') = 'viewed', 'view logged');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
SELECT pg_temp.fails($$SELECT center_bank_reveal('10000000-0000-0000-0000-000000000001')$$, 'Only the center''s owner');
SELECT pg_temp.ok((center_bank_get('10000000-0000-0000-0000-000000000001') -> 'current' ->> 'routing_number') = '053000219', 'director sees it masked');
SELECT pg_temp.ok((center_bank_get('10000000-0000-0000-0000-000000000001') ->> 'is_owner') = 'false', 'director is not owner');
SELECT pg_temp.fails($$SELECT center_bank_remove('10000000-0000-0000-0000-000000000001')$$, 'Only the center''s owner');
SELECT pg_temp.fails($$UPDATE center_bank_accounts SET routing_number = '021000021'$$, 'permission denied');
SELECT pg_temp.fails($$INSERT INTO center_bank_account_events (center_id, action) VALUES ('10000000-0000-0000-0000-000000000001', 'viewed')$$, 'permission denied');

-- Other people
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
SELECT pg_temp.fails($$SELECT center_bank_get('10000000-0000-0000-0000-000000000001')$$, 'owner and administrators');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM center_bank_accounts), 'no access: sees no rows');
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
SELECT pg_temp.fails($$SELECT center_bank_get('10000000-0000-0000-0000-000000000001')$$, 'owner and administrators');
SELECT pg_temp.fails($$SELECT center_bank_save('10000000-0000-0000-0000-000000000001', pg_temp.acct('X', 'X', '053000219', 'v1:x', '0000'))$$, 'Only the center''s owner');
SELECT pg_temp.fails($$SELECT center_bank_reveal('10000000-0000-0000-0000-000000000001')$$, 'Only the center''s owner');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM center_bank_account_events), 'other owner sees no events');
SET ROLE anon;
SELECT pg_temp.fails($$SELECT center_bank_get('10000000-0000-0000-0000-000000000001')$$, 'permission denied');
SET ROLE authenticated;

-- Removing
SELECT pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
SELECT center_bank_remove('10000000-0000-0000-0000-000000000001', 'Closing the account');
SELECT pg_temp.ok((center_bank_get('10000000-0000-0000-0000-000000000001') -> 'current') = 'null'::jsonb, 'removed');
SELECT pg_temp.ok(jsonb_array_length(center_bank_get('10000000-0000-0000-0000-000000000001') -> 'history') = 2, 'both in history');
SELECT pg_temp.fails($$SELECT center_bank_reveal('10000000-0000-0000-0000-000000000001')$$, 'no bank account on file');

RESET ROLE;
SELECT 'ALL PASSED' AS result;

#!/usr/bin/env node
/**
 * Database checks for supabase/migrations/20270121000000_center_ach_settings.sql, without a Supabase project: runs the
 * migration on PGlite (Postgres compiled to WebAssembly) with stand-ins for the tables and functions it needs.
 *
 *   npm i --no-save @electric-sql/pglite
 *   node scripts/billing/ach-settings.db.test.mjs supabase/migrations/20270121000000_center_ach_settings.sql supabase/rollbacks/20270121000000_center_ach_settings.down.sql
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const db = new PGlite()
let passed = 0; const failures = []
const check = (name, ok, detail = '') => { if (ok) { passed++; console.log('  ✓ ' + name) } else { failures.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) } }
const OWNER = '11111111-1111-1111-1111-111111111111', ADMIN = '22222222-2222-2222-2222-222222222222', OTHER = '33333333-3333-3333-3333-333333333333'
const CENTER = 'cccccccc-cccc-cccc-cccc-cccccccccccc', BATCH = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
CREATE TABLE public.centers (id uuid PRIMARY KEY, name text);
CREATE TABLE public.center_admins (user_id uuid, center_id uuid, role text);
CREATE FUNCTION public.can_view_confidential(p_center_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role IN ('owner', 'admin')) $$;
CREATE FUNCTION public.center_bank_is_owner(p_center_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role = 'owner') $$;
CREATE FUNCTION public.center_bank_who(p_user uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT email FROM auth.users WHERE id = p_user), 'someone') $$;
CREATE FUNCTION public.tuition_is_owner(p_center_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.center_bank_is_owner(p_center_id) $$;
CREATE FUNCTION public.tuition_require(p_center_id uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF NOT public.can_view_confidential(p_center_id) THEN RAISE EXCEPTION 'no access' USING ERRCODE = '42501'; END IF; END $$;
CREATE TABLE public.billing_ach_batches (id uuid PRIMARY KEY, center_id uuid, status text, file_stale boolean DEFAULT false, sent_at timestamptz);
CREATE FUNCTION public.billing_ach_batch_mark(p_batch_id uuid, p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
  IF (SELECT status FROM billing_ach_batches WHERE id = p_batch_id) <> 'exported' THEN RAISE EXCEPTION 'Download the ACH file before marking it sent'; END IF;
  UPDATE billing_ach_batches SET status = 'sent', sent_at = now() WHERE id = p_batch_id; END $$;
INSERT INTO auth.users VALUES ('${OWNER}', 'owner@center.test'), ('${ADMIN}', 'director@center.test'), ('${OTHER}', 'other@x.test');
INSERT INTO centers VALUES ('${CENTER}', 'Center A');
INSERT INTO center_admins VALUES ('${OWNER}', '${CENTER}', 'owner'), ('${ADMIN}', '${CENTER}', 'admin');
INSERT INTO billing_ach_batches (id, center_id, status) VALUES ('${BATCH}', '${CENTER}', 'scheduled');
`)
await db.exec(readFileSync(process.argv[2], 'utf8'))
console.log('migration applied')

async function as(uid, sql, params = []) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid', '${uid}', false);`)
  try { return { rows: (await db.query(sql, params)).rows } }
  catch (e) { return { error: e } }
  finally { await db.exec('RESET ROLE') }
}
const save = (uid, p) => as(uid, 'SELECT public.center_ach_settings_save($1, $2::jsonb) AS s', [CENTER, JSON.stringify(p)])
const get = uid => as(uid, 'SELECT public.center_ach_settings_get($1) AS d', [CENTER])
const FP = 'SHA256:' + 'A'.repeat(43)
const base = { bank: 'truist', send_method: 'manual', company_id: '1123456789', company_name: 'Center A', balanced: false, line_ending: 'lf', sftp_port: 22, sftp_auth: 'key', api_environment: 'sandbox', api_extra: {} }

console.log('access')
let r = await save(ADMIN, base)
check('director cannot save', r.error?.code === '42501', r.error?.message)
r = await save(OTHER, base)
check('outsider cannot save', r.error?.code === '42501')
r = await get(OTHER)
check('outsider cannot read', r.error?.code === '42501')
r = await save(OWNER, base)
check('owner saves', !r.error && r.rows[0].s.company_id === '1123456789', r.error?.message)
r = await get(ADMIN)
check('director reads the settings', !r.error && r.rows[0].d.settings.bank === 'truist' && r.rows[0].d.is_owner === false, r.error?.message)
check('first save logged as set up', r.rows?.[0].d.events[0]?.summary?.startsWith('Set up'))

console.log('secrets')
r = await save(OWNER, { ...base, send_method: 'sftp', sftp_host: 'sftp.bank.test', sftp_username: 'ctr', sftp_host_fingerprint: FP })
check('sftp needs a saved key', /To send by SFTP/.test(r.error?.message ?? ''), r.error?.message)
r = await save(OWNER, { ...base, send_method: 'sftp', sftp_host: 'SFTP.Bank.test', sftp_username: 'ctr', sftp_host_fingerprint: FP, sftp_secret_enc: 'v1:iv:tag:ct', api_client_secret_enc: 'v1:a:b:c' })
check('sftp saves with a key', !r.error && r.rows[0].s.has_sftp_secret === true && r.rows[0].s.sftp_host === 'sftp.bank.test', r.error?.message)
check('public view hides every secret', !r.error && !Object.keys(r.rows[0].s).some(k => k.endsWith('_enc')))
r = await save(OWNER, { ...base, send_method: 'sftp', sftp_host: 'sftp.bank.test', sftp_username: 'ctr', sftp_host_fingerprint: FP, company_name: 'Center B' })
check('saving without the key keeps it', !r.error && r.rows[0].s.has_sftp_secret === true && r.rows[0].s.has_api_client_secret === true, r.error?.message)
r = await save(OWNER, { ...base, send_method: 'manual', clear: ['api_client_secret'] })
check('clear removes a secret', !r.error && r.rows[0].s.has_api_client_secret === false && r.rows[0].s.has_sftp_secret === true, r.error?.message)
r = await save(OWNER, { ...base, clear: ['company_id'] })
check('clear only takes secret names', r.error?.code === '22023')
r = await get(OWNER)
const last = r.rows[0].d.events[0].summary
check('change log names fields, never values', /API client secret/.test(last) && !/v1:/.test(JSON.stringify(r.rows[0].d.events)), last)

console.log('table grants')
r = await as(ADMIN, 'SELECT sftp_secret_enc FROM center_ach_settings')
check('secret column not readable directly', /permission denied/.test(r.error?.message ?? ''), r.error?.message)
r = await as(ADMIN, 'SELECT company_id, sftp_host FROM center_ach_settings')
check('allowed columns readable by director', !r.error && r.rows.length === 1, r.error?.message)
r = await as(OTHER, 'SELECT company_id FROM center_ach_settings')
check('RLS hides other centers', !r.error && r.rows.length === 0, r.error?.message)
r = await as(OWNER, "UPDATE center_ach_settings SET company_id = 'X'")
check('no direct writes', /permission denied/.test(r.error?.message ?? ''), r.error?.message)
r = await as(OWNER, 'SELECT * FROM center_ach_settings_events')
check('events readable by owner', !r.error && r.rows.length > 0, r.error?.message)

console.log('validation')
for (const [name, p] of [['bad company id', { company_id: 'AB-12' }], ['company name too long', { company_name: 'x'.repeat(17) }],
  ['bad destination', { immediate_destination: '12345' }], ['bad host', { sftp_host: 'https://x' }], ['bad fingerprint', { sftp_host_fingerprint: 'MD5:aa' }],
  ['folder with ..', { sftp_remote_dir: '../etc' }], ['http api url', { api_base_url: 'http://api.bank.test' }], ['other bank needs a name', { bank: 'other' }],
  ['bad file pattern', { file_name_pattern: 'a b/c' }], ['not a PGP key', { pgp_public_key: 'hello' }]]) {
  r = await save(OWNER, { ...base, ...p })
  check('refuses ' + name, !!r.error, 'saved')
}

console.log('secrets for the server')
r = await as(ADMIN, "SELECT public.center_ach_settings_secrets($1, 'send') AS s", [CENTER])
check('director cannot read secrets', r.error?.code === '42501')
r = await as(OWNER, "SELECT public.center_ach_settings_secrets($1, 'send') AS s", [CENTER])
check('owner gets the encrypted secret', !r.error && r.rows[0].s.sftp_secret_enc === 'v1:iv:tag:ct', r.error?.message)
r = await as(OWNER, "SELECT public.center_ach_settings_secrets($1, 'peek') AS s", [CENTER])
check('purpose must be test or send', r.error?.code === '22023')
r = await get(OWNER)
check('secret read is logged', r.rows[0].d.events[0].action === 'secrets_read')
r = await as(OWNER, "SELECT public.center_ach_settings_log($1, 'saved', 'x')", [CENTER])
check('log takes only test/send actions', r.error?.code === '22023')

console.log('send lock')
r = await as(ADMIN, 'SELECT public.billing_ach_sftp_claim($1) AS c', [BATCH])
check('director cannot claim', r.error?.code === '42501')
r = await as(OWNER, 'SELECT public.billing_ach_sftp_claim($1) AS c', [BATCH])
check('owner claims, gets the center', !r.error && r.rows[0].c === CENTER, r.error?.message)
r = await as(OWNER, 'SELECT public.billing_ach_sftp_claim($1) AS c', [BATCH])
check('second claim refused while sending', /being sent/.test(r.error?.message ?? ''), r.error?.message)
r = await as(OWNER, 'SELECT public.billing_ach_sftp_done($1, NULL)', [BATCH])
check('failed send releases the claim', !r.error, r.error?.message)
r = await as(OWNER, 'SELECT public.billing_ach_sftp_claim($1) AS c', [BATCH])
check('claim again after a failure', !r.error, r.error?.message)
await db.exec(`UPDATE billing_ach_batches SET status = 'exported' WHERE id = '${BATCH}'`)
r = await as(OWNER, "SELECT public.billing_ach_sftp_done($1, 'ACH_20261116.ach')", [BATCH])
const b = (await db.query(`SELECT status, sftp_file_name FROM billing_ach_batches WHERE id = '${BATCH}'`)).rows[0]
check('delivered: file name kept and batch marked sent', !r.error && b.status === 'sent' && b.sftp_file_name === 'ACH_20261116.ach', r.error?.message ?? JSON.stringify(b))
await db.exec(`UPDATE billing_ach_batches SET sftp_claimed_at = now() - interval '1 hour' WHERE id = '${BATCH}'`)
r = await as(OWNER, 'SELECT public.billing_ach_sftp_claim($1) AS c', [BATCH])
check('a sent batch cannot be sent again', /already sent/.test(r.error?.message ?? ''), r.error?.message)
await db.exec(`INSERT INTO billing_ach_batches (id, center_id, status, sftp_claimed_at) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', '${CENTER}', 'exported', now() - interval '11 minutes')`)
r = await as(OWNER, "SELECT public.billing_ach_sftp_claim('dddddddd-dddd-dddd-dddd-dddddddddddd') AS c")
check('an abandoned claim (10+ min) can be taken over', !r.error, r.error?.message)

console.log('rollback')
await db.exec(readFileSync(process.argv[3], 'utf8'))
const left = (await db.query(`SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'center_ach_settings%' OR proname LIKE 'billing_ach_sftp%'`)).rows[0].n
const cols = (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'billing_ach_batches' AND column_name LIKE 'sftp%'`)).rows[0].n
check('rollback removes functions and columns', left === 0 && cols === 0, `${left} functions, ${cols} columns`)
await db.exec(readFileSync(process.argv[2], 'utf8'))
check('migration applies again after rollback', true)

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)

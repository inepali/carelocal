#!/usr/bin/env node
/**
 * Database checks for supabase/migrations/20270123000000_billing_bank_changes.sql (parents ask to change the bank
 * account their ACH drafts come from; the center approves with a signed form) without a Supabase project: PGlite.
 * The payer table comes from the real CREATE TABLE statements, so a wrong column name here fails.
 *
 *   npm i --no-save @electric-sql/pglite
 *   node scripts/billing/bank-change.db.test.mjs
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mig = f => readFileSync(join(root, 'supabase', 'migrations', f), 'utf8')
const rollback = readFileSync(join(root, 'supabase', 'rollbacks', '20270123000000_billing_bank_changes.down.sql'), 'utf8')
function table(file, name) {
  const m = mig(file).match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\([\\s\\S]*?\\n\\);`))
  if (!m) throw new Error(`${name} not found in ${file}`)
  return m[0]
}
function fn(file, name) {
  const m = mig(file).match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?(\\$\\$;|END \\$\\$;)`))
  if (!m) throw new Error(`${name} not found in ${file}`)
  return m[0]
}

const db = new PGlite()
let passed = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) { passed++; console.log('  ✓ ' + name) } else { failures.push(name); console.log('  ✗ ' + name + (detail ? `  [${detail}]` : '')) } }
const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
const tryq = async (sql, params = []) => { try { return { rows: await q(sql, params) } } catch (e) { return { error: e } } }
const asUser = async (uid, sql, params = []) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid', '${uid}', false);`)
  try { return { rows: (await db.query(sql, params)).rows } } catch (e) { return { error: e } } finally { await db.exec(`RESET ROLE; SELECT set_config('test.uid', '', false);`) }
}

const CENTER = 'c0000000-0000-0000-0000-000000000001', OTHER_CENTER = 'c0000000-0000-0000-0000-000000000002'
const OWNER = 'a0000000-0000-0000-0000-000000000001', ADMIN = 'a0000000-0000-0000-0000-000000000002', OUTSIDER = 'a0000000-0000-0000-0000-000000000003'
const STAFF = 'a0000000-0000-0000-0000-000000000004'
const AVA = 'd0000000-0000-0000-0000-000000000001', BEN = 'd0000000-0000-0000-0000-000000000002', ZOE = 'd0000000-0000-0000-0000-000000000003'
const MOM_A = 'e0000000-0000-0000-0000-00000000000a', MOM_B = 'e0000000-0000-0000-0000-00000000000b', DAD_A = 'e0000000-0000-0000-0000-00000000000c'
const ACC_MOM = 'f0000000-0000-0000-0000-000000000001', ACC_DAD = 'f0000000-0000-0000-0000-000000000002'
const PP_MOM_A = '10000000-0000-0000-0000-000000000001', PP_DAD_A = '10000000-0000-0000-0000-000000000002', PP_MOM_B = '10000000-0000-0000-0000-000000000003'
const PP_ZOE = '10000000-0000-0000-0000-000000000004'
const FILE_A = '50000000-0000-0000-0000-000000000001', FILE_OTHER = '50000000-0000-0000-0000-000000000002'
const MOM_T = 'a'.repeat(64), DAD_T = 'b'.repeat(64)
const MOM_PIN = 'pin-mom', DAD_PIN = 'pin-dad'
const NEW = { kind: 'new_account', holder_name: 'Maria Lopez', bank_name: 'Wells Fargo', routing_number: '121000248', account_number_enc: 'v1:newcipher', account_type: 'savings', last4: '9876' }

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;

CREATE TABLE public.centers (id uuid PRIMARY KEY, name text NOT NULL, email text, phone text, domain_key text, is_active boolean NOT NULL DEFAULT true,
  tuition_enabled boolean NOT NULL DEFAULT false, parent_portal_enabled boolean NOT NULL DEFAULT false, parent_billing_enabled boolean NOT NULL DEFAULT false);
CREATE TABLE public.center_admins (user_id uuid, center_id uuid, role text);
CREATE TABLE public.center_ach_settings (center_id uuid PRIMARY KEY, company_name text);
CREATE TABLE public.children (id uuid PRIMARY KEY, center_id uuid NOT NULL, first_name text NOT NULL, preferred_name text, status text NOT NULL DEFAULT 'enrolled', UNIQUE (id, center_id));
CREATE TABLE public.child_files (id uuid PRIMARY KEY, center_id uuid NOT NULL, child_id uuid NOT NULL);
CREATE TABLE public.parent_access (id uuid PRIMARY KEY, center_id uuid NOT NULL, code_hash text NOT NULL);
CREATE TABLE public.child_guardians (id uuid PRIMARY KEY, center_id uuid NOT NULL, child_id uuid NOT NULL, name text NOT NULL, email text,
  is_primary boolean NOT NULL DEFAULT false, parent_access_id uuid REFERENCES public.parent_access(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.parent_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), access_id uuid NOT NULL REFERENCES public.parent_access(id),
  token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
CREATE TABLE public.child_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid NOT NULL, child_id uuid NOT NULL, table_name text NOT NULL,
  row_id uuid, action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')), changed_by uuid, changed_at timestamptz NOT NULL DEFAULT now(),
  changed_fields text[] NOT NULL DEFAULT '{}', summary text);

CREATE FUNCTION public.can_view_confidential(p_center_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role IN ('owner', 'admin')) $$;
CREATE FUNCTION public.roster_today(p_center_id uuid) RETURNS date LANGUAGE sql STABLE AS $$ SELECT DATE '2026-11-20' $$;
-- Phase 1 stand-ins: the guardian rows behind a live session when Billing for families is on; a child's display name
CREATE FUNCTION public.parent_billing_guardians(p_token_hash text) RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(g.id), '{}') FROM parent_sessions s JOIN parent_access a ON a.id = s.access_id JOIN centers c ON c.id = a.center_id
    JOIN child_guardians g ON g.parent_access_id = a.id
   WHERE s.token_hash = p_token_hash AND s.expires_at > now() AND c.parent_billing_enabled AND c.tuition_enabled $$;
CREATE FUNCTION public.parent_billing_child_name(p_child_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(btrim(preferred_name), ''), first_name) FROM children WHERE id = p_child_id $$;
`)
await db.exec([
  table('20261228000000_parent_portal.sql', 'parent_login_attempts'),
  table('20270109000000_tuition_fees.sql', 'child_payment_payers'),
  fn('20270109100000_tuition_bank_details.sql', 'tuition_aba_ok'),
  ...mig('20270109100000_tuition_bank_details.sql').match(/ALTER TABLE public\.child_payment_payers (ADD|DROP) [\s\S]*?;\n/g),
].join('\n'))
for (const [file, name] of [['20270109000000_tuition_fees.sql', 'tuition_can_manage'], ['20270109000000_tuition_fees.sql', 'tuition_require'],
  ['20261228000000_parent_portal.sql', 'parent_session_access']]) await db.exec(fn(file, name))
await db.exec(mig('20270123000000_billing_bank_changes.sql'))
console.log('migration applied')

await db.exec(`
INSERT INTO auth.users VALUES ('${OWNER}', 'owner@a.test'), ('${ADMIN}', 'dir@a.test'), ('${OUTSIDER}', 'x@b.test'), ('${STAFF}', 'teacher@a.test');
INSERT INTO centers (id, name, email, phone, domain_key, tuition_enabled, parent_portal_enabled, parent_billing_enabled) VALUES
  ('${CENTER}', 'Sunny Days', 'office@sunny.test', '704-555-0100', 'carelocal', true, true, true),
  ('${OTHER_CENTER}', 'Other', null, null, null, true, true, true);
INSERT INTO center_admins VALUES ('${OWNER}', '${CENTER}', 'owner'), ('${ADMIN}', '${CENTER}', 'admin'), ('${OUTSIDER}', '${OTHER_CENTER}', 'owner'),
  ('${STAFF}', '${CENTER}', 'staff');
INSERT INTO center_ach_settings VALUES ('${CENTER}', 'SUNNY DAYS');
INSERT INTO children (id, center_id, first_name, preferred_name, status) VALUES ('${AVA}', '${CENTER}', 'Ava', null, 'enrolled'),
  ('${BEN}', '${CENTER}', 'Benjamin', 'Ben', 'enrolled'), ('${ZOE}', '${CENTER}', 'Zoe', null, 'withdrawn');
INSERT INTO child_files VALUES ('${FILE_A}', '${CENTER}', '${AVA}'), ('${FILE_OTHER}', '${OTHER_CENTER}', '${AVA}');
INSERT INTO parent_access VALUES ('${ACC_MOM}', '${CENTER}', '${MOM_PIN}'), ('${ACC_DAD}', '${CENTER}', '${DAD_PIN}');
INSERT INTO child_guardians (id, center_id, child_id, name, email, is_primary, parent_access_id) VALUES
  ('${MOM_A}', '${CENTER}', '${AVA}', 'Maria Lopez', ' Maria@Example.com ', true, '${ACC_MOM}'),
  ('${MOM_B}', '${CENTER}', '${BEN}', 'Maria L', 'maria@example.com', false, '${ACC_MOM}'),
  ('${DAD_A}', '${CENTER}', '${AVA}', 'David Lopez', 'david@example.com', false, '${ACC_DAD}');
INSERT INTO parent_sessions (access_id, token_hash, expires_at) VALUES ('${ACC_MOM}', '${MOM_T}', now() + interval '30 days'), ('${ACC_DAD}', '${DAD_T}', now() + interval '30 days');
INSERT INTO child_payment_payers (id, center_id, child_id, payer_guardian_id, payer_name, share_type, share_value, method, bank_name, account_type, last4,
    routing_number, account_number_enc, authorization_on_file, authorization_signed_on, draft_day, sort_order, effective_from) VALUES
  ('${PP_MOM_A}', '${CENTER}', '${AVA}', '${MOM_A}', 'Maria Lopez', 'percent', 50, 'ach', 'Truist', 'checking', '1234', '053000196', 'v1:old', true, '2026-11-01', 'Monday', 0, '2026-11-01'),
  ('${PP_DAD_A}', '${CENTER}', '${AVA}', '${DAD_A}', 'David Lopez', 'remainder', null, 'check', null, null, null, null, null, false, null, null, 1, '2026-11-01'),
  ('${PP_MOM_B}', '${CENTER}', '${BEN}', '${MOM_B}', 'Maria L', 'remainder', null, 'ach', 'Truist', 'checking', '1234', '053000196', 'v1:old', true, '2026-11-01', null, 0, '2026-11-25'),
  ('${PP_ZOE}', '${CENTER}', '${ZOE}', '${MOM_A}', 'Maria Lopez', 'remainder', null, 'ach', 'Truist', 'checking', '1234', '053000196', 'v1:old', true, '2026-11-01', null, 0, '2026-01-01');
`)

const create = (t, pin, p, ip = 'ip-1') => tryq(`SELECT public.parent_bank_change_create($1, $2, $3, 'test-agent', $4::jsonb) AS r`, [t, pin, ip, JSON.stringify(p)])
const mine = async t => (await one('SELECT public.parent_bank_changes($1) AS r', [t])).r

console.log('grants')
for (const f of ['parent_bank_change_create(text, text, text, text, jsonb)', 'parent_bank_change_cancel(text, uuid)', 'parent_bank_changes(text)', 'billing_bank_change_center_staff(uuid)']) {
  const g = await one(`SELECT has_function_privilege('authenticated', 'public.${f}', 'EXECUTE') AS a, has_function_privilege('anon', 'public.${f}', 'EXECUTE') AS n,
    has_function_privilege('service_role', 'public.${f}', 'EXECUTE') AS s`)
  check(`${f.split('(')[0]}: service role only`, !g.a && !g.n && g.s)
}
const tg = await one(`SELECT has_table_privilege('authenticated', 'public.billing_bank_changes', 'SELECT') AS a, has_table_privilege('anon', 'public.billing_bank_changes', 'SELECT') AS n`)
check('the table is not readable by signed-in users or anon', !tg.a && !tg.n)
const cg = await one(`SELECT has_function_privilege('anon', 'public.billing_bank_change_approve(uuid, uuid, date)', 'EXECUTE') AS n,
  has_function_privilege('authenticated', 'public.billing_bank_change_approve(uuid, uuid, date)', 'EXECUTE') AS a`)
check('approve: signed-in users, not anon', cg.a && !cg.n)

console.log('what the parent sees')
let m = await mine(MOM_T)
check('Mom sees her two lines in force, not the withdrawn child', m.lines.length === 2 && m.lines.every(l => [PP_MOM_A, PP_MOM_B].includes(l.payer_id)), JSON.stringify(m.lines))
check('lines are last 4 only', !JSON.stringify(m).includes('053000196') && !JSON.stringify(m).includes('v1:'))
check('Dad sees only his own line', (await mine(DAD_T)).lines.map(l => l.payer_id).join() === PP_DAD_A)
check('no session, nothing', (await mine('z'.repeat(64))) === null)

console.log('sending a request')
let r = await create(MOM_T, 'wrong', { ...NEW, payer_ids: [PP_MOM_A] })
check('a wrong PIN is refused and counted', r.rows?.[0].r.status === 'invalid_pin' && r.rows[0].r.left === 4, JSON.stringify(r.rows?.[0] ?? r.error?.message))
check('the wrong PIN is in the sign-in attempts', (await one(`SELECT count(*)::int n FROM parent_login_attempts WHERE ip_hash = 'ip-1' AND NOT ok`)).n === 1)
r = await create(MOM_T, MOM_PIN, { ...NEW, payer_ids: [PP_DAD_A] })
check('cannot change someone else\'s line', /can't be changed here/.test(r.error?.message ?? ''), r.error?.message)
r = await create(MOM_T, MOM_PIN, { ...NEW, payer_ids: [PP_ZOE] })
check('cannot change a withdrawn child\'s line', /can't be changed here/.test(r.error?.message ?? ''), r.error?.message)
r = await create(DAD_T, DAD_PIN, { kind: 'stop_ach', payer_ids: [PP_DAD_A] })
check('cannot stop ACH on a check line', /can't be changed here/.test(r.error?.message ?? ''), r.error?.message)
r = await create(MOM_T, MOM_PIN, { ...NEW, routing_number: '123456789', payer_ids: [PP_MOM_A] })
check('a bad routing number is refused', /routing number/.test(r.error?.message ?? ''), r.error?.message)
r = await create(MOM_T, MOM_PIN, { ...NEW, payer_ids: [] })
check('no children chosen is refused', /which children/.test(r.error?.message ?? ''), r.error?.message)
r = await create(MOM_T, MOM_PIN, { kind: 'card', payer_ids: [PP_MOM_A] })
check('an unknown kind is refused', /Choose what to change/.test(r.error?.message ?? ''), r.error?.message)

r = await create(MOM_T, MOM_PIN, { ...NEW, payer_ids: [PP_MOM_A, PP_MOM_B, PP_MOM_A] })
const REQ1 = r.rows?.[0].r.id
check('Mom sends a new-account request for both children', r.rows?.[0].r.status === 'ok' && r.rows[0].r.email === 'maria@example.com' && r.rows[0].r.last4 === '9876', JSON.stringify(r.rows?.[0] ?? r.error?.message))
const row1 = await one('SELECT * FROM billing_bank_changes WHERE id = $1', [REQ1])
check('stored with the ciphertext, ids de-duplicated, pending', row1.account_number_enc === 'v1:newcipher' && row1.payer_ids.length === 2 && row1.status === 'pending' && row1.ip_hash === 'ip-1')
check('Activity on both children', (await one(`SELECT count(DISTINCT child_id)::int n FROM child_audit_log WHERE row_id = $1 AND summary LIKE 'Maria Lopez asked to pay by ACH from a new account (Savings ••9876)%'`, [REQ1])).n === 2)
r = await create(MOM_T, MOM_PIN, { kind: 'stop_ach', payer_ids: [PP_MOM_A] })
check('one open request at a time', /already have a request/.test(r.error?.message ?? ''), r.error?.message)
check('nothing changed on the payer lines yet', (await one(`SELECT count(*)::int n FROM child_payment_payers WHERE account_number_enc = 'v1:newcipher'`)).n === 0)
m = await mine(MOM_T)
check('Mom sees it waiting, with both children', m.requests[0].status === 'pending' && m.requests[0].children.length === 2)

console.log('the center')
r = await asUser(STAFF, 'SELECT public.billing_bank_changes_list($1) AS l', [CENTER])
check('a teacher cannot list requests', r.error?.code === '42501', r.error?.message)
r = await asUser(OUTSIDER, 'SELECT public.billing_bank_change_form($1) AS f', [REQ1])
check('another center cannot print the form', r.error?.code === '42501', r.error?.message)
r = await asUser(ADMIN, 'SELECT public.billing_bank_changes_list($1) AS l', [CENTER])
const listed = r.rows?.[0].l?.[0]
check('a director lists it with the current lines', listed?.id === REQ1 && listed.lines.length === 2 && listed.routing_number === '121000248', JSON.stringify(r.rows?.[0] ?? r.error?.message))
check('the list has no account number', !JSON.stringify(r.rows?.[0]).includes('newcipher'))
r = await asUser(ADMIN, 'SELECT public.billing_bank_changes_open($1) AS n', [CENTER])
check('the open count', r.rows?.[0].n === 1)
r = await asUser(ADMIN, 'SELECT public.billing_bank_change_form($1) AS f', [REQ1])
const form = r.rows?.[0].f
check('the form has the center, children and statement name', form?.center.name === 'Sunny Days' && form.children.length === 2 && form.company_name === 'SUNNY DAYS' && form.last4 === '9876', JSON.stringify(form))
check('the form has no account number', !JSON.stringify(form).includes('newcipher'))
const staff = (await one('SELECT public.billing_bank_change_center_staff($1) AS s', [REQ1])).s
check('owners and admins are told, not teachers', staff.user_ids.length === 2 && !staff.user_ids.includes(STAFF))

r = await asUser(ADMIN, 'SELECT public.billing_bank_change_approve($1, NULL, $2) AS a', [REQ1, '2026-11-19'])
check('approving a new account needs the signed form', /Upload the signed/.test(r.error?.message ?? ''), r.error?.message)
r = await asUser(ADMIN, 'SELECT public.billing_bank_change_approve($1, $2, $3) AS a', [REQ1, FILE_OTHER, '2026-11-19'])
check('the form must be from this center', /must be in one of these children/.test(r.error?.message ?? ''), r.error?.message)
r = await asUser(ADMIN, 'SELECT public.billing_bank_change_approve($1, $2, $3) AS a', [REQ1, FILE_A, '2026-11-25'])
check('the signed date cannot be in the future', /date the parent signed/.test(r.error?.message ?? ''), r.error?.message)
r = await asUser(OUTSIDER, 'SELECT public.billing_bank_change_approve($1, $2, $3) AS a', [REQ1, FILE_A, '2026-11-19'])
check('another center cannot approve', r.error?.code === '42501', r.error?.message)

r = await asUser(ADMIN, 'SELECT public.billing_bank_change_approve($1, $2, $3) AS a', [REQ1, FILE_A, '2026-11-19'])
const ap = r.rows?.[0].a
check('a director approves: from tomorrow, two lines', ap?.effective_from === '2026-11-21' && ap.lines === 2 && ap.email === 'maria@example.com', JSON.stringify(ap ?? r.error?.message))
const oldA = await one('SELECT * FROM child_payment_payers WHERE id = $1', [PP_MOM_A])
check('Ava\'s old line ends today, keeping the old account for queued drafts', oldA.effective_to.toISOString().slice(0, 10) === '2026-11-20' && oldA.account_number_enc === 'v1:old')
const newA = await one(`SELECT * FROM child_payment_payers WHERE child_id = $1 AND payer_guardian_id = $2 AND effective_from = '2026-11-21'`, [AVA, MOM_A])
check('Ava\'s new line: same share, new bank, authorization on file', newA && newA.share_type === 'percent' && Number(newA.share_value) === 50 && newA.method === 'ach'
  && newA.account_number_enc === 'v1:newcipher' && newA.routing_number === '121000248' && newA.last4 === '9876' && newA.account_type === 'savings'
  && newA.authorization_on_file && newA.authorization_file_id === FILE_A && newA.draft_day === 'Monday' && newA.created_by === ADMIN, JSON.stringify(newA))
const benLines = await q('SELECT * FROM child_payment_payers WHERE child_id = $1', [BEN])
check('Ben\'s line starting later was changed in place', benLines.length === 1 && benLines[0].account_number_enc === 'v1:newcipher' && benLines[0].effective_from.toISOString().slice(0, 10) === '2026-11-25')
check('Dad\'s line is untouched', (await one('SELECT effective_to, method FROM child_payment_payers WHERE id = $1', [PP_DAD_A])).effective_to === null)
check('Activity says approved, on both children', (await one(`SELECT count(DISTINCT child_id)::int n FROM child_audit_log WHERE row_id = $1 AND summary LIKE 'Bank change approved: ACH from Savings ••9876 from Nov 21, 2026%' AND changed_by = $2`, [REQ1, ADMIN])).n === 2)
r = await asUser(OWNER, 'SELECT public.billing_bank_change_approve($1, $2, $3) AS a', [REQ1, FILE_A, '2026-11-19'])
check('cannot approve twice', /already handled/.test(r.error?.message ?? ''), r.error?.message)
m = await mine(MOM_T)
check('Mom sees it done, from tomorrow', m.requests[0].status === 'approved' && m.requests[0].effective_from === '2026-11-21')
check('Mom\'s lines now show the new account (today\'s and tomorrow\'s)', m.lines.some(l => l.last4 === '9876'))

console.log('stop ACH, decline, cancel')
r = await create(MOM_T, MOM_PIN, { kind: 'stop_ach', payer_ids: [newA.id], account_number_enc: 'v1:ignored', last4: '0000' }, 'ip-2')
const REQ2 = r.rows?.[0].r.id
check('Mom asks to stop ACH (bank fields ignored)', r.rows?.[0].r.status === 'ok' && (await one('SELECT account_number_enc FROM billing_bank_changes WHERE id = $1', [REQ2])).account_number_enc === null, JSON.stringify(r.rows?.[0] ?? r.error?.message))
r = await asUser(ADMIN, 'SELECT public.billing_bank_change_decline($1, $2) AS d', [REQ2, '  '])
check('decline needs a reason', /reason/.test(r.error?.message ?? ''), r.error?.message)
r = await asUser(ADMIN, 'SELECT public.billing_bank_change_decline($1, $2) AS d', [REQ2, 'Your enrollment agreement requires ACH. Please call us.'])
check('a director declines with a reason', r.rows?.[0].d.reason === 'Your enrollment agreement requires ACH. Please call us.' && r.rows[0].d.email === 'maria@example.com', JSON.stringify(r.rows?.[0] ?? r.error?.message))
check('declining changes no line', (await one('SELECT method FROM child_payment_payers WHERE id = $1', [newA.id])).method === 'ach')
check('Activity says declined', (await one(`SELECT count(*)::int n FROM child_audit_log WHERE row_id = $1 AND summary LIKE '%declined: Your enrollment%'`, [REQ2])).n === 1)

r = await create(MOM_T, MOM_PIN, { kind: 'stop_ach', payer_ids: [newA.id] }, 'ip-2')
const REQ3 = r.rows?.[0].r.id
check('Dad cannot cancel Mom\'s request', (await one('SELECT public.parent_bank_change_cancel($1, $2) AS c', [DAD_T, REQ3])).c === false)
check('Mom cancels hers', (await one('SELECT public.parent_bank_change_cancel($1, $2) AS c', [MOM_T, REQ3])).c === true)
check('a canceled request cannot be approved', /already handled/.test((await asUser(ADMIN, 'SELECT public.billing_bank_change_approve($1, NULL, NULL)', [REQ3])).error?.message ?? ''))

r = await create(MOM_T, MOM_PIN, { kind: 'stop_ach', payer_ids: [newA.id] }, 'ip-2')
const REQ4 = r.rows?.[0].r.id
r = await asUser(OWNER, 'SELECT public.billing_bank_change_approve($1, NULL, NULL) AS a', [REQ4])
check('the owner approves stop ACH without a form', r.rows?.[0].a.kind === 'stop_ach', r.error?.message)
const stopped = await one('SELECT * FROM child_payment_payers WHERE id = $1', [newA.id])
check('a line starting tomorrow is switched to check in place, bank details cleared', stopped.method === 'check' && stopped.account_number_enc === null
  && stopped.routing_number === null && stopped.last4 === null && stopped.account_type === null && !stopped.authorization_on_file, JSON.stringify(stopped))

console.log('limits')
await db.exec(`UPDATE billing_bank_changes SET created_at = now() - interval '2 hours'`)
r = await create(MOM_T, MOM_PIN, { ...NEW, payer_ids: [PP_MOM_B] }, 'ip-3')
check('a fifth request in a day still goes', r.rows?.[0].r.status === 'ok', r.error?.message)
await one('SELECT public.parent_bank_change_cancel($1, $2) AS c', [MOM_T, r.rows?.[0].r.id])
r = await create(MOM_T, MOM_PIN, { ...NEW, payer_ids: [PP_MOM_B] }, 'ip-3')
check('a sixth is refused', /several requests today/.test(r.error?.message ?? ''), r.error?.message)
for (let i = 0; i < 5; i++) await create(DAD_T, 'nope', { kind: 'new_account', payer_ids: [PP_DAD_A] }, 'ip-9')
r = await create(DAD_T, DAD_PIN, { ...NEW, holder_name: 'David Lopez', payer_ids: [PP_DAD_A] }, 'ip-9')
check('after 5 wrong PINs from one address, even the right PIN waits', r.rows?.[0].r.status === 'rate_limited' && r.rows[0].r.retry_after >= 60, JSON.stringify(r.rows?.[0] ?? r.error?.message))
await db.exec(`UPDATE centers SET parent_billing_enabled = false WHERE id = '${CENTER}'`)
r = await create(DAD_T, DAD_PIN, { ...NEW, payer_ids: [PP_DAD_A] }, 'ip-4')
check('with Billing for families off, no requests', r.error?.code === '42501', r.error?.message)
check('and the parent sees nothing', (await mine(MOM_T)) === null)

console.log('rollback')
await db.exec(rollback)
check('rollback removes the table and functions', (await one(`SELECT to_regclass('public.billing_bank_changes') IS NULL AS t,
  (SELECT count(*)::int FROM pg_proc WHERE proname LIKE '%bank_change%') AS f`)).t && (await one(`SELECT count(*)::int n FROM pg_proc WHERE proname LIKE '%bank_change%'`)).n === 0)
check('rollback leaves the payer lines', (await one('SELECT count(*)::int n FROM child_payment_payers')).n === 5)

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) { console.log('Failed:\n  ' + failures.join('\n  ')); process.exit(1) }

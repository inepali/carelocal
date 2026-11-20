#!/usr/bin/env node
/**
 * Database checks for supabase/migrations/20270122000000_parent_billing.sql (the parent Billing tab and bill emails)
 * without a Supabase project: PGlite (Postgres compiled to WebAssembly). The billing tables are created from the real
 * CREATE TABLE statements in the billing migrations, so a wrong column name here fails; the rest is stand-ins.
 *
 *   npm i --no-save @electric-sql/pglite
 *   node scripts/billing/parent-billing.db.test.mjs
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mig = f => readFileSync(join(root, 'supabase', 'migrations', f), 'utf8')
const rollback = readFileSync(join(root, 'supabase', 'rollbacks', '20270122000000_parent_billing.down.sql'), 'utf8')
function table(file, name) {
  const m = mig(file).match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\([\\s\\S]*?\\n\\);`))
  if (!m) throw new Error(`${name} not found in ${file}`)
  return m[0]
}

const db = new PGlite()
let passed = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) { passed++; console.log('  ✓ ' + name) } else { failures.push(name); console.log('  ✗ ' + name + (detail ? `  [${detail}]` : '')) } }
const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]

const CENTER = 'c0000000-0000-0000-0000-000000000001', OTHER_CENTER = 'c0000000-0000-0000-0000-000000000002'
const OWNER = 'a0000000-0000-0000-0000-000000000001', ADMIN = 'a0000000-0000-0000-0000-000000000002', OUTSIDER = 'a0000000-0000-0000-0000-000000000003'
const AVA = 'd0000000-0000-0000-0000-000000000001', BEN = 'd0000000-0000-0000-0000-000000000002'
const MOM_A = 'e0000000-0000-0000-0000-00000000000a', MOM_B = 'e0000000-0000-0000-0000-00000000000b', DAD_A = 'e0000000-0000-0000-0000-00000000000c'
const ACC_MOM = 'f0000000-0000-0000-0000-000000000001', ACC_DAD = 'f0000000-0000-0000-0000-000000000002'
const PP_MOM_A = '10000000-0000-0000-0000-000000000001', PP_DAD_A = '10000000-0000-0000-0000-000000000002', PP_MOM_B = '10000000-0000-0000-0000-000000000003'
const RUN = '20000000-0000-0000-0000-000000000001', BATCH = '30000000-0000-0000-0000-000000000001'
const BILL_A = '40000000-0000-0000-0000-000000000001', BILL_B = '40000000-0000-0000-0000-000000000002'
const MOM_T = 'a'.repeat(64), DAD_T = 'b'.repeat(64), OLD_T = 'c'.repeat(64)

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;

CREATE TABLE public.centers (id uuid PRIMARY KEY, name text NOT NULL, email text, phone text, domain_key text, is_active boolean NOT NULL DEFAULT true,
  tuition_enabled boolean NOT NULL DEFAULT false, parent_portal_enabled boolean NOT NULL DEFAULT false, parent_portal_key text);
CREATE TABLE public.center_admins (user_id uuid, center_id uuid, role text);
CREATE TABLE public.children (id uuid PRIMARY KEY, center_id uuid NOT NULL, first_name text NOT NULL, preferred_name text, status text NOT NULL DEFAULT 'enrolled', UNIQUE (id, center_id));
CREATE TABLE public.child_files (id uuid PRIMARY KEY);
CREATE TABLE public.child_tuition (id uuid PRIMARY KEY);
CREATE TABLE public.parent_access (id uuid PRIMARY KEY, center_id uuid NOT NULL);
CREATE TABLE public.child_guardians (id uuid PRIMARY KEY, center_id uuid NOT NULL, child_id uuid NOT NULL, name text NOT NULL, email text,
  is_primary boolean NOT NULL DEFAULT false, parent_access_id uuid REFERENCES public.parent_access(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.parent_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), access_id uuid NOT NULL REFERENCES public.parent_access(id),
  token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);

CREATE FUNCTION public.can_view_confidential(p_center_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_admins WHERE user_id = auth.uid() AND center_id = p_center_id AND role IN ('owner', 'admin')) $$;
CREATE FUNCTION public.roster_today(p_center_id uuid) RETURNS date LANGUAGE sql STABLE AS $$ SELECT DATE '2026-11-20' $$;
`)
// The real billing tables (and the later columns the new functions read)
await db.exec([
  table('20270109000000_tuition_fees.sql', 'child_payment_payers'),
  mig('20270109100000_tuition_bank_details.sql').match(/ALTER TABLE public\.child_payment_payers ADD COLUMN IF NOT EXISTS routing_number[\s\S]*?;\n/)[0],
  mig('20270109100000_tuition_bank_details.sql').match(/ALTER TABLE public\.child_payment_payers ADD COLUMN IF NOT EXISTS account_number_enc[\s\S]*?;\n/)[0],
  table('20270111000000_billing_runs.sql', 'billing_runs'),
  'ALTER TABLE public.billing_runs ADD COLUMN IF NOT EXISTS credit_total numeric(12,2) NOT NULL DEFAULT 0;',
  table('20270111000000_billing_runs.sql', 'billing_ach_batches'),
  table('20270111000000_billing_runs.sql', 'billing_bills'),
  table('20270111000000_billing_runs.sql', 'billing_bill_lines'),
  table('20270111000000_billing_runs.sql', 'billing_charges'),
  table('20270111000000_billing_runs.sql', 'billing_payments'),
  table('20270112000000_billing_receipts.sql', 'billing_receipts'),
  `ALTER TABLE public.billing_payments ADD COLUMN IF NOT EXISTS receipt_id uuid REFERENCES public.billing_receipts(id) ON DELETE CASCADE;
   ALTER TABLE public.billing_payments DROP CONSTRAINT IF EXISTS billing_payments_kind_check;
   ALTER TABLE public.billing_payments ADD CONSTRAINT billing_payments_kind_check CHECK (kind IN ('payment', 'ach', 'ach_return', 'credit'));
   ALTER TABLE public.billing_receipts DROP CONSTRAINT IF EXISTS billing_receipts_method_check;
   ALTER TABLE public.billing_receipts ALTER COLUMN payer_id DROP NOT NULL;
   ALTER TABLE public.billing_receipts ADD COLUMN IF NOT EXISTS payer_guardian_id uuid;
   ALTER TABLE public.billing_charges ADD COLUMN IF NOT EXISTS payer_guardian_id uuid;`,
].join('\n'))

// The real functions these depend on
for (const [file, fn] of [['20270109000000_tuition_fees.sql', 'tuition_can_manage'], ['20270109000000_tuition_fees.sql', 'tuition_is_owner'],
  ['20270109000000_tuition_fees.sql', 'tuition_require'], ['20261228000000_parent_portal.sql', 'parent_session_access'],
  ['20270112000000_billing_receipts.sql', 'billing_receipt_left']]) {
  const m = mig(file).match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?(\\$\\$;|END \\$\\$;)`))
  if (!m) throw new Error(`${fn} not found`)
  await db.exec(m[0])
}
await db.exec(mig('20270122000000_parent_billing.sql'))
console.log('migration applied')

// Center A: tuition on, parent page on. Ava (Mom 50% ACH, Dad 50% check), Ben (Mom pays all by ACH).
await db.exec(`
INSERT INTO auth.users VALUES ('${OWNER}', 'owner@a.test'), ('${ADMIN}', 'dir@a.test'), ('${OUTSIDER}', 'x@b.test');
INSERT INTO centers (id, name, email, phone, tuition_enabled, parent_portal_enabled, parent_portal_key) VALUES
  ('${CENTER}', 'Sunny Days', 'office@sunny.test', '704-555-0100', true, true, 'abcd2345'),
  ('${OTHER_CENTER}', 'Other', null, null, true, true, 'zzzz2345');
INSERT INTO center_admins VALUES ('${OWNER}', '${CENTER}', 'owner'), ('${ADMIN}', '${CENTER}', 'admin'), ('${OUTSIDER}', '${OTHER_CENTER}', 'owner');
INSERT INTO children (id, center_id, first_name, preferred_name) VALUES ('${AVA}', '${CENTER}', 'Ava', null), ('${BEN}', '${CENTER}', 'Benjamin', 'Ben');
INSERT INTO parent_access VALUES ('${ACC_MOM}', '${CENTER}'), ('${ACC_DAD}', '${CENTER}');
INSERT INTO child_guardians (id, center_id, child_id, name, email, is_primary, parent_access_id) VALUES
  ('${MOM_A}', '${CENTER}', '${AVA}', 'Maria Lopez', ' Maria@Example.com ', true, '${ACC_MOM}'),
  ('${MOM_B}', '${CENTER}', '${BEN}', 'Maria L', 'maria@example.com', false, '${ACC_MOM}'),
  ('${DAD_A}', '${CENTER}', '${AVA}', 'David Lopez', 'david@example.com', false, '${ACC_DAD}');
INSERT INTO parent_sessions (access_id, token_hash, expires_at) VALUES
  ('${ACC_MOM}', '${MOM_T}', now() + interval '30 days'), ('${ACC_DAD}', '${DAD_T}', now() + interval '30 days'), ('${ACC_DAD}', '${OLD_T}', now() - interval '1 day');
INSERT INTO child_payment_payers (id, center_id, child_id, payer_guardian_id, payer_name, share_type, share_value, method, bank_name, account_type, last4,
    routing_number, account_number_enc, authorization_on_file, authorization_signed_on, effective_from) VALUES
  ('${PP_MOM_A}', '${CENTER}', '${AVA}', '${MOM_A}', 'Maria Lopez', 'percent', 50, 'ach', 'Truist', 'checking', '1234', '053000196', 'v1:x', true, '2026-11-01', '2026-11-01'),
  ('${PP_DAD_A}', '${CENTER}', '${AVA}', '${DAD_A}', 'David Lopez', 'remainder', null, 'check', null, null, null, null, null, false, null, '2026-11-01'),
  ('${PP_MOM_B}', '${CENTER}', '${BEN}', '${MOM_B}', 'Maria L', 'remainder', null, 'ach', 'Truist', 'checking', '1234', '053000196', 'v1:x', true, '2026-11-01', '2026-11-01');
`)

const summary = async t => (await one('SELECT public.parent_billing_summary($1) AS s', [t])).s
console.log('switch')
check('off by default: no Billing tab', (await summary(MOM_T)) === null)
const asUser = async (uid, sql, params = []) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid', '${uid}', false);`)
  try { return { rows: (await db.query(sql, params)).rows } } catch (e) { return { error: e } } finally { await db.exec('RESET ROLE') }
}
let r = await asUser(ADMIN, 'SELECT public.center_parent_billing_set($1, true)', [CENTER])
check('a director cannot turn it on', r.error?.code === '42501', r.error?.message)
r = await asUser(OUTSIDER, 'SELECT public.center_parent_billing_get($1) AS g', [CENTER])
check('another center cannot read it', r.error?.code === '42501', r.error?.message)
r = await asUser(OWNER, 'SELECT public.center_parent_billing_set($1, true)', [CENTER])
check('the owner turns it on', !r.error, r.error?.message)
r = await asUser(ADMIN, 'SELECT public.center_parent_billing_get($1) AS g', [CENTER])
check('a director sees it on, not as owner', r.rows?.[0].g.enabled === true && r.rows[0].g.is_owner === false && r.rows[0].g.parent_page === true, JSON.stringify(r.rows?.[0]))

console.log('submit fills the outbox at commit')
await db.exec(`BEGIN;
INSERT INTO billing_runs (id, center_id, frequency, period_start, period_end, draft_date, total, submitted_by) VALUES ('${RUN}', '${CENTER}', 'weekly', '2026-11-23', '2026-11-29', '2026-11-23', 500, '${OWNER}');
INSERT INTO billing_ach_batches (id, center_id, run_id, draft_date) VALUES ('${BATCH}', '${CENTER}', '${RUN}', '2026-11-23');
INSERT INTO billing_bills (id, center_id, run_id, child_id, child_name, frequency, period_start, period_end, list_amount, discount_amount, total) VALUES
  ('${BILL_A}', '${CENTER}', '${RUN}', '${AVA}', 'Ava Lopez', 'weekly', '2026-11-23', '2026-11-29', 320, 20, 300),
  ('${BILL_B}', '${CENTER}', '${RUN}', '${BEN}', 'Benjamin Lopez', 'weekly', '2026-11-23', '2026-11-29', 200, 0, 200);
INSERT INTO billing_bill_lines (center_id, bill_id, child_id, fee_name, frequency, fee_period_start, fee_period_end, list_amount, discount_amount, net_amount, discount_label) VALUES
  ('${CENTER}', '${BILL_A}', '${AVA}', 'Preschool weekly', 'weekly', '2026-11-23', '2026-11-29', 320, 20, 300, 'Sibling discount');
INSERT INTO billing_charges (center_id, run_id, bill_id, child_id, payer_id, payer_guardian_id, payer_name, method, account_type, last4, amount, paid_amount, status, ach_batch_id, sort_order) VALUES
  ('${CENTER}', '${RUN}', '${BILL_A}', '${AVA}', '${PP_MOM_A}', '${MOM_A}', 'Maria Lopez', 'ach', 'checking', '1234', 150, 0, 'ach_scheduled', '${BATCH}', 0),
  ('${CENTER}', '${RUN}', '${BILL_A}', '${AVA}', '${PP_DAD_A}', '${DAD_A}', 'David Lopez', 'check', null, null, 150, 0, 'open', null, 1),
  ('${CENTER}', '${RUN}', '${BILL_B}', '${BEN}', '${PP_MOM_B}', '${MOM_B}', 'Maria L', 'ach', 'checking', '1234', 200, 50, 'ach_scheduled', '${BATCH}', 0);
COMMIT;`)
const notices = await q(`SELECT kind, email, name, status FROM billing_notices WHERE run_id = '${RUN}' ORDER BY email`)
check('one email per person who pays (Mom once for two children)', notices.length === 2 && notices[0].email === 'david@example.com' && notices[1].email === 'maria@example.com', JSON.stringify(notices))
check('the primary contact row names the person', notices[1].name === 'Maria Lopez')

console.log('claim and send')
const claim = async run => (await one('SELECT public.billing_notice_claim($1, 50) AS c', [run])).c
let claimed = await claim(RUN)
const mom = claimed.find(n => n.email === 'maria@example.com'), dad = claimed.find(n => n.email === 'david@example.com')
check('both claimed', claimed.length === 2)
check('Mom sees her two children, her share only', mom.lines.length === 2 && Number(mom.lines.find(l => l.child === 'Ava').share) === 150 && Number(mom.lines.find(l => l.child === 'Ben').share) === 200, JSON.stringify(mom.lines))
check('the child’s bill total is shown with it', Number(mom.lines.find(l => l.child === 'Ava').bill_total) === 300)
check('Ben goes by his preferred name', mom.lines.some(l => l.child === 'Ben'))
check('Mom’s ACH draft: amount left after credit, account and date', Number(mom.lines.find(l => l.child === 'Ben').ach) === 150 && mom.lines[0].last4 === '1234' && mom.lines[0].draft_date === '2026-11-23', JSON.stringify(mom.lines))
check('Dad pays at the center', dad.lines.length === 1 && Number(dad.lines[0].due) === 150 && Number(dad.lines[0].ach) === 0)
check('Dad’s email never carries Mom’s bank', !JSON.stringify(dad).includes('1234'))
check('the email gets the center link and knows they have a PIN', mom.center.portal_key === 'abcd2345' && mom.has_pin === true)
check('claimed rows are marked as tried', (await one(`SELECT count(*)::int n FROM billing_notices WHERE status = 'sending' AND attempts = 1`)).n === 2)
check('claiming again gives nothing (no double send)', (await claim(RUN)).length === 0 && (await claim(null)).length === 0)
await q('SELECT public.billing_notice_result($1, true, $2, null)', [mom.notice_id, 're_1'])
await q('SELECT public.billing_notice_result($1, false, null, $2)', [dad.notice_id, 'mailbox full'])
check('results recorded', (await one(`SELECT status FROM billing_notices WHERE id = $1`, [mom.notice_id])).status === 'sent'
  && (await one(`SELECT status, error FROM billing_notices WHERE id = $1`, [dad.notice_id])).error === 'mailbox full')
check('a failure waits 10 minutes', (await claim(null)).length === 0)
await db.exec(`UPDATE billing_notices SET last_attempt_at = now() - interval '11 minutes' WHERE id = '${dad.notice_id}'`)
claimed = await claim(null)
check('then the cron retries it', claimed.length === 1 && claimed[0].email === 'david@example.com' && claimed[0].attempts === 2)
await q('SELECT public.billing_notice_result($1, false, null, $2)', [dad.notice_id, 'still full'])
await db.exec(`UPDATE billing_notices SET last_attempt_at = now() - interval '11 minutes', attempts = 3 WHERE id = '${dad.notice_id}'`)
check('and gives up after 3 tries', (await claim(null)).length === 0)

console.log('the Billing tab')
const sm = await summary(MOM_T), sd = await summary(DAD_T)
check('Mom has a Billing tab', sm !== null)
check('scheduled ACH drafts are not "due now"', Number(sm.due) === 0, sm?.due)
check('Mom’s next draft: one line, $300 after credit, ••1234', sm.ach_scheduled.length === 1 && Number(sm.ach_scheduled[0].amount) === 300 && sm.ach_scheduled[0].last4 === '1234', JSON.stringify(sm.ach_scheduled))
check('Dad owes $150 at the center', Number(sd.due) === 150 && sd.ach_scheduled.length === 0)
check('how Mom pays, per child', sm.methods.length === 2 && sm.methods.every(m => m.method === 'ach' && m.ach_ready && m.last4 === '1234'), JSON.stringify(sm.methods))
check('never a routing or account number', !/053000196|v1:x/.test(JSON.stringify(sm)))
check('Dad’s summary never shows Mom', !/Maria|1234/.test(JSON.stringify(sd)))
check('year to date', Number(sm.ytd.billed) === 350 && Number(sm.ytd.paid) === 50 && sm.ytd.year === 2026, JSON.stringify(sm.ytd))
await db.exec(`INSERT INTO billing_receipts (center_id, child_id, payer_id, payer_guardian_id, payer_name, amount, method, received_on) VALUES
  ('${CENTER}', '${AVA}', '${PP_DAD_A}', '${DAD_A}', 'David Lopez', 200, 'check', '2026-11-19')`)
const sd2 = await summary(DAD_T)
check('a payment shows with its credit left', sd2.payments.length === 1 && sd2.payments[0].method === 'check' && Number(sd2.credit) === 200 && Number(sd2.payments[0].credit_left) === 200, JSON.stringify(sd2.payments))
check('Mom doesn’t see Dad’s payment', (await summary(MOM_T)).payments.length === 0)

const bills = async t => (await one('SELECT public.parent_billing_bills($1, null) AS b', [t])).b
const bm = await bills(MOM_T), bd = await bills(DAD_T)
check('Mom’s bills: Ava and Ben', bm.length === 2 && bm.map(b => b.child).sort().join() === 'Ava,Ben')
const avaMom = bm.find(b => b.child === 'Ava')
check('Ava: Mom’s share of the $300 bill, only her charge', Number(avaMom.share) === 150 && Number(avaMom.bill_total) === 300 && avaMom.charges.length === 1 && avaMom.charges[0].status === 'ach_scheduled', JSON.stringify(avaMom))
check('Dad sees only Ava’s bill', bd.length === 1 && bd[0].child === 'Ava' && Number(bd[0].due) === 150)
check('older page: nothing before the oldest', (await one('SELECT public.parent_billing_bills($1, $2) AS b', [MOM_T, '2026-11-23'])).b.length === 0)
const detail = (t, id) => one('SELECT public.parent_billing_bill($1, $2) AS b', [t, id]).then(x => x.b)
const dA = await detail(DAD_T, BILL_A)
check('bill detail: fee lines with the discount', dA.lines.length === 1 && dA.lines[0].discount_label === 'Sibling discount' && Number(dA.discount_amount) === 20)
check('bill detail: only Dad’s charge', dA.charges.length === 1 && dA.charges[0].method === 'check')
check('Dad can’t open Ben’s bill', (await detail(DAD_T, BILL_B)) === null)
check('an expired session sees nothing', (await summary(OLD_T)) === null && (await bills(OLD_T)) === null)

console.log('void')
await db.exec(`UPDATE billing_runs SET status = 'void', voided_at = now(), void_reason = 'wrong week' WHERE id = '${RUN}';
               UPDATE billing_bills SET voided = true WHERE run_id = '${RUN}'; UPDATE billing_charges SET status = 'void' WHERE run_id = '${RUN}';`)
const after = await q(`SELECT kind, email, status FROM billing_notices WHERE run_id = '${RUN}' ORDER BY kind, email`)
check('a "bill canceled" email only for who was told', after.filter(n => n.kind === 'void').map(n => n.email).join() === 'maria@example.com', JSON.stringify(after))
claimed = await claim(RUN)
check('the canceled email is sendable', claimed.length === 1 && claimed[0].kind === 'void' && claimed[0].lines.length === 0)
check('voided bills leave the tab', (await bills(MOM_T)).length === 0)

console.log('switch off, grants')
await asUser(OWNER, 'SELECT public.center_parent_billing_set($1, false)', [CENTER])
check('off: the tab disappears', (await summary(MOM_T)) === null)
for (const [fn, args] of [['parent_billing_summary', [MOM_T]], ['billing_notice_claim', [null, 5]]]) {
  r = await asUser(OWNER, `SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args)
  check(`${fn}: not callable by signed-in users`, /permission denied/.test(r.error?.message ?? ''), r.error?.message)
}
r = await asUser(ADMIN, 'SELECT count(*)::int n FROM billing_notices')
check('the center’s admins can see who was emailed', !r.error && r.rows[0].n === 3, r.error?.message)
r = await asUser(OUTSIDER, 'SELECT count(*)::int n FROM billing_notices')
check('another center cannot', !r.error && r.rows[0].n === 0)

console.log('rollback')
await db.exec(rollback)
const left = (await one(`SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'parent_billing%' OR proname LIKE 'billing_notice%' OR proname LIKE 'center_parent_billing%'`)).n
const col = (await one(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'centers' AND column_name = 'parent_billing_enabled'`)).n
check('rollback removes it all', left === 0 && col === 0, `${left} functions, ${col} column`)
await db.exec(mig('20270122000000_parent_billing.sql'))
check('and the migration applies again', true)

console.log(`\n${passed} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

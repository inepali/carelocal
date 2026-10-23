#!/usr/bin/env node
/**
 * Access-rule tests for Child Files (children, guardians, documents, files, audit trail, access log).
 *
 * WHAT IT PROVES: only the OWNER and ADMIN of a child's own center can read or write child records.
 * A staff_admin, a regular employee, a substitute, someone with no link, the owner of ANOTHER center and a
 * signed-out visitor all get zero rows and cannot write. It also checks the database rules (cross-center
 * links, file key prefix, requirement audience, plan limit, audit trail, cascade delete).
 *
 * SAFETY: it creates real (clearly marked) rows in whatever database .env.local points at, so it ONLY runs
 * against the development project and refuses production and any project it does not recognize. Fixtures use
 * the prefix "rls-test-" and the email domain "@rls-test.invalid" and are deleted at the end (and swept on the
 * next run if a run is interrupted).
 *
 *   npm run test:rls
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'

// ── Safety rails ─────────────────────────────────────────────────────────────────────────────────────
const DEV_REFS = new Set(['kfjpsucszngvsnacjscq', ...(process.env.RLS_TEST_DEV_REFS || '').split(',').filter(Boolean)])  // Care Local (development)
const PROD_REFS = new Set(['euwuynvcfrosoerhmyaj'])                                                                      // carelocal-prod: never

function loadEnv() {
  const env = {}
  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const i = line.indexOf('=')
      env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    }
  }
  return { ...env, ...process.env }
}

const env = loadEnv()
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !ANON || !SERVICE) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2) }

const REF = new URL(URL_).hostname.split('.')[0]
if (PROD_REFS.has(REF)) { console.error(`REFUSING to run: ${REF} is the PRODUCTION project.`); process.exit(2) }
if (!DEV_REFS.has(REF)) { console.error(`REFUSING to run: ${REF} is not a known development project. Add it to RLS_TEST_DEV_REFS only if it is not production.`); process.exit(2) }

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, SERVICE, NO_SESSION)
const RUN = randomBytes(3).toString('hex')
const EMAIL_DOMAIN = 'rls-test.invalid'

// ── Tiny test runner ─────────────────────────────────────────────────────────────────────────────────
let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}
const errText = e => (e ? `${e.code ?? ''} ${e.message ?? e}`.trim() : '')

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────
const created = { users: [], centers: [] }

async function must(promise, what) {
  const { data, error } = await promise
  if (error) throw new Error(`${what}: ${errText(error)}`)
  return data
}

async function makeUser(label, appMetadata) {
  const email = `${label}-${RUN}@${EMAIL_DOMAIN}`
  const password = `${randomBytes(12).toString('hex')}Aa1!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, ...(appMetadata ? { app_metadata: appMetadata } : {}) })
  if (error) throw new Error(`createUser ${label}: ${errText(error)}`)
  created.users.push(data.user.id)
  return { id: data.user.id, email, password, label }
}

async function signIn(u) {
  const client = createClient(URL_, ANON, NO_SESSION)
  const { error } = await client.auth.signInWithPassword({ email: u.email, password: u.password })
  if (error) throw new Error(`sign in ${u.label}: ${errText(error)}`)
  return client
}

async function makeCenter(tag, extra = {}) {
  const row = await must(admin.from('centers').insert({ slug: `rls-test-${tag}-${RUN}`, name: `RLS Test ${tag} ${RUN}`, ...extra }).select('id').single(), `center ${tag}`)
  created.centers.push(row.id)
  return row.id
}

async function makeStaff(user, centerId, employmentClass) {
  const profile = await must(admin.from('staff_profiles').insert({
    user_id: user.id, first_name: 'RLS', last_name: user.label, email: user.email, staff_type: 'teacher',
  }).select('id').single(), `staff profile ${user.label}`)
  await must(admin.from('center_staff').insert({
    center_id: centerId, staff_id: profile.id, status: 'active', employment_class: employmentClass,
  }).select('id').single(), `center_staff ${user.label}`)
  return profile.id
}

async function purgeCenters(ids) {
  for (const id of ids) {
    await admin.from('document_access_log').delete().eq('center_id', id)
    await admin.from('children').delete().eq('center_id', id)        // children use ON DELETE RESTRICT: remove them first
    await admin.from('centers').delete().eq('id', id)
  }
}

async function sweepStale() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const u of users?.users ?? []) if (u.email?.endsWith(`@${EMAIL_DOMAIN}`)) await admin.auth.admin.deleteUser(u.id)
  const { data: centers } = await admin.from('centers').select('id').like('slug', 'rls-test-%')
  await purgeCenters((centers ?? []).map(c => c.id))
}

const idsOf = rows => new Set((rows ?? []).map(r => r.id))
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x))

// ── The tests ────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Child Files access-rule tests  ·  project ${REF} (development)  ·  run ${RUN}\n`)
  await sweepStale()

  // Two centers and the people around them
  const A = await makeCenter('a', { child_files_enabled: true })
  const B = await makeCenter('b', { child_files_enabled: true })
  const people = {}
  for (const label of ['ownerA', 'adminA', 'staffAdminA', 'regularA', 'subA', 'outsider', 'ownerB']) people[label] = await makeUser(label)

  await must(admin.from('center_admins').insert([
    { center_id: A, user_id: people.ownerA.id, role: 'owner' },
    { center_id: A, user_id: people.adminA.id, role: 'admin' },
    { center_id: A, user_id: people.staffAdminA.id, role: 'staff_admin' },   // an admin-table row that is NOT owner/admin
    { center_id: B, user_id: people.ownerB.id, role: 'owner' },
  ]).select('id'), 'center_admins')
  await makeStaff(people.adminA, A, 'regular')
  await makeStaff(people.staffAdminA, A, 'regular')
  await makeStaff(people.regularA, A, 'regular')
  await makeStaff(people.subA, A, 'substitute')
  await makeStaff(people.outsider, await makeCenter('elsewhere'), 'regular')   // belongs to a third center, no link to A or B

  const clients = {}
  for (const [label, u] of Object.entries(people)) clients[label] = await signIn(u)
  clients.anonymous = createClient(URL_, ANON, NO_SESSION)

  // Records in both centers (written by the server)
  const classA = await must(admin.from('work_areas').insert({ center_id: A, name: 'RLS Room A' }).select('id').single(), 'work area A')
  const classB = await must(admin.from('work_areas').insert({ center_id: B, name: 'RLS Room B' }).select('id').single(), 'work area B')
  const reqs = {
    childA: await must(admin.from('center_document_requirements').insert({ center_id: A, document_name: 'RLS Child Application', section: 'child_enrollment', audience: 'child', document_category: 'other' }).select('id').single(), 'child req A'),
    childB: await must(admin.from('center_document_requirements').insert({ center_id: B, document_name: 'RLS Child Application B', section: 'child_enrollment', audience: 'child', document_category: 'other' }).select('id').single(), 'child req B'),
    staffA: await must(admin.from('center_document_requirements').insert({ center_id: A, document_name: 'RLS Staff Item', section: 'personnel', audience: 'staff', document_category: 'other' }).select('id').single(), 'staff req A'),
  }
  const childA = await must(admin.from('children').insert({ center_id: A, first_name: 'Ada', last_name: 'Alpha', date_of_birth: '2022-03-04', classroom_id: classA.id }).select('id').single(), 'child A')
  const childB = await must(admin.from('children').insert({ center_id: B, first_name: 'Ben', last_name: 'Bravo', date_of_birth: '2021-05-06' }).select('id').single(), 'child B')
  const guardianA = await must(admin.from('child_guardians').insert({ center_id: A, child_id: childA.id, name: 'Gail Alpha', relationship: 'Mother', is_primary: true }).select('id').single(), 'guardian A')
  await must(admin.from('child_guardians').insert({ center_id: B, child_id: childB.id, name: 'Gus Bravo', relationship: 'Father' }).select('id').single(), 'guardian B')
  await must(admin.from('child_documents').insert({ center_id: A, child_id: childA.id, requirement_id: reqs.childA.id }).select('id').single(), 'child doc A')
  await must(admin.from('child_documents').insert({ center_id: B, child_id: childB.id, requirement_id: reqs.childB.id }).select('id').single(), 'child doc B')
  const fileA = await must(admin.from('child_files').insert({ center_id: A, child_id: childA.id, requirement_id: reqs.childA.id, file_key: `child/${A}/${childA.id}/${randomUUID()}.pdf`, bucket_name: 'rls-test', file_name: 'application.pdf' }).select('id').single(), 'child file A')
  await must(admin.from('child_files').insert({ center_id: B, child_id: childB.id, file_key: `child/${B}/${childB.id}/${randomUUID()}.pdf`, bucket_name: 'rls-test', file_name: 'b.pdf' }).select('id').single(), 'child file B')

  const TABLES = ['children', 'child_guardians', 'child_documents', 'child_files', 'child_audit_log']
  const expected = { A: {}, B: {} }
  for (const t of TABLES) {
    expected.A[t] = idsOf((await admin.from(t).select('id').eq('center_id', A)).data)
    expected.B[t] = idsOf((await admin.from(t).select('id').eq('center_id', B)).data)
  }
  check('fixtures exist in both centers (every table has rows)', TABLES.every(t => expected.A[t].size > 0 && expected.B[t].size > 0))

  // 1. Who can READ ────────────────────────────────────────────────────────────────────────────────
  console.log('\n1. Reading')
  const mayRead = { ownerA: 'A', adminA: 'A', ownerB: 'B' }
  for (const [label, client] of Object.entries(clients)) {
    for (const t of TABLES) {
      const { data, error } = await client.from(t).select('id')
      const got = idsOf(data)
      const want = mayRead[label] ? expected[mayRead[label]][t] : new Set()
      check(`${label.padEnd(11)} reads ${t.padEnd(15)} → ${want.size} row(s)`, sameSet(got, want), `got ${got.size}${error ? `, ${errText(error)}` : ''}`)
    }
  }

  // 2. Who can WRITE ───────────────────────────────────────────────────────────────────────────────
  console.log('\n2. Writing')
  const newChild = center => ({ center_id: center, first_name: 'Probe', last_name: 'Kid', date_of_birth: '2022-01-01' })
  for (const label of ['staffAdminA', 'regularA', 'subA', 'outsider', 'anonymous']) {
    const { data, error } = await clients[label].from('children').insert(newChild(A)).select('id')
    check(`${label.padEnd(11)} cannot add a child to center A`, !!error && !(data?.length), errText(error) || 'it succeeded')
    const guardianTry = await clients[label].from('child_guardians').insert({ center_id: A, child_id: childA.id, name: 'Intruder' }).select('id')
    check(`${label.padEnd(11)} cannot add a guardian`, !!guardianTry.error && !(guardianTry.data?.length), errText(guardianTry.error) || 'it succeeded')
  }
  for (const label of ['staffAdminA', 'regularA', 'subA', 'outsider', 'ownerB']) {
    const upd = await clients[label].from('children').update({ first_name: 'Hacked' }).eq('id', childA.id).select('id')
    const del = await clients[label].from('children').delete().eq('id', childA.id).select('id')
    const still = (await admin.from('children').select('first_name').eq('id', childA.id).single()).data
    check(`${label.padEnd(11)} cannot change or delete child A`, !(upd.data?.length) && !(del.data?.length) && still?.first_name === 'Ada', `name is now ${still?.first_name}`)
  }
  const ownerInsertsB = await clients.ownerA.from('children').insert(newChild(B)).select('id')
  check('ownerA cannot add a child to ANOTHER center', !!ownerInsertsB.error, errText(ownerInsertsB.error) || 'it succeeded')
  const adminAdds = await clients.adminA.from('children').insert(newChild(A)).select('id')
  check('adminA CAN add a child to their own center', !adminAdds.error && adminAdds.data?.length === 1, errText(adminAdds.error))

  // 3. Rules the database enforces ────────────────────────────────────────────────────────────────
  console.log('\n3. Database rules')
  const o = clients.ownerA
  const move = await o.from('children').update({ center_id: B }).eq('id', childA.id).select('id')
  check('a child cannot be moved to another center', !!move.error || !move.data?.length, errText(move.error))
  const crossLink = await o.from('child_guardians').insert({ center_id: B, child_id: childA.id, name: 'Cross' }).select('id')
  check('a guardian cannot point at a child of another center', !!crossLink.error, errText(crossLink.error) || 'it succeeded')
  const wrongClass = await o.from('children').update({ classroom_id: classB.id }).eq('id', childA.id).select('id')
  check("a child cannot be put in another center's classroom", !!wrongClass.error, errText(wrongClass.error) || 'it succeeded')
  const badKey = await o.from('child_files').insert({ center_id: A, child_id: childA.id, file_key: `child/${B}/${childA.id}/x.pdf`, bucket_name: 'rls-test', file_name: 'x.pdf' }).select('id')
  check("a file key outside the child's folder is rejected", !!badKey.error, errText(badKey.error) || 'it succeeded')
  const goodKey = await o.from('child_files').insert({ center_id: A, child_id: childA.id, file_key: `child/${A}/${childA.id}/${randomUUID()}.pdf`, bucket_name: 'rls-test', file_name: 'ok.pdf' }).select('id')
  check("a file key inside the child's folder is accepted", !goodKey.error, errText(goodKey.error))
  const staffRuleOnChild = await o.from('child_documents').insert({ center_id: A, child_id: childA.id, requirement_id: reqs.staffA.id }).select('id')
  check('a STAFF requirement cannot be used on a child', !!staffRuleOnChild.error, errText(staffRuleOnChild.error) || 'it succeeded')
  const otherCenterRule = await o.from('child_documents').insert({ center_id: A, child_id: childA.id, requirement_id: reqs.childB.id }).select('id')
  check("another center's child requirement cannot be used", !!otherCenterRule.error, errText(otherCenterRule.error) || 'it succeeded')
  const ruleMix1 = await admin.from('center_document_requirements').insert({ center_id: A, document_name: 'x', section: 'personnel', audience: 'child', document_category: 'other' })
  const ruleMix2 = await admin.from('center_document_requirements').insert({ center_id: A, document_name: 'x', section: 'child_health', audience: 'staff', document_category: 'other' })
  check('a child rule must sit in a child section, and a staff rule must not', !!ruleMix1.error && !!ruleMix2.error, `${errText(ruleMix1.error)} | ${errText(ruleMix2.error)}`)
  const badImmunization = await o.from('children').update({ immunization_status: 'bogus' }).eq('id', childA.id).select('id')
  check('only the five immunization statuses are accepted', !!badImmunization.error, errText(badImmunization.error) || 'it succeeded')
  const withdrawNoDate = await o.from('children').update({ status: 'withdrawn' }).eq('id', childA.id).select('id')
  check('withdrawing a child requires a withdrawn date', !!withdrawNoDate.error, errText(withdrawNoDate.error) || 'it succeeded')

  // 4. Audit trail ─────────────────────────────────────────────────────────────────────────────────
  console.log('\n4. Audit trail')
  const flip = await o.from('child_guardians').update({ can_pick_up: true }).eq('id', guardianA.id).select('id')
  check('ownerA can authorize a guardian for pick-up', !flip.error && flip.data?.length === 1, errText(flip.error))
  const audit = (await o.from('child_audit_log').select('id, summary, changed_by, table_name').eq('row_id', guardianA.id).order('changed_at', { ascending: false }).limit(1)).data?.[0]
  check('the change was logged with who and what', !!audit && audit.changed_by === people.ownerA.id && /pick-up authorized/.test(audit.summary ?? ''), JSON.stringify(audit))
  const forgeInsert = await o.from('child_audit_log').insert({ center_id: A, child_id: childA.id, table_name: 'children', action: 'update', summary: 'forged' })
  const forgeUpdate = await o.from('child_audit_log').update({ summary: 'tampered' }).eq('id', audit?.id).select('id')
  const forgeDelete = await o.from('child_audit_log').delete().eq('id', audit?.id).select('id')
  const auditNow = (await admin.from('child_audit_log').select('summary').eq('id', audit?.id).single()).data
  check('the audit trail cannot be forged, edited or deleted from the app', !!forgeInsert.error && !forgeUpdate.data?.length && !forgeDelete.data?.length && auditNow?.summary === audit?.summary,
    `${errText(forgeInsert.error)} | ${auditNow?.summary}`)
  check('the audit trail never stores health values (summary is names and flags)', !/allerg|medic|diagnos/i.test(audit?.summary ?? ''))

  // 5. Access log ──────────────────────────────────────────────────────────────────────────────────
  console.log('\n5. Access log')
  const log = await o.from('document_access_log').insert({ user_id: people.ownerA.id, document_kind: 'child', document_id: fileA.id, center_id: A, child_id: childA.id, is_confidential: true }).select('id')
  check("ownerA's view of a child file can be logged", !log.error, errText(log.error))
  const seenByOwner = (await o.from('document_access_log').select('id').eq('child_id', childA.id)).data?.length ?? 0
  const seenByRegular = (await clients.regularA.from('document_access_log').select('id').eq('child_id', childA.id)).data?.length ?? 0
  const seenByOwnerB = (await clients.ownerB.from('document_access_log').select('id').eq('child_id', childA.id)).data?.length ?? 0
  check('ownerA can read the log; a regular employee and the other center cannot', seenByOwner >= 1 && seenByRegular === 0 && seenByOwnerB === 0, `${seenByOwner}/${seenByRegular}/${seenByOwnerB}`)

  // 6. Plan limit and cascade ──────────────────────────────────────────────────────────────────────
  console.log('\n6. Plan limit and deletion')
  const C = await makeCenter('limit', { subscription_tier: 'starter', subscription_status: 'active' })
  const batch = Array.from({ length: 25 }, (_, i) => ({ center_id: C, first_name: `K${i}`, last_name: 'Limit', date_of_birth: '2022-01-01' }))
  const fill = await admin.from('children').insert(batch)
  check('a Starter center can enroll 25 children', !fill.error, errText(fill.error))
  const over = await admin.from('children').insert({ center_id: C, first_name: 'K26', last_name: 'Limit', date_of_birth: '2022-01-01' })
  check('the 26th is refused with a clear message', !!over.error && /25/.test(over.error.message), errText(over.error) || 'it succeeded')
  await admin.from('centers').update({ subscription_status: 'trialing' }).eq('id', C)
  const trial = await admin.from('children').insert({ center_id: C, first_name: 'K26', last_name: 'Limit', date_of_birth: '2022-01-01' })
  check('a trial center is not limited', !trial.error, errText(trial.error))
  await admin.from('centers').update({ subscription_status: 'active', subscription_tier: 'growth' }).eq('id', C)
  const growth = await admin.from('children').insert({ center_id: C, first_name: 'K27', last_name: 'Limit', date_of_birth: '2022-01-01' })
  check('a Growth center is not limited', !growth.error, errText(growth.error))
  const gone = await admin.from('children').delete().eq('id', childA.id)
  const leftovers = await Promise.all(['child_guardians', 'child_documents', 'child_files'].map(async t => (await admin.from(t).select('id').eq('child_id', childA.id)).data?.length ?? 0))
  check('deleting a child removes its guardians, records and files without error', !gone.error && leftovers.every(n => n === 0), `${errText(gone.error)} ${leftovers}`)

  // 7. NC template ─────────────────────────────────────────────────────────────────────────────────
  console.log('\n7. NC template')
  const { seedNcChildRequirements, NC_CHILD_REQUIREMENTS } = await import('../../src/lib/child-template.ts')
  const first = await seedNcChildRequirements(clients.ownerA, A)
  check('the NC template adds every rule for the center', first.success && first.added === NC_CHILD_REQUIREMENTS.length, JSON.stringify(first))
  const again = await seedNcChildRequirements(clients.ownerA, A)
  check('running it again adds nothing', again.success && again.added === 0, JSON.stringify(again))
  const seeded = (await admin.from('center_document_requirements').select('section, audience, template_key, due_within_days, renewal_type, renewal_months, is_confidential').eq('center_id', A).like('template_key', 'nc-child:%')).data ?? []
  check('every rule is a confidential child rule in a child section', seeded.length === NC_CHILD_REQUIREMENTS.length && seeded.every(r => r.audience === 'child' && r.section.startsWith('child_') && r.is_confidential), `${seeded.length} rows`)
  const byKey = Object.fromEntries(seeded.map(r => [r.template_key.replace('nc-child:', ''), r]))
  check('first-day items are due on day 0; immunization and health assessment on day 30',
    byKey.application?.due_within_days === 0 && byKey['emergency-info']?.due_within_days === 0 && byKey['emergency-authorization']?.due_within_days === 0
      && byKey.immunization?.due_within_days === 30 && byKey['medical-report']?.due_within_days === 30)
  check('emergency information and the action plan renew every 12 months',
    byKey['emergency-info']?.renewal_type === 'interval' && byKey['emergency-info']?.renewal_months === 12
      && byKey['action-plan']?.renewal_type === 'interval' && byKey['action-plan']?.renewal_months === 12)
  const staffRules = (await admin.from('center_document_requirements').select('id').eq('center_id', A).eq('audience', 'staff')).data?.length
  check('staff rules are untouched (still exactly the one fixture)', staffRules === 1, `${staffRules}`)
  const staffSeeds = await seedNcChildRequirements(clients.regularA, A)
  const staffSeedsB = await seedNcChildRequirements(clients.regularA, B)
  check('a regular employee cannot add child rules to any center', staffSeeds.added === 0 && !staffSeedsB.success, JSON.stringify(staffSeedsB))

  // 8. A center with children is never deleted by accident ─────────────────────────────────────────
  console.log('\n8. Deliberate purge')
  const D = await makeCenter('keep')
  await must(admin.from('children').insert({ center_id: D, first_name: 'Keep', last_name: 'Safe', date_of_birth: '2022-01-01' }).select('id'), 'child D')
  const accidental = await admin.from('centers').delete().eq('id', D)
  check('a center that still has children cannot be deleted by accident', !!accidental.error, errText(accidental.error) || 'it was deleted')
  await admin.from('children').delete().eq('center_id', D)
  const deliberate = await admin.from('centers').delete().eq('id', D)
  check('once the children are removed on purpose the center can be deleted', !deliberate.error, errText(deliberate.error))

  // 9. The Child Files switch ──────────────────────────────────────────────────────────────────────
  console.log('')
  console.log('9. The Child Files switch')
  await admin.from('centers').update({ child_files_enabled: false }).eq('id', A)
  for (const t of TABLES) {
    const { data } = await clients.ownerA.from(t).select('id')
    check(`switch off: ownerA reads ${t} → 0 rows`, (data ?? []).length === 0, `${(data ?? []).length} row(s)`)
  }
  const offInsert = await clients.ownerA.from('children').insert(newChild(A)).select('id')
  check('switch off: ownerA cannot add a child', !!offInsert.error && !(offInsert.data?.length), errText(offInsert.error) || 'it succeeded')
  await clients.ownerA.from('centers').update({ child_files_enabled: true }).eq('id', A)
  const flagNow = (await admin.from('centers').select('child_files_enabled').eq('id', A).single()).data?.child_files_enabled
  check('a center owner cannot turn the switch on for their own center', flagNow === false, `flag is ${flagNow}`)
  const superU = await makeUser('superAdmin', { is_super_admin: true })
  const superClient = await signIn(superU)
  await superClient.from('centers').update({ child_files_enabled: true }).eq('id', A)
  const flagAfter = (await admin.from('centers').select('child_files_enabled').eq('id', A).single()).data?.child_files_enabled
  check('a super admin can turn the switch on', flagAfter === true, `flag is ${flagAfter}`)
  const superReads = await superClient.from('children').select('id')
  check('even a super admin cannot read child records through the app', (superReads.data ?? []).length === 0, `${(superReads.data ?? []).length} row(s)`)
  const back = await clients.ownerA.from('children').select('id')
  check('switch on again: ownerA sees the center children', (back.data ?? []).length >= 1, `${(back.data ?? []).length} row(s)`)

  // 10. The data layer the screens use ─────────────────────────────────────────────────────────────
  console.log('')
  console.log('10. Screen data layer (as the signed-in owner)')
  const kids = await import('../../src/lib/children.ts')
  const engine = await import('../../src/lib/compliance.ts')
  const ownerSb = clients.ownerA
  const today = new Date()
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const daysAgo = n => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n))
  const daysFromNow = n => daysAgo(-n)

  const added = await kids.addChild(ownerSb, A,
    { first_name: 'Cora', last_name: 'Data', date_of_birth: '2023-02-03', enrolled_on: daysAgo(40), first_attended_on: daysAgo(40), classroom_id: classA.id },
    [{ name: 'Dana Data', relationship: 'Mother', phone: '7045550100', email: 'dana@example.invalid' }, { name: 'Dale Data', relationship: 'Father' }])
  check('addChild creates an enrolled child', added.success && added.child.status === 'enrolled', JSON.stringify(added).slice(0, 200))
  const dataChild = added.child
  const contacts = (await admin.from('child_guardians').select('is_primary, can_pick_up').eq('child_id', dataChild.id)).data ?? []
  check('two contacts: the first is primary and nobody is authorized for pick-up by default',
    contacts.length === 2 && contacts.filter(g => g.is_primary).length === 1 && contacts.every(g => g.can_pick_up === false), JSON.stringify(contacts))

  const overview = await kids.loadChildrenOverview(ownerSb, A)
  check('the list loads the children, the NC child rules and the classrooms',
    overview.success && overview.children.some(c => c.id === dataChild.id) && overview.requirements.length >= 17 && overview.classrooms.length >= 1, overview.success ? `${overview.requirements.length} rules` : overview.error)

  const file = await kids.loadChildFile(ownerSb, dataChild.id)
  const rule = key => file.requirements.find(r => r.template_key === 'nc-child:' + key)
  const immunization = rule('immunization')
  const application = rule('application')
  const start = dataChild.first_attended_on
  const stateOf = (req, record) => engine.computeCompliance(req, record, start, null, today).state
  check('the file loads guardians, rules and the audit trail', !!file && file.guardians.length === 2 && file.audit.length >= 1 && !!immunization && !!application)
  check('40 days after the first day a missing immunization record is OVERDUE (30-day rule)', stateOf(immunization, null) === 'overdue', stateOf(immunization, null))
  check('a missing application is overdue (it was due on day 1)', stateOf(application, null) === 'overdue', stateOf(application, null))

  const extended = await kids.saveChildRecord(ownerSb, A, dataChild.id, immunization.id, { due_on: daysFromNow(20), review_notes: 'Physician certified a longer series' }, people.ownerA.id)
  check('the director can record a physician extension (a due date) with a comment', extended.success && extended.record.due_on === daysFromNow(20) && /Physician/.test(extended.record.review_notes ?? ''), extended.success ? '' : extended.error)
  check('with the extension the item is no longer overdue', extended.success && stateOf(immunization, extended.record) !== 'overdue', extended.success ? stateOf(immunization, extended.record) : '')
  const accepted = await kids.saveChildRecord(ownerSb, A, dataChild.id, immunization.id, { status: 'accepted', completed_on: daysAgo(5), due_on: null }, people.ownerA.id)
  check('accepting the record makes it current', accepted.success && stateOf(immunization, accepted.record) === 'current', accepted.success ? stateOf(immunization, accepted.record) : accepted.error)
  check('the record shows who reviewed it and when', accepted.success && accepted.record.reviewed_by === people.ownerA.id && !!accepted.record.reviewed_at)
  const auditAfter = (await ownerSb.from('child_audit_log').select('summary').eq('child_id', dataChild.id)).data ?? []
  check('the status change is in the audit trail by name, with no health details', auditAfter.some(a => /Immunization Record.*accepted/.test(a.summary ?? '')), JSON.stringify(auditAfter.map(a => a.summary)).slice(0, 200))

  const classified = await kids.setImmunizationStatus(ownerSb, dataChild.id, 'complete')
  check('the immunization status can be classified for the state report', classified.success && classified.child.immunization_status === 'complete')
  const withdrawn = await kids.withdrawChild(ownerSb, dataChild.id, daysAgo(0))
  check('withdrawing records the date that starts the 1-year retention clock', withdrawn.success && withdrawn.child.status === 'withdrawn' && withdrawn.child.withdrawn_on === daysAgo(0))
  const reenrolled = await kids.reenrollChild(ownerSb, dataChild.id, daysAgo(0))
  check('a withdrawn child can be re-enrolled', reenrolled.success && reenrolled.child.status === 'enrolled' && reenrolled.child.withdrawn_on === null)

  const pickup = await kids.saveGuardian(ownerSb, A, dataChild.id, { name: 'Pat Pickup', relationship: 'Aunt', can_pick_up: true })
  const pickupAudit = (await ownerSb.from('child_audit_log').select('summary').eq('child_id', dataChild.id)).data ?? []
  check('authorizing someone for pick-up is audited', pickup.success && pickupAudit.some(a => /Pat Pickup.*authorized to pick up/.test(a.summary ?? '')))
  const removedContact = await kids.deleteGuardian(ownerSb, pickup.guardian.id)
  check('a contact can be removed', removedContact.success)

  const regularFile = await kids.loadChildFile(clients.regularA, dataChild.id)
  check('a regular employee gets nothing from loadChildFile (the same answer as not found)', regularFile === null)
  const regularSave = await kids.saveChildRecord(clients.regularA, A, dataChild.id, immunization.id, { status: 'accepted' }, people.regularA.id)
  check('a regular employee cannot save a record', regularSave.success === false)
  const regularAdd = await kids.addChild(clients.regularA, A, { first_name: 'X', last_name: 'Y', date_of_birth: '2022-01-01' })
  check('a regular employee cannot add a child, and the message is a plain sentence', regularAdd.success === false && /not turned on|do not have access/.test(regularAdd.error), regularAdd.error)

  const tour = await must(admin.from('center_tour_requests').insert({
    center_id: A, first_name: 'Tess', last_name: 'Tour', email: 'tess@example.invalid', phone: '7045550111', tour_type: 'in_person',
    alternate_times: 'Weekdays after 3', children: [{ name: 'Milo Tour', dob: null }, { name: 'Nia', dob: '2024-01-02' }],
  }).select('*').single(), 'tour request')
  const enrolledFromTour = await kids.enrollFromTourRequest(ownerSb, tour, 0, { date_of_birth: '2023-06-07' })
  check('a tour request child becomes an enrolled child linked to the request',
    enrolledFromTour.success && enrolledFromTour.child.first_name === 'Milo' && enrolledFromTour.child.last_name === 'Tour' && enrolledFromTour.child.source_tour_request_id === tour.id,
    enrolledFromTour.success ? '' : enrolledFromTour.error)
  const tourGuardians = enrolledFromTour.success ? (await admin.from('child_guardians').select('is_primary, is_emergency_contact, can_pick_up').eq('child_id', enrolledFromTour.child.id)).data ?? [] : []
  check('the parent who asked is the primary and emergency contact, NOT authorized for pick-up',
    tourGuardians.length === 1 && tourGuardians[0].is_primary && tourGuardians[0].is_emergency_contact && tourGuardians[0].can_pick_up === false)
  const noSuchChild = await kids.enrollFromTourRequest(ownerSb, tour, 5, { date_of_birth: '2023-01-01' })
  check('a child that is not on the request is refused', noSuchChild.success === false)

  // 10. Managing the child checklist (About > Documents > Children) ────────────────────────────────
  console.log('\n10. Managing child requirements')
  const newRule = { center_id: A, audience: 'child', document_name: 'RLS Field Trip Permission', section: 'child_custom_enrichment', section_label: 'Enrichment', document_category: 'other', evidence_type: 'staff_document', is_required: true, is_confidential: true }
  const addRule = await ownerSb.from('center_document_requirements').insert(newRule).select('id').single()
  check('the owner can add a child requirement, including a custom child section', !addRule.error && !!addRule.data?.id, errText(addRule.error))
  const editRule = addRule.data ? await ownerSb.from('center_document_requirements').update({ due_within_days: 14, renewal_type: 'interval', renewal_months: 12 }).eq('id', addRule.data.id).select('due_within_days').single() : { error: { message: 'no rule' } }
  check('the owner can edit it (due date and renewal)', !editRule.error && editRule.data?.due_within_days === 14, errText(editRule.error))
  const childInStaff = await ownerSb.from('center_document_requirements').insert({ ...newRule, section: 'personnel', document_name: 'RLS bad 1' })
  check('a child requirement cannot be put in a staff section', !!childInStaff.error, 'inserted')
  const staffInChild = await ownerSb.from('center_document_requirements').insert({ ...newRule, audience: 'staff', document_name: 'RLS bad 2' })
  check('a staff requirement cannot be put in a child section', !!staffInChild.error, 'inserted')
  const staffView = (await ownerSb.from('center_document_requirements').select('id').eq('center_id', A).eq('audience', 'staff')).data ?? []
  check('the staff checklist never lists child requirements', !!addRule.data && !staffView.some(r => r.id === addRule.data.id))
  if (addRule.data) {
    await must(admin.from('child_documents').insert({ center_id: A, child_id: dataChild.id, requirement_id: addRule.data.id, status: 'accepted' }).select('id').single(), 'doc for rule')
    const ruleFile = await must(admin.from('child_files').insert({ center_id: A, child_id: dataChild.id, requirement_id: addRule.data.id, file_key: `child/${A}/${dataChild.id}/${randomUUID()}.pdf`, bucket_name: 'rls-test', file_name: 'permission.pdf' }).select('id').single(), 'file for rule')
    const delRule = await ownerSb.from('center_document_requirements').delete().eq('id', addRule.data.id).select('id')
    const leftover = (await admin.from('child_documents').select('id').eq('requirement_id', addRule.data.id)).data ?? []
    const keptFile = (await admin.from('child_files').select('id, requirement_id').eq('id', ruleFile.id).maybeSingle()).data
    check('deleting a rule removes its statuses but keeps the uploaded file, now unfiled', !delRule.error && delRule.data?.length === 1 && leftover.length === 0 && !!keptFile && keptFile.requirement_id === null, errText(delRule.error))
  }
  const regularRule = await clients.regularA.from('center_document_requirements').insert({ ...newRule, document_name: 'RLS regular' }).select('id')
  check('a regular employee cannot add a child requirement', !!regularRule.error || !regularRule.data?.length)
}

let crashed = null
try { await main() } catch (e) { crashed = e }
finally {
  try {
    await purgeCenters(created.centers)
    for (const id of created.users) await admin.auth.admin.deleteUser(id)
    console.log('\nfixtures removed')
  } catch (e) { console.log(`\ncleanup problem (run again to sweep): ${e.message}`) }
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (crashed) { console.log(`\nThe run stopped early: ${crashed.message}`); process.exit(1) }
if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1) }
console.log('All access rules hold.')

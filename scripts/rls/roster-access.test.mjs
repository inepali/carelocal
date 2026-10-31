#!/usr/bin/env node
/**
 * Access-rule tests for the Live Roster (roster_presence, roster_events, roster_snapshot, roster_apply,
 * roster_room_status).
 *
 * WHAT IT PROVES: the OWNER, ADMIN and active REGULAR teachers of a center can use its roster, and only when
 * the center has both the roster and Child Files switched on. A staff_admin, a substitute, someone from another
 * center and a signed-out visitor get nothing. Teachers get roster fields only and still cannot read the
 * children table. Nobody can write presence or the event log directly: every change goes through
 * roster_apply(), which logs check-ins, check-outs and moves exactly once. Ratio status per room and zone
 * follows the rules in the migration.
 *
 * SAFETY: same rails as child-access.test.mjs. It creates real (clearly marked) rows in whatever database
 * .env.local points at, so it ONLY runs against the development project and refuses production and any project
 * it does not recognize. Fixtures use the prefix "rls-test-" and the email domain "@rls-test.invalid" and are
 * deleted at the end (and swept on the next run if a run is interrupted).
 *
 *   npm run test:rls:roster
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
const denied = e => !!e && (e.code === '42501' || /not turned on|do not have access|permission denied/i.test(e.message ?? ''))

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
    await admin.from('children').delete().eq('center_id', id)        // children use ON DELETE RESTRICT; roster rows cascade
    await admin.from('centers').delete().eq('id', id)
  }
}

async function sweepStale() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const u of users?.users ?? []) if (u.email?.endsWith(`@${EMAIL_DOMAIN}`)) await admin.auth.admin.deleteUser(u.id)
  const { data: centers } = await admin.from('centers').select('id').like('slug', 'rls-test-%')
  await purgeCenters((centers ?? []).map(c => c.id))
}

const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
const apply = (client, center, { child = null, staff = null, area = null, zone, key = randomUUID() }) =>
  client.rpc('roster_apply', { p_center_id: center, p_child_id: child, p_staff_id: staff, p_area_id: area, p_zone: zone, p_client_key: key })

// ── The tests ────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Live Roster access-rule tests  ·  project ${REF} (development)  ·  run ${RUN}\n`)
  await sweepStale()

  // No early pick-up gate here (20261217): teachers check children out at any time of day in these tests
  const A = await makeCenter('a', { child_files_enabled: true, roster_enabled: true, early_pickup_before: '00:00' })
  const B = await makeCenter('b', { child_files_enabled: true, roster_enabled: true, early_pickup_before: '00:00' })
  const OFF = await makeCenter('off', { child_files_enabled: true })                 // roster switched off
  const people = {}
  for (const label of ['ownerA', 'adminA', 'staffAdminA', 'regularA', 'subA', 'outsider', 'ownerB']) people[label] = await makeUser(label)

  await must(admin.from('center_admins').insert([
    { center_id: A, user_id: people.ownerA.id, role: 'owner' },
    { center_id: A, user_id: people.adminA.id, role: 'admin' },
    { center_id: A, user_id: people.staffAdminA.id, role: 'staff_admin' },
    { center_id: B, user_id: people.ownerB.id, role: 'owner' },
    { center_id: OFF, user_id: people.ownerA.id, role: 'owner' },
  ]).select('id'), 'center_admins')
  const staffId = {
    regularA: await makeStaff(people.regularA, A, 'regular'),
    subA: await makeStaff(people.subA, A, 'substitute'),
    outsider: await makeStaff(people.outsider, B, 'regular'),
  }

  const clients = {}
  for (const [label, u] of Object.entries(people)) clients[label] = await signIn(u)
  clients.anonymous = createClient(URL_, ANON, NO_SESSION)

  const room = async (center, name, extra) => (await must(admin.from('work_areas').insert({ center_id: center, name, ...extra }).select('id').single(), name)).id
  const inf = await room(A, 'RLS Infants', { capacity: 8, ratio_children: 4, min_age_months: 0, max_age_months: 12 })
  const tod = await room(A, 'RLS Toddlers', { capacity: 12, ratio_children: 6, min_age_months: 12, max_age_months: 24 })
  const kitchen = await room(A, 'RLS Kitchen', { on_roster: false })
  const roomB = await room(B, 'RLS Room B', { capacity: 10, ratio_children: 10 })

  const kid = async (center, first, dob, classroom, extra = {}) =>
    (await must(admin.from('children').insert({ center_id: center, first_name: first, last_name: 'Roster', date_of_birth: dob, classroom_id: classroom, ...extra }).select('id').single(), first)).id
  const infants = []
  for (let i = 1; i <= 5; i++) infants.push(await kid(A, `Baby${i}`, daysAgo(120), inf, { custody_note: 'rls-test secret' }))
  const toddler = await kid(A, 'Theo', daysAgo(500), tod, { preferred_name: 'Teddy' })
  const childB = await kid(B, 'Bea', daysAgo(900), roomB)

  // 1. Who can use the roster ──────────────────────────────────────────────────────────────────────
  console.log('1. Who can use the roster')
  const mayUse = { ownerA: true, adminA: true, regularA: true }
  for (const [label, client] of Object.entries(clients)) {
    const { data, error } = await client.rpc('can_use_roster', { p_center_id: A })
    const got = label === 'anonymous' ? (error ? false : data) : data
    check(`${label.padEnd(11)} can_use_roster(A) = ${!!mayUse[label]}`, !!got === !!mayUse[label], errText(error) || String(data))
  }
  const off = await clients.ownerA.rpc('can_use_roster', { p_center_id: OFF })
  check('ownerA cannot use the roster where it is switched off', off.data === false, errText(off.error))

  // 2. Snapshot: roster fields only ────────────────────────────────────────────────────────────────
  console.log('\n2. Snapshot')
  const snap = await clients.regularA.rpc('roster_snapshot', { p_center_id: A })
  const rows = snap.data ?? []
  check('a regular teacher sees 6 children and 1 regular teacher (not the sub)',
    !snap.error && rows.filter(r => r.kind === 'child').length === 6 && rows.filter(r => r.kind === 'staff').length === 1, errText(snap.error) || `${rows.length} rows`)
  check('the snapshot uses the preferred name', rows.find(r => r.person_id === toddler)?.first_name === 'Teddy')
  check('the snapshot carries no custody, guardian or health fields', rows.every(r => !Object.keys(r).some(k => /custody|guardian|immuniz|allerg|note|birth/.test(k))), Object.keys(rows[0] ?? {}).join(','))
  const teacherKids = await clients.regularA.from('children').select('id')
  check('the teacher still cannot read the children table', (teacherKids.data ?? []).length === 0, `${(teacherKids.data ?? []).length} row(s)`)
  for (const label of ['staffAdminA', 'subA', 'outsider', 'ownerB', 'anonymous']) {
    const r = await clients[label].rpc('roster_snapshot', { p_center_id: A })
    check(`${label.padEnd(11)} cannot read center A's snapshot`, !!r.error && !(r.data?.length), errText(r.error) || 'it worked')
  }

  // 3. Moves ───────────────────────────────────────────────────────────────────────────────────────
  console.log('\n3. Moves through roster_apply')
  const t = clients.regularA
  const lastAction = async child => (await admin.from('roster_events').select('action, to_zone').eq('child_id', child).order('id', { ascending: false }).limit(1).single()).data
  const key = randomUUID()
  const first = await apply(t, A, { child: infants[0], area: inf, zone: 'classroom', key })
  check('check-in puts the child in the classroom', !first.error && first.data?.zone === 'classroom' && first.data?.work_area_id === inf, errText(first.error))
  check('…and logs a check_in', (await lastAction(infants[0]))?.action === 'check_in')
  await apply(t, A, { child: infants[0], area: inf, zone: 'classroom', key })
  await apply(t, A, { child: infants[0], area: inf, zone: 'classroom' })
  const count1 = (await admin.from('roster_events').select('id').eq('child_id', infants[0])).data?.length
  check('a repeated tap, or a move to where they already are, logs nothing more', count1 === 1, `${count1} events`)
  await apply(t, A, { child: infants[0], area: inf, zone: 'playground' })
  check('classroom to playground is a move_zone', (await lastAction(infants[0]))?.action === 'move_zone')
  await apply(t, A, { child: infants[0], area: tod, zone: 'classroom' })
  check('to another room is a move_room', (await lastAction(infants[0]))?.action === 'move_room')
  const out = await apply(t, A, { child: infants[0], zone: 'home' })
  check('home is a check_out that keeps the room they left', out.data?.zone === 'home' && out.data?.work_area_id === tod && (await lastAction(infants[0]))?.action === 'check_out', errText(out.error))

  const refused = async (what, call) => { const r = await call; check(what, !!r.error, errText(r.error) || 'it worked') }
  await refused('a room of another center is refused', apply(t, A, { child: infants[1], area: roomB, zone: 'classroom' }))
  await refused('a room that is not on the roster is refused', apply(t, A, { child: infants[1], area: kitchen, zone: 'classroom' }))
  await refused('a child of another center is refused', apply(t, A, { child: childB, area: inf, zone: 'classroom' }))
  await refused('checking in with no room is refused', apply(t, A, { child: infants[1], zone: 'classroom' }))
  await refused('a child and a staff member in one call is refused', apply(t, A, { child: infants[1], staff: staffId.regularA, area: inf, zone: 'classroom' }))
  for (const label of ['staffAdminA', 'subA', 'outsider', 'ownerB', 'anonymous']) {
    const r = await apply(clients[label], A, { child: infants[1], area: inf, zone: 'classroom' })
    check(`${label.padEnd(11)} cannot move center A's children`, denied(r.error) || !!r.error, errText(r.error) || 'it worked')
  }

  // 4. Direct writes and reads ──────────────────────────────────────────────────────────────────────
  console.log('\n4. Direct access to the tables')
  const today = (await clients.ownerA.rpc('roster_today', { p_center_id: A })).data
  const direct = await clients.ownerA.from('roster_presence').insert({ center_id: A, service_date: today, child_id: infants[2], zone: 'home' }).select('id')
  check('even the owner cannot write roster_presence directly', !!direct.error, errText(direct.error) || 'it worked')
  const forge = await clients.ownerA.from('roster_events').insert({ center_id: A, service_date: today, child_id: infants[2], action: 'check_in', from_zone: 'home', to_zone: 'classroom' })
  const edit = await clients.ownerA.from('roster_events').update({ action: 'check_out' }).eq('center_id', A).select('id')
  const del = await clients.ownerA.from('roster_events').delete().eq('center_id', A).select('id')
  check('the event log cannot be forged, edited or deleted from the app', !!forge.error && !edit.data?.length && !del.data?.length, errText(forge.error))
  const reads = async label => (await clients[label].from('roster_events').select('id').eq('center_id', A)).data?.length ?? 0
  check('roster users read center A events; others read none',
    (await reads('ownerA')) > 0 && (await reads('regularA')) > 0 && (await reads('subA')) === 0 && (await reads('ownerB')) === 0 && (await reads('anonymous')) === 0)

  // 5. Ratio status ──────────────────────────────────────────────────────────────────────────────────
  console.log('\n5. Ratio status')
  const o = clients.ownerA
  for (const c of infants) await apply(o, A, { child: c, area: inf, zone: 'classroom' })
  await apply(o, A, { staff: staffId.regularA, area: inf, zone: 'classroom' })
  const status = async () => (await o.rpc('roster_room_status', { p_center_id: A })).data ?? []
  let s = (await status()).find(r => r.work_area_id === inf && r.zone === 'classroom')
  check('5 infants at 1:4 with 1 teacher need 2 teachers, 1 short', s?.children === 5 && s?.teachers === 1 && s?.effective_ratio === 4 && s?.teachers_needed === 2 && s?.teachers_short === 1, JSON.stringify(s))
  await apply(o, A, { child: infants[4], area: inf, zone: 'playground' })
  const all = await status()
  const pg = all.find(r => r.work_area_id === inf && r.zone === 'playground')
  s = all.find(r => r.work_area_id === inf && r.zone === 'classroom')
  check('the playground is checked as its own group (1 child, no teacher, 1 short)', pg?.children === 1 && pg?.teachers_short === 1, JSON.stringify(pg))
  check('the 4 left in the classroom are in ratio, and the room still counts 5', s?.children === 4 && s?.teachers_short === 0 && s?.room_children === 5, JSON.stringify(s))
  await apply(o, A, { child: toddler, area: tod, zone: 'classroom' })
  await apply(o, A, { child: infants[3], area: tod, zone: 'classroom' })
  const tr = (await status()).find(r => r.work_area_id === tod && r.zone === 'classroom')
  check('a visiting infant tightens the toddler room from 1:6 to 1:4', tr?.effective_ratio === 4, JSON.stringify(tr))
  const theirs = await clients.subA.rpc('roster_room_status', { p_center_id: A })
  check('a substitute cannot read ratio status', !!theirs.error, errText(theirs.error) || 'it worked')

  // 6. Switch and guards ─────────────────────────────────────────────────────────────────────────────
  console.log('\n6. The roster switch and guards')
  await o.from('centers').update({ roster_enabled: false }).eq('id', A)
  check('a center owner cannot switch the roster off (or on)', (await admin.from('centers').select('roster_enabled').eq('id', A).single()).data?.roster_enabled === true)
  const superClient = await signIn(await makeUser('superAdmin', { is_super_admin: true }))
  await superClient.from('centers').update({ roster_enabled: true }).eq('id', OFF)
  check('a super admin can switch it on', (await admin.from('centers').select('roster_enabled').eq('id', OFF).single()).data?.roster_enabled === true)
  await admin.from('centers').update({ child_files_enabled: false }).eq('id', A)
  const noFiles = await o.rpc('roster_snapshot', { p_center_id: A })
  check('with Child Files off, the roster is off too', !!noFiles.error, errText(noFiles.error) || 'it worked')
  await admin.from('centers').update({ child_files_enabled: true }).eq('id', A)

  await clients.regularA.from('center_staff').update({ home_work_area_id: tod }).eq('staff_id', staffId.regularA)
  const homeNow = (await admin.from('center_staff').select('home_work_area_id').eq('staff_id', staffId.regularA).single()).data?.home_work_area_id
  check('a teacher cannot set their own home room', homeNow == null, `is ${homeNow}`)
  const wrongHome = await admin.from('center_staff').update({ home_work_area_id: roomB }).eq('staff_id', staffId.regularA)
  check('a home room in another center is refused', !!wrongHome.error, errText(wrongHome.error) || 'it worked')
  const badPhoto = await o.from('children').update({ photo_key: `child/${B}/${infants[0]}/photo.jpg` }).eq('id', infants[0]).select('id')
  check("a photo key outside the child's folder is refused", !!badPhoto.error, errText(badPhoto.error) || 'it worked')
  const goodPhoto = await o.from('children').update({ photo_key: `child/${A}/${infants[0]}/photo.jpg` }).eq('id', infants[0]).select('id')
  check("a photo key inside the child's folder is accepted", !goodPhoto.error && goodPhoto.data?.length === 1, errText(goodPhoto.error))
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
console.log('All roster access rules hold.')

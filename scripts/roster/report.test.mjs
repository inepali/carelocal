#!/usr/bin/env node
/**
 * Tests for the parent daily report email (src/lib/daily-report.ts).
 *
 *   npm run test:report
 */
import { buildDailyReport, reportSections, reportSenderName, reportTime } from '../../src/lib/daily-report.ts'

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}

const data = {
  child: { id: 'c1', first_name: 'Teddy' },
  center: { id: 'a', name: 'Kiddie Academy of Huntersville', email: 'office@example.com', phone: '704-555-0100', timezone: 'America/New_York', domain_key: 'childcare' },
  day: '2026-10-30',
  arrived_at: '2026-10-30T11:42:00Z',   // 7:42 AM EDT
  left_at: '2026-10-30T21:15:00Z',      // 5:15 PM
  recipients: ['pat@example.com'],
  entries: [
    { kind: 'meal', at: '2026-10-30T13:00:00Z', ends_at: null, details: { meal: 'breakfast', amount: 'all' }, checks: null },
    { kind: 'diaper', at: '2026-10-30T14:00:00Z', ends_at: null, details: { result: 'wet_bm', cream: true }, checks: null },
    { kind: 'medicine', at: '2026-10-30T16:00:00Z', ends_at: null, details: { name: 'Amoxicillin', dose: '5 ml' }, checks: null },
    { kind: 'meal', at: '2026-10-30T16:05:00Z', ends_at: null, details: { meal: 'lunch', amount: 'other', other: 'Only the pasta', note: 'Tired' }, checks: null },
    { kind: 'nap', at: '2026-10-30T16:30:00Z', ends_at: '2026-10-30T18:05:00Z', details: {}, checks: 6 },
    { kind: 'activity', at: '2026-10-30T19:00:00Z', ends_at: null, details: { text: 'Painting <with> sponges' }, checks: null },
    { kind: 'note', at: '2026-10-30T20:00:00Z', ends_at: null, details: { text: 'Happy all afternoon' }, checks: null },
    { kind: 'photo', at: '2026-10-30T19:05:00Z', ends_at: null, details: { photo_key: 'k1', caption: 'Tower' }, checks: null },
    { kind: 'photo', at: '2026-10-30T19:06:00Z', ends_at: null, details: { photo_key: 'k2' }, checks: null },
  ],
}

console.log('sections')
const s = reportSections(data)
const get = t => s.find(x => x.title === t)?.lines ?? []
check('times are in the center time zone', reportTime('2026-10-30T11:42:00Z', 'America/New_York') === '7:42 AM')
check('naps with length and sleep checks', get('Naps')[0] === '12:30 PM – 2:05 PM · 1 h 35 min · checked 6 times', get('Naps')[0])
check('meals in time order, other amounts in words, notes in brackets',
  get('Meals and bottles')[0] === '9:00 AM · Breakfast: all' && get('Meals and bottles')[1] === '12:05 PM · Lunch: Only the pasta (Tired)', get('Meals and bottles').join(' | '))
check('diapers', get('Diapers and bathroom')[0] === '10:00 AM · Diaper: Wet + BM, cream', get('Diapers and bathroom')[0])
check('medicine with name and dose', get('Medicine')[0] === '12:00 PM · Amoxicillin, 5 ml', get('Medicine')[0])
check('notes without times', get('Notes from the classroom')[0] === 'Happy all afternoon')
check('empty groups are left out', !s.some(x => x.lines.length === 0) && !s.some(x => x.title === 'Photos'))

console.log('email')
const r = buildDailyReport(data, { k1: 'https://r2.example/k1?sig=1', k2: 'https://r2.example/k2?sig=2' })
check('subject names the child, the center and the day', r.subject === "Teddy's day at Kiddie Academy of Huntersville · Friday, October 30", r.subject)
check('arrival and pick-up times', r.html.includes('Arrived 7:42 AM · Picked up 5:15 PM') && r.text.includes('Arrived 7:42 AM · Picked up 5:15 PM'))
check('text from teachers is escaped in the HTML', r.html.includes('Painting &lt;with&gt; sponges') && !r.html.includes('<with>'))
check('photos with signed links and the 7-day note', r.html.includes('https://r2.example/k1?sig=1') && r.html.includes('7 days') && r.text.includes('Tower: https://r2.example/k1?sig=1'))
check('no staff names, says it is from the teachers; reply reaches the center',
  r.html.includes("Teddy&#39;s teachers at Kiddie Academy of Huntersville") && r.text.includes('Reply to this email to reach the center.'))
const noPhotos = buildDailyReport(data, {})
check('a photo without a link is left out', !noPhotos.html.includes('Photos</h2>'))
const empty = buildDailyReport({ ...data, entries: [], center: { ...data.center, email: null } }, {})
check('a day with nothing recorded says so; no email means the phone number', empty.html.includes('No activities were recorded today.') && empty.text.includes('Call the center at 704-555-0100'))
check('sender name is safe for a From header', reportSenderName('Kiddie "Academy" <Main>') === 'Kiddie Academy Main via CareLocal' && reportSenderName('  ') === 'Your child care center via CareLocal')

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)

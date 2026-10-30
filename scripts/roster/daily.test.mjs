#!/usr/bin/env node
/**
 * Tests for the daily activities helpers (src/lib/daily.ts): how entries read on the child card and the
 * "Today at a glance" chips.
 *
 *   npm run test:daily
 */
import { BOTTLE_OUNCES, describeEntry, glanceChips, mealForTime, showsBottle, timeToIso, nowHHMM } from '../../src/lib/daily.ts'

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('describeEntry')
const d = (kind, details) => describeEntry({ kind, details })
check('meal', same(d('meal', { meal: 'lunch', amount: 'half' }), { title: 'Lunch', detail: 'Half' }))
check('meal, other amount shows the words', same(d('meal', { meal: 'am_snack', amount: 'other', other: 'Only the apple' }), { title: 'AM snack', detail: 'Only the apple' }))
check('bottle, half ounces', same(d('bottle', { oz: 4.5, contents: 'breast_milk' }), { title: 'Bottle', detail: '4.5 oz breast milk' }))
check('bottle, whole ounces', d('bottle', { oz: 6, contents: 'formula' }).detail === '6 oz formula')
check('bottle, other contents', d('bottle', { oz: 2, contents: 'other', other: 'Water' }).detail === '2 oz Water')
check('diaper with cream', same(d('diaper', { result: 'wet_bm', cream: true }), { title: 'Diaper', detail: 'Wet + BM, cream' }))
check('diaper without cream', d('diaper', { result: 'dry', cream: false }).detail === 'Dry')
check('bathroom with type', d('bathroom', { result: 'accident', type: 'wet' }).detail === 'Accident (wet)')
check('bathroom tried', d('bathroom', { result: 'tried' }).detail === 'Tried')
check('activity and note show their text', d('activity', { text: 'Painting' }).detail === 'Painting' && d('note', { text: 'Happy' }).title === 'Note')

console.log('glanceChips')
const e = (kind, details, at, voided = null) => ({ kind, details, at, voided_at: voided })
const chips = glanceChips([
  e('meal', { meal: 'lunch', amount: 'half' }, '2026-10-30T16:00:00Z'),
  e('meal', { meal: 'lunch', amount: 'all' }, '2026-10-30T16:10:00Z'),         // the later one wins
  e('meal', { meal: 'breakfast', amount: 'little' }, '2026-10-30T12:00:00Z'),
  e('bottle', { oz: 4.5 }, '2026-10-30T13:00:00Z'),
  e('bottle', { oz: 3 }, '2026-10-30T15:00:00Z'),
  e('diaper', { result: 'wet' }, '2026-10-30T13:00:00Z'),
  e('diaper', { result: 'bm' }, '2026-10-30T14:00:00Z'),
  e('diaper', { result: 'dry' }, '2026-10-30T15:00:00Z', '2026-10-30T15:01:00Z'),  // removed: left out
  e('activity', { text: 'Blocks' }, '2026-10-30T15:00:00Z'),
])
check('meals in day order, latest per meal; bottles totalled; removed left out',
  same(chips, ['Breakfast: little', 'Lunch: all', '2 bottles · 7.5 oz', '2 diapers', '1 activity']), chips.join(' | '))
const potty = glanceChips([e('bathroom', { result: 'went' }, 'a'), e('bathroom', { result: 'accident' }, 'b')])
check('bathroom count with accidents', same(potty, ['2 bathroom · 1 accident']), potty.join(' | '))
check('nothing yet, no chips', glanceChips([]).length === 0)

console.log('helpers')
check('bottle pad is 0.5 to 12 in halves', BOTTLE_OUNCES.length === 24 && BOTTLE_OUNCES[0] === 0.5 && BOTTLE_OUNCES[23] === 12)
check('bottles for under-3s only', showsBottle(10) && showsBottle(35) && !showsBottle(36) && !showsBottle(null))
const at = (h, m) => { const x = new Date(2026, 9, 30, h, m); return mealForTime(x) }
check('meal pre-selected by time of day', at(8, 0) === 'breakfast' && at(10, 0) === 'am_snack' && at(12, 0) === 'lunch' && at(15, 30) === 'pm_snack' && at(18, 0) === 'supper')
const base = new Date(2026, 9, 30, 15, 0)
const iso = timeToIso('13:05', base)
check('a picked time becomes today at that time', new Date(iso).getHours() === 13 && new Date(iso).getMinutes() === 5 && new Date(iso).getDate() === 30)
check('an empty or bad time means now (null)', timeToIso('', base) === null && timeToIso('1pm', base) === null)
check('now as HH:MM', nowHHMM(new Date(2026, 9, 30, 7, 4)) === '07:04')

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)

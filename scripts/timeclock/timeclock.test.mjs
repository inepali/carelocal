#!/usr/bin/env node
/**
 * Tests for the Time Clock helpers (src/lib/timeclock.ts).
 *
 *   npm run test:timeclock
 * Database tests: sh scripts/timeclock/run.sh
 */
import {
  normalizeTimePin, weakTimePinReason, timePinFromNumber, addDays, isoWeekday, periodFor, shiftPeriod, dayInZone, zonedToIso,
  hhmmInZone, formatMinutes, minutesToHours, timeOffByDay, buildTimesheet, timesheetCsv, entriesCsv,
} from '../../src/lib/timeclock.ts'

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('PINs')
check('normalizes', normalizeTimePin(' 48-21 ') === '4821')
check('needs 4 digits', normalizeTimePin('482') === null && normalizeTimePin('48215') === null && normalizeTimePin('48a1') === null)
check('same digit', !!weakTimePinReason('7777'))
check('in order', !!weakTimePinReason('1234') && !!weakTimePinReason('6543') && !!weakTimePinReason('0123'))
check('pattern', !!weakTimePinReason('3434'))
check('common', !!weakTimePinReason('1004'))
check('fine', weakTimePinReason('4821') === null && weakTimePinReason('9051') === null)
check('from number pads', timePinFromNumber(7) === '0007')
let threw = false; try { timePinFromNumber(10000) } catch { threw = true }
check('from number range', threw)

console.log('Pay periods')
check('weekday', isoWeekday('2026-11-16') === 1 && isoWeekday('2026-11-22') === 7)
check('weekly', eq(periodFor('2026-11-18', '2026-01-05', 'weekly'), { start: '2026-11-16', end: '2026-11-22' }))
check('weekly on the first day', eq(periodFor('2026-11-16', '2026-01-05', 'weekly'), { start: '2026-11-16', end: '2026-11-22' }))
check('biweekly', eq(periodFor('2026-11-18', '2026-01-05', 'biweekly'), { start: '2026-11-09', end: '2026-11-22' }))
check('biweekly next period', eq(periodFor('2026-11-25', '2026-01-05', 'biweekly'), { start: '2026-11-23', end: '2026-12-06' }))
check('biweekly other anchor', eq(periodFor('2026-11-25', '2026-11-16', 'biweekly'), { start: '2026-11-16', end: '2026-11-29' }))
check('before the anchor', eq(periodFor('2025-12-31', '2026-01-05', 'biweekly'), { start: '2025-12-22', end: '2026-01-04' }))
check('shift back', eq(shiftPeriod({ start: '2026-11-16', end: '2026-11-29' }, 'biweekly', -1), { start: '2026-11-02', end: '2026-11-15' }))
check('across a year end', addDays('2026-12-31', 1) === '2027-01-01')

console.log('Time zones')
check('day in zone', dayInZone('2026-11-17T03:30:00Z', 'America/New_York') === '2026-11-16')
check('wall clock to ISO (EST)', zonedToIso('2026-11-16', '08:15', 'America/New_York') === '2026-11-16T13:15:00.000Z')
check('wall clock to ISO (EDT)', zonedToIso('2026-07-01', '08:15', 'America/New_York') === '2026-07-01T12:15:00.000Z')
check('round trip', hhmmInZone(zonedToIso('2026-03-09', '06:45', 'America/Chicago'), 'America/Chicago') === '06:45')
check('minutes format', formatMinutes(125) === '2:05' && formatMinutes(0) === '0:00')
check('decimal hours', minutesToHours(125) === 2.08)

console.log('Timesheet')
check('time off split over weekdays', eq(timeOffByDay({ start_date: '2026-11-20', end_date: '2026-11-23', hours: 16 }), { '2026-11-20': 8, '2026-11-23': 8 }))
check('weekend-only time off on its first day', eq(timeOffByDay({ start_date: '2026-11-21', end_date: '2026-11-22', hours: 4 }), { '2026-11-21': 4 }))

const period = { start: '2026-11-16', end: '2026-11-29' }
const at = (day, hh, mm = 0) => `${day}T${String(hh + 5).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`  // EST
const entries = []
// Ana: week 1 five 9-hour days (45 h: 5 overtime); week 2 one 4-hour day split by lunch
for (let i = 0; i < 5; i++) {
  const d = addDays('2026-11-16', i)
  entries.push({ id: `a${i}`, center_staff_id: 'ana', name: 'Ana Lee', clock_in: at(d, 8), clock_out: at(d, 17), missed_out: false, day: d })
}
entries.push({ id: 'a5', center_staff_id: 'ana', name: 'Ana Lee', clock_in: at('2026-11-23', 8), clock_out: at('2026-11-23', 10), missed_out: false, day: '2026-11-23' })
entries.push({ id: 'a6', center_staff_id: 'ana', name: 'Ana Lee', clock_in: at('2026-11-23', 10, 30), clock_out: at('2026-11-23', 12, 30), missed_out: false, day: '2026-11-23' })
// Bo: one missed clock-out from before, one still open, one outside the period
entries.push({ id: 'b1', center_staff_id: 'bo', name: 'Bo Kim', clock_in: at('2026-11-10', 8), clock_out: null, missed_out: true, day: '2026-11-10' })
entries.push({ id: 'b2', center_staff_id: 'bo', name: 'Bo Kim', clock_in: at('2026-11-24', 8), clock_out: null, missed_out: false, day: '2026-11-24' })
entries.push({ id: 'b3', center_staff_id: 'bo', name: 'Bo Kim', clock_in: at('2026-11-30', 8), clock_out: at('2026-11-30', 9), missed_out: false, day: '2026-11-30' })
const timeOff = [
  { id: 't1', center_staff_id: 'cy', name: '=Cy Ray', kind: 'pto', start_date: '2026-11-27', end_date: '2026-12-01', hours: 24, status: 'approved' },
  { id: 't2', center_staff_id: 'bo', name: 'Bo Kim', kind: 'sick', start_date: '2026-11-25', end_date: '2026-11-25', hours: 8, status: 'pending' },
  { id: 't3', center_staff_id: 'ana', name: 'Ana Lee', kind: 'unpaid', start_date: '2026-11-24', end_date: '2026-11-24', hours: 4, status: 'approved' },
]
const sheet = buildTimesheet(entries, timeOff, period)
const ana = sheet.find(r => r.center_staff_id === 'ana')
const bo = sheet.find(r => r.center_staff_id === 'bo')
const cy = sheet.find(r => r.center_staff_id === 'cy')
check('Ana worked 49 h', ana.worked === 49 * 60, String(ana.worked))
check('Ana overtime 5 h (week 1 only)', ana.overtime === 5 * 60 && ana.weeks[1].overtime === 0)
check('Ana regular 44 h', ana.regular === 44 * 60)
check('two periods on one day add up', ana.days['2026-11-23'] === 240)
check('approved unpaid counted', ana.unpaid === 4)
check('Bo: missed and open flagged, nothing worked', bo.missed === 1 && bo.open === 1 && bo.worked === 0)
check('pending sick not counted', bo.sick === 0)
check('PTO only inside the period (Fri 27 = 8 h of 3 weekdays)', cy.pto === 8, String(cy.pto))
check('sorted by name', sheet.map(r => r.name).join('|') === '=Cy Ray|Ana Lee|Bo Kim')

const csv = timesheetCsv(sheet, period)
check('CSV header', csv.startsWith('Name,Period start,Period end,Regular hours'))
check('CSV formula guard', csv.includes("'=Cy Ray"))
check('CSV Ana line', csv.includes('Ana Lee,2026-11-16,2026-11-29,44,5,49,0,0,4,0'))
const ecsv = entriesCsv(entries, period, 'America/New_York')
check('entries CSV in center time', ecsv.includes('Ana Lee,2026-11-16,8:00 AM,5:00 PM,9,'))
check('entries CSV notes', ecsv.includes('Still clocked in') && !ecsv.includes('2026-11-30'))

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) { console.log('Failed:', failures.join('; ')); process.exit(1) }

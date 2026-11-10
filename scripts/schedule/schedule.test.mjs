#!/usr/bin/env node
/**
 * Tests for the staff schedule helpers (src/lib/schedule.ts): time math, snapping, the pattern pre-check (which must
 * refuse what public.schedule_fixed_save() refuses) and lane packing for the board.
 *
 *   npm run test:schedule
 */
import {
  toMinutes, fromMinutes, snapMinutes, formatTime, formatRange, timeOptions, blockHours, checkPattern, copyDay,
  packLanes, boxPosition, hourMarks, shortName, weekdayOf, addDays, scheduleWeekdays, sortBlocks,
  teachersNeeded, coverage, coverageTone, dragMinutes, minutesAt, applyDrag, dropBlock, overlapsOwn,
} from '../../src/lib/schedule.ts'

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('time math')
check('toMinutes', toMinutes('07:30') === 450 && toMinutes('18:00') === 1080 && toMinutes('07:30:00') === 450)
check('toMinutes bad', Number.isNaN(toMinutes('soon')) && Number.isNaN(toMinutes('25:00')))
check('fromMinutes', fromMinutes(450) === '07:30' && fromMinutes(0) === '00:00')
check('snap 15', snapMinutes(452, 15) === 450 && snapMinutes(458, 15) === 465)
check('snap 30 + clamp', snapMinutes(430, 30, 420, 1080) === 420 && snapMinutes(1200, 30, 420, 1080) === 1080)
check('formatTime', formatTime('07:00') === '7 AM' && formatTime('13:30') === '1:30 PM' && formatTime('12:00') === '12 PM' && formatTime('00:15') === '12:15 AM')
check('formatRange', formatRange('07:00', '15:00') === '7–3' && formatRange('07:30', '13:15') === '7:30–1:15')
check('timeOptions 30', eq(timeOptions('07:00', '09:00', 30), ['07:00', '07:30', '08:00', '08:30', '09:00']))
check('timeOptions keeps saved off-snap value', timeOptions('07:00', '08:00', 30, ['07:15']).join() === '07:00,07:15,07:30,08:00')
check('blockHours', blockHours([{ start: '07:00', end: '15:00' }, { start: '07:00', end: '07:30' }]) === 8.5)

console.log('pattern check (mirrors the database)')
const S = { day_start: '07:00', day_end: '18:00', weekends: false }
const b = (weekday, start, end, room_id = null) => ({ weekday, start, end, room_id })
check('ok week', checkPattern([1, 2, 3, 4, 5].map(d => b(d, '07:00', '15:00', 'r')), S) === null)
check('split day ok', checkPattern([b(1, '07:00', '13:00', 'a'), b(1, '13:00', '15:00', 'b')], S) === null)
check('overlap', /overlap/.test(checkPattern([b(1, '07:00', '13:00'), b(1, '12:00', '15:00')], S) ?? ''))
check('end after start', /end after/.test(checkPattern([b(1, '13:00', '13:00')], S) ?? ''))
check('15-minute steps', /15-minute/.test(checkPattern([b(1, '07:10', '13:00')], S) ?? ''))
check('outside the day', /outside/.test(checkPattern([b(1, '06:30', '13:00')], S) ?? ''))
check('weekend off', /Monday to Friday/.test(checkPattern([b(6, '08:00', '12:00')], S) ?? ''))
check('weekend on', checkPattern([b(6, '08:00', '12:00')], { ...S, weekends: true }) === null)
check('6 a day', /6 blocks/.test(checkPattern([0, 1, 2, 3, 4, 5, 6].map(i => b(1, fromMinutes(420 + i * 15), fromMinutes(435 + i * 15))), S) ?? ''))

console.log('editing')
const copied = copyDay([b(1, '07:00', '15:00', 'a'), b(1, '15:00', '16:00', null), b(3, '09:00', '10:00')], 1, [2, 3, 4, 5])
check('copy Monday to the week', copied.length === 10 && copied.filter(x => x.weekday === 3).length === 2 && !copied.some(x => x.start === '09:00'))
check('sort Monday first, Sunday last', eq(sortBlocks([b(0, '07:00', '08:00'), b(2, '09:00', '10:00'), b(2, '07:00', '08:00')]).map(x => `${x.weekday}${x.start}`), ['207:00', '209:00', '007:00']))
check('weekdays', eq(scheduleWeekdays(false), [1, 2, 3, 4, 5]) && eq(scheduleWeekdays(true), [1, 2, 3, 4, 5, 6, 0]))

console.log('board layout')
const lanes = packLanes([{ id: 'a', start: '07:00', end: '13:00' }, { id: 'b', start: '13:00', end: '18:00' }, { id: 'c', start: '09:00', end: '15:00' }])
check('back-to-back share a lane, overlap stacks', lanes.lanes === 2
  && lanes.placed.find(p => p.item.id === 'a').lane === 0 && lanes.placed.find(p => p.item.id === 'b').lane === 0 && lanes.placed.find(p => p.item.id === 'c').lane === 1)
check('empty room', packLanes([]).lanes === 0)
const pos = boxPosition('09:45', '12:30', '07:00', '18:00')
check('box position', Math.abs(pos.left - 25) < 1e-9 && Math.abs(pos.width - 25) < 1e-9)
check('box clamps to the day', eq(boxPosition('06:00', '08:00', '07:00', '08:00'), { left: 0, width: 100 }))
check('hour marks', eq(hourMarks('06:30', '09:00'), ['07:00', '08:00', '09:00']))

console.log('names and dates')
check('shortName', shortName({ first_name: 'Ana', last_name: 'Lee' }) === 'Ana L.' && shortName({ first_name: ' ', last_name: null }) === 'Staff')
check('weekdayOf', weekdayOf('2026-11-10') === 2 && weekdayOf('2026-11-15') === 0)
check('addDays across a month', addDays('2026-11-29', 3) === '2026-12-02' && addDays('2026-03-08', 1) === '2026-03-09')

console.log('daily board')
check('teachers needed', teachersNeeded({ ratio: 4, enrolled: 5 }) === 2 && teachersNeeded({ ratio: null, enrolled: 5 }) === 0 && teachersNeeded({ ratio: 4, enrolled: 0 }) === 0)
check('coverage runs', eq(coverage([{ start: '07:00', end: '15:00' }, { start: '09:00', end: '18:00' }], '07:00', '18:00'),
  [{ start: '07:00', end: '09:00', count: 1 }, { start: '09:00', end: '15:00', count: 2 }, { start: '15:00', end: '18:00', count: 1 }]))
check('coverage gap and merge', eq(coverage([{ start: '07:00', end: '09:00' }, { start: '09:00', end: '10:00' }], '07:00', '11:00'),
  [{ start: '07:00', end: '10:00', count: 1 }, { start: '10:00', end: '11:00', count: 0 }]))
check('coverage empty room', eq(coverage([], '07:00', '18:00'), [{ start: '07:00', end: '18:00', count: 0 }]))
check('coverage tone', coverageTone(0, 2) === 'empty' && coverageTone(1, 2) === 'short' && coverageTone(2, 2) === 'ok' && coverageTone(0, 0) === 'none')
check('drag minutes', dragMinutes(110, 660, '07:00', '18:00') === 110)
check('minutes at pointer, snapped', minutesAt(127, 660, '07:00', '18:00', 15) === '09:00' && minutesAt(-50, 660, '07:00', '18:00', 30) === '07:00')
check('move keeps length, snaps', eq(applyDrag({ start: '07:00', end: '15:00' }, 'move', 68, 15, '07:00', '18:00'), { start: '08:15', end: '16:15' }))
check('move stops at the day end', eq(applyDrag({ start: '07:00', end: '15:00' }, 'move', 600, 15, '07:00', '18:00'), { start: '10:00', end: '18:00' }))
check('move stops at the day start', eq(applyDrag({ start: '08:00', end: '09:00' }, 'move', -200, 30, '07:00', '18:00'), { start: '07:00', end: '08:00' }))
check('resize start, min one slot', eq(applyDrag({ start: '07:00', end: '08:00' }, 'start', 120, 15, '07:00', '18:00'), { start: '07:45', end: '08:00' }))
check('resize end, snapped', eq(applyDrag({ start: '07:00', end: '15:00' }, 'end', 50, 30, '07:00', '18:00'), { start: '07:00', end: '16:00' }))
check('drop from tray: 8 hours', eq(dropBlock('09:05', 15, '07:00', '18:00'), { start: '09:00', end: '17:00' }))
check('drop late: until close, at least an hour', eq(dropBlock('17:45', 15, '07:00', '18:00'), { start: '17:00', end: '18:00' }))
const own = [{ id: 'a', staff_id: 's', start: '07:00', end: '12:00' }, { id: 'b', staff_id: 't', start: '12:00', end: '13:00' }]
check('overlap own', overlapsOwn(own, 's', '11:00', '13:00') && !overlapsOwn(own, 's', '12:00', '13:00') && !overlapsOwn(own, 's', '08:00', '09:00', 'a'))

console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : `\nALL ${passed} PASSED`)
process.exit(failures.length ? 1 : 0)

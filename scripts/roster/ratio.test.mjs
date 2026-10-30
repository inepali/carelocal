#!/usr/bin/env node
/**
 * Fixture tests for the Live Roster ratio engine (src/lib/roster-ratio.ts).
 * The same cases are what public.roster_room_status() in the database must agree on.
 *
 *   npm run test:roster
 */
import { allRoomStatuses, centerTotals, childAgeRatio, peopleInRoom, roomStatus, simulateMove, waitingForRoom } from '../../src/lib/roster-ratio.ts'

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}

const ROOMS = [
  { id: 'inf', name: 'Infants', capacity: 8, ratio_children: 4, min_age_months: 0, max_age_months: 12 },
  { id: 'tod', name: 'Toddlers', capacity: 12, ratio_children: 6, min_age_months: 12, max_age_months: 24 },
  { id: 'two', name: 'Twos', capacity: 15, ratio_children: 10, min_age_months: 24, max_age_months: 36 },
  { id: 'pk', name: 'Pre-K', capacity: 3, ratio_children: 20, min_age_months: 48, max_age_months: 60 },
  { id: 'open', name: 'Gym', capacity: null, ratio_children: null, min_age_months: null, max_age_months: null },
]
let n = 0
const kid = (room, zone, age, home = room) => ({ kind: 'child', person_id: `k${++n}`, first_name: `Kid${n}`, last_initial: 'R', photo: null, age_months: age, home_area_id: home, employment: null, work_area_id: room, zone, updated_at: null })
const tchr = (room, zone, home = room) => ({ kind: 'staff', person_id: `t${++n}`, first_name: `Tchr${n}`, last_initial: 'T', photo: null, age_months: null, home_area_id: home, employment: 'regular', work_area_id: room, zone, updated_at: null })
const room = id => ROOMS.find(r => r.id === id)

console.log('Ratio engine')

// 1. Basic need and shortfall
{
  const people = [...Array.from({ length: 5 }, () => kid('inf', 'classroom', 4)), tchr('inf', 'classroom')]
  const s = roomStatus(room('inf'), people, ROOMS)
  check('5 infants at 1:4 with 1 teacher need 2, 1 short, Out of ratio', s.groups.classroom.needed === 2 && s.short === 1 && s.code === 'out' && s.label === 'Out of ratio', JSON.stringify(s.groups.classroom))
}
// 2. Exactly full is At limit
{
  const people = [...Array.from({ length: 4 }, () => kid('inf', 'classroom', 4)), tchr('inf', 'classroom')]
  const s = roomStatus(room('inf'), people, ROOMS)
  check('4 infants with 1 teacher is At limit', s.code === 'warn' && s.label === 'At limit', s.label)
}
// 3. Comfortably in ratio
{
  const people = [...Array.from({ length: 3 }, () => kid('tod', 'classroom', 15)), tchr('tod', 'classroom')]
  check('3 toddlers with 1 teacher is In ratio', roomStatus(room('tod'), people, ROOMS).code === 'ok')
}
// 4. Groups are separate: playground with no teacher
{
  const people = [...Array.from({ length: 4 }, () => kid('inf', 'classroom', 4)), kid('inf', 'playground', 4), tchr('inf', 'classroom')]
  const s = roomStatus(room('inf'), people, ROOMS)
  check('an infant on the playground with no teacher is its own short group', s.groups.playground.short === 1 && s.groups.classroom.short === 0 && s.code === 'out', JSON.stringify(s.groups.playground))
  check('the room still counts all 5 children', s.childrenIn === 5)
}
// 5. Lobby is its own group too
{
  const people = [kid('tod', 'lobby', 15), kid('tod', 'lobby', 15), tchr('tod', 'classroom')]
  const s = roomStatus(room('tod'), people, ROOMS)
  check('2 toddlers in the lobby with no teacher make the room Out of ratio', s.groups.lobby.short === 1 && s.code === 'out')
}
// 6. Visiting younger child tightens the ratio
{
  const people = [kid('tod', 'classroom', 15), kid('tod', 'classroom', 5, 'inf'), tchr('tod', 'classroom')]
  const s = roomStatus(room('tod'), people, ROOMS)
  check('a visiting infant tightens the toddler room from 1:6 to 1:4', s.groups.classroom.effectiveRatio === 4 && s.effectiveRatio === 4)
  check('…and counts as visiting', s.visiting === 1)
}
// 7. Age rule falls back to the home room when no range covers the child
{
  const k = kid('tod', 'classroom', 40, 'two')   // 40 months: no room covers 36–48
  check('no covering age range: the home room ratio applies', childAgeRatio(k, ROOMS) === 10)
}
// 8. Older visitor does not loosen the ratio
{
  const people = [kid('inf', 'classroom', 4), kid('inf', 'classroom', 50, 'pk'), tchr('inf', 'classroom')]
  check('an older visitor never loosens an infant room', roomStatus(room('inf'), people, ROOMS).groups.classroom.effectiveRatio === 4)
}
// 9. Capacity counts every zone
{
  const people = [kid('pk', 'classroom', 50), kid('pk', 'classroom', 50), kid('pk', 'lobby', 50), kid('pk', 'playground', 50), tchr('pk', 'classroom'), tchr('pk', 'lobby'), tchr('pk', 'playground')]
  const s = roomStatus(room('pk'), people, ROOMS)
  check('4 children in a capacity-3 room is Over capacity even split across zones', s.code === 'out' && s.label === 'Over capacity')
}
// 10. Checked-out children do not count
{
  const people = [kid('inf', 'classroom', 4), kid('inf', 'home', 4), tchr('inf', 'classroom')]
  check('a checked-out child does not count', roomStatus(room('inf'), people, ROOMS).childrenIn === 1)
}
// 11. Empty rooms and teachers alone
{
  check('a room with no one is No children', roomStatus(room('two'), [], ROOMS).code === 'empty')
  const g = roomStatus(room('two'), [tchr('two', 'classroom')], ROOMS).groups.classroom
  check('a teacher alone is No children, not out of ratio', g.code === 'empty' && g.label === 'No children')
}
// 12. A room with no ratio is not ratio-checked
{
  const people = [kid('open', 'classroom', 50, 'pk'), kid('open', 'classroom', 50, 'pk')]
  const s = roomStatus(room('open'), people, ROOMS)
  check('a room with no ratio still takes the children\'s age ratio (1:20) and needs a teacher', s.groups.classroom.effectiveRatio === 20 && s.short === 1)
  const noAge = [{ ...kid('open', 'classroom', null, null) }]
  check('with no ratio and no age rule, no teacher is required', roomStatus(room('open'), noAge, ROOMS).short === 0)
}
// 13. 24 children need 2 teachers at 1:15
{
  const people = [...Array.from({ length: 24 }, () => kid('pk', 'classroom', 50)), tchr('pk', 'classroom')]
  const s = roomStatus({ ...room('pk'), capacity: 24, ratio_children: 15 }, people, ROOMS.map(r => r.id === 'pk' ? { ...r, ratio_children: 15 } : r))
  check('24 Pre-K at 1:15 with 1 teacher need 2 (1 short)', s.needed === 2 && s.short === 1)
}
// 14. simulateMove + totals + seating
{
  const t = tchr('inf', 'classroom')
  const ks = Array.from({ length: 5 }, () => kid('inf', 'classroom', 4))
  const floater = tchr(null, 'home', null)
  const people = [...ks, t, floater]
  const before = allRoomStatuses(ROOMS, people)
  const after = allRoomStatuses(ROOMS, simulateMove(people, floater.person_id, { work_area_id: 'inf', zone: 'classroom' }))
  check('sending a floater fixes the infant room', before.inf.code === 'out' && after.inf.code !== 'out', `${before.inf.label} → ${after.inf.label}`)
  const out = simulateMove(people, ks[0].person_id, { work_area_id: null, zone: 'home' })
  check('checking out keeps the room they left', out.find(p => p.person_id === ks[0].person_id).work_area_id === 'inf')
  const totals = centerTotals(ROOMS, people, before)
  check('totals: 5 of 5 children in, 1 of 2 staff in, 4 of 5 rooms in ratio', totals.childrenIn === 5 && totals.staffIn === 1 && totals.staffTotal === 2 && totals.roomsInRatio === 4, JSON.stringify(totals))
  const notSeen = kid(null, 'home', 4, 'inf')
  const seats = peopleInRoom('inf', [...out, notSeen])
  check('the home band lists checked-out and not-yet-arrived children of the room', seats.home.length === 2 && seats.classroom.length === 5, `${seats.home.length} home, ${seats.classroom.length} in`)
  check('teachers are listed before children', seats.classroom[0].kind === 'staff')
}

// 15. Waiting in the Lobby: no home room and not checked in
{
  const floaterOut = { ...tchr('inf', 'home', null) }            // checked out of Infants, no home room
  const floaterNew = tchr(null, 'home', null)                    // not seen today
  const floaterIn = tchr('tod', 'classroom', null)               // working in Toddlers
  const kidNoRoom = kid(null, 'home', 30, null)                   // enrolled, no home room yet
  const people = [floaterOut, floaterNew, floaterIn, kidNoRoom, kid('inf', 'home', 4)]
  const w = waitingForRoom(people)
  check('waiting lists floaters and children with no home room who are not checked in', w.length === 3 && w.includes(kidNoRoom) && !w.includes(floaterIn), `${w.length}`)
  check('waiting lists teachers first', w[0].kind === 'staff' && w.at(-1).kind === 'child')
  const seats = peopleInRoom('inf', people)
  check('a checked-out floater does not also sit in the Home band of the room they left', !seats.home.includes(floaterOut) && seats.home.length === 1, `${seats.home.length}`)
  check('a floater working in a room still sits in that room', peopleInRoom('tod', people).classroom.includes(floaterIn))
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1) }

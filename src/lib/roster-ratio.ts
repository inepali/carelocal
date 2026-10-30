// Self-contained on purpose (no imports, no path aliases) so the fixture tests can load it with plain node.

/**
 * The Live Roster ratio engine. One pure function decides every badge, count and alert on the board, and the
 * same rules live in the database (public.roster_room_status in 20261208000000_live_roster.sql). Keep the two
 * in step: scripts/roster/ratio.test.mjs checks the cases both must agree on.
 *
 * Rules
 *  1. Each room's Classroom, Playground and Lobby are separate groups. A group needs
 *     ceil(children / effective ratio) teachers present in that same group.
 *  2. Effective ratio = the room's own 1:N, tightened by the age ratio of the youngest child in the group:
 *     the smallest N among on-roster rooms whose age range covers the child, else the child's home room's N.
 *  3. Room status, first match wins: Over capacity (children in all zones > capacity), Out of ratio (any group
 *     short a teacher), At limit (a group exactly full, or the room at capacity), In ratio, No children.
 *  4. A room with no ratio set and no age rule from its children is not ratio-checked (needs 0 teachers).
 */

export type RosterZone = 'home' | 'classroom' | 'playground' | 'lobby'
export const ON_SITE_ZONES = ['classroom', 'playground', 'lobby'] as const
export type OnSiteZone = (typeof ON_SITE_ZONES)[number]

export interface RosterRoom {
  id: string
  name: string
  capacity: number | null
  ratio_children: number | null
  min_age_months: number | null
  max_age_months: number | null
}

/** One row of public.roster_snapshot() */
export interface RosterPerson {
  kind: 'child' | 'staff'
  person_id: string
  first_name: string
  last_initial: string
  photo: string | null
  age_months: number | null
  home_area_id: string | null
  employment: 'regular' | 'substitute' | null
  work_area_id: string | null
  zone: RosterZone
  updated_at: string | null
}

export type StatusCode = 'ok' | 'warn' | 'out' | 'empty'

export interface GroupStatus {
  zone: OnSiteZone
  children: number
  teachers: number
  effectiveRatio: number | null
  needed: number
  short: number
  code: StatusCode
  label: string
}

export interface RoomStatus {
  roomId: string
  childrenIn: number
  teachersIn: number
  capacity: number | null
  /** Strictest ratio across the room's groups (what the room card shows) */
  effectiveRatio: number | null
  needed: number
  short: number
  visiting: number
  groups: Record<OnSiteZone, GroupStatus>
  code: StatusCode
  label: string
}

const isOnSite = (p: Pick<RosterPerson, 'zone' | 'work_area_id'>) => p.zone !== 'home' && !!p.work_area_id

/** The age ratio for one child: the strictest on-roster room whose age range covers them, else their home room */
export function childAgeRatio(child: Pick<RosterPerson, 'age_months' | 'home_area_id'>, rooms: RosterRoom[]): number | null {
  let best: number | null = null
  if (child.age_months != null) {
    for (const r of rooms) {
      if (r.ratio_children == null || r.min_age_months == null || r.max_age_months == null) continue
      if (child.age_months >= r.min_age_months && child.age_months < r.max_age_months) {
        best = best == null ? r.ratio_children : Math.min(best, r.ratio_children)
      }
    }
  }
  if (best != null) return best
  return rooms.find(r => r.id === child.home_area_id)?.ratio_children ?? null
}

function groupStatus(zone: OnSiteZone, room: RosterRoom, kids: RosterPerson[], teachers: number, rooms: RosterRoom[]): GroupStatus {
  let eff = room.ratio_children
  for (const k of kids) {
    const r = childAgeRatio(k, rooms)
    if (r != null) eff = eff == null ? r : Math.min(eff, r)
  }
  const children = kids.length
  const needed = eff == null || children === 0 ? 0 : Math.ceil(children / eff)
  const short = Math.max(0, needed - teachers)
  let code: StatusCode = 'ok'
  let label = 'In ratio'
  if (children === 0) { code = 'empty'; label = teachers ? 'No children' : 'Empty' }
  else if (short > 0) { code = 'out'; label = 'Out of ratio' }
  else if (eff != null && children === teachers * eff) { code = 'warn'; label = 'At limit' }
  return { zone, children, teachers, effectiveRatio: eff, needed, short, code, label }
}

export function roomStatus(room: RosterRoom, people: RosterPerson[], rooms: RosterRoom[]): RoomStatus {
  const here = people.filter(p => p.work_area_id === room.id && isOnSite(p))
  const kids = here.filter(p => p.kind === 'child')
  const staff = here.filter(p => p.kind === 'staff')

  const groups = Object.fromEntries(ON_SITE_ZONES.map(z => [
    z, groupStatus(z, room, kids.filter(k => k.zone === z), staff.filter(t => t.zone === z).length, rooms),
  ])) as Record<OnSiteZone, GroupStatus>

  const list = ON_SITE_ZONES.map(z => groups[z])
  const needed = list.reduce((n, g) => n + g.needed, 0)
  const short = list.reduce((n, g) => n + g.short, 0)
  const ratios = list.filter(g => g.children > 0).map(g => g.effectiveRatio).filter((r): r is number => r != null)
  const effectiveRatio = ratios.length ? Math.min(...ratios) : room.ratio_children

  let code: StatusCode = 'ok'
  let label = 'In ratio'
  if (kids.length === 0) { code = 'empty'; label = 'No children' }
  else if (room.capacity != null && kids.length > room.capacity) { code = 'out'; label = 'Over capacity' }
  else if (short > 0) { code = 'out'; label = 'Out of ratio' }
  else if (list.some(g => g.code === 'warn') || (room.capacity != null && kids.length === room.capacity)) { code = 'warn'; label = 'At limit' }

  return {
    roomId: room.id,
    childrenIn: kids.length,
    teachersIn: staff.length,
    capacity: room.capacity,
    effectiveRatio,
    needed,
    short,
    visiting: kids.filter(k => k.home_area_id && k.home_area_id !== room.id).length,
    groups,
    code,
    label,
  }
}

export function allRoomStatuses(rooms: RosterRoom[], people: RosterPerson[]): Record<string, RoomStatus> {
  return Object.fromEntries(rooms.map(r => [r.id, roomStatus(r, people, rooms)]))
}

/** What the board would look like if one person moved: used for drop previews and the "Move to" list */
export function simulateMove(people: RosterPerson[], personId: string, to: { work_area_id: string | null; zone: RosterZone }): RosterPerson[] {
  return people.map(p => {
    if (p.person_id !== personId) return p
    const area = to.zone === 'home' ? (to.work_area_id ?? p.work_area_id) : to.work_area_id
    return { ...p, work_area_id: area, zone: to.zone }
  })
}

/** Center-wide totals for the stats row */
export function centerTotals(rooms: RosterRoom[], people: RosterPerson[], statuses: Record<string, RoomStatus>) {
  const kids = people.filter(p => p.kind === 'child')
  const staff = people.filter(p => p.kind === 'staff')
  return {
    childrenIn: kids.filter(isOnSite).length,
    childrenTotal: kids.length,
    staffIn: staff.filter(isOnSite).length,
    staffTotal: staff.length,
    roomsInRatio: rooms.filter(r => statuses[r.id]?.code !== 'out').length,
    roomsTotal: rooms.length,
    openSpots: rooms.reduce((n, r) => n + (r.capacity == null ? 0 : Math.max(0, r.capacity - (statuses[r.id]?.childrenIn ?? 0))), 0),
  }
}

/**
 * Who sits where on the board for one room: the room's own home band plus each on-site zone.
 * Someone with no home room never sits in a Home band (not even of the room they last left): while they are
 * not checked in they wait in the Lobby of whichever room is open (see waitingForRoom).
 */
export function peopleInRoom(roomId: string, people: RosterPerson[]) {
  const mine = people.filter(p => p.zone === 'home'
    ? !!p.home_area_id && (p.work_area_id ?? p.home_area_id) === roomId
    : p.work_area_id === roomId)
  const by = (zone: RosterZone) => mine
    .filter(p => p.zone === zone)
    .sort((a, b) => (a.kind === b.kind ? a.first_name.localeCompare(b.first_name) : a.kind === 'staff' ? -1 : 1))
  return { home: by('home'), classroom: by('classroom'), playground: by('playground'), lobby: by('lobby') }
}

/** Not checked in and no home room: floaters, and children who still need a home room */
export function waitingForRoom(people: RosterPerson[]) {
  return people
    .filter(p => p.zone === 'home' && !p.home_area_id)
    .sort((a, b) => (a.kind === b.kind ? a.first_name.localeCompare(b.first_name) : a.kind === 'staff' ? -1 : 1))
}

/** Whole months between a birth date and a day (YYYY-MM-DD), the same count the database uses */
export function ageInMonths(dob: string, on: string): number | null {
  const [by, bm, bd] = dob.split('-').map(Number)
  const [oy, om, od] = on.split('-').map(Number)
  if (!by || !bm || !bd || !oy || !om || !od) return null
  let m = (oy - by) * 12 + (om - bm)
  if (od < bd) m -= 1
  return m < 0 ? null : m
}

/** The room whose age range covers a child of this age (the first in the center's order), or null */
export function suggestHomeRoom<R extends { id: string; min_age_months?: number | null; max_age_months?: number | null }>(ageMonths: number | null, rooms: R[]): R | null {
  if (ageMonths == null) return null
  return rooms.find(r => r.min_age_months != null && r.max_age_months != null && ageMonths >= r.min_age_months && ageMonths < r.max_age_months) ?? null
}

/** "4 y 2 mo" / "14 mo" */
export function ageLabel(months: number | null) {
  if (months == null) return ''
  return months < 24 ? `${months} mo` : `${Math.floor(months / 12)} y ${months % 12} mo`
}

// Self-contained on purpose (no imports, no path aliases) so scripts/schedule/schedule.test.mjs can load it with plain node.

/**
 * Staff schedule: shared types and time math for the fixed weekly schedules (phase 1) and the daily board.
 * The database (20270101000000_staff_schedules.sql) is the judge of what can be saved: times on 15-minute marks,
 * inside the center's day, no overlaps for one person on a day. These helpers only lay things out and pre-check
 * so the admin sees a problem before pressing Save.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6   // 0 = Sunday, as in the database

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export interface ScheduleSettings {
  enabled: boolean
  slot_minutes: 15 | 30
  day_start: string   // 'HH:MI'
  day_end: string
  weekends: boolean
  today: string       // 'YYYY-MM-DD', the center's own day
  can_manage: boolean
}

export interface ScheduleRoom { id: string; name: string; on_roster: boolean }

export interface FixedBlock {
  id?: string
  weekday: Weekday
  start: string        // 'HH:MI'
  end: string
  room_id: string | null   // null = floater for those hours
  notes?: string | null
  from?: string
  to?: string | null
}

export interface FixedStaff {
  center_staff_id: string
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
  home_room_id: string | null
  blocks: FixedBlock[]
  next_change: string | null
}

export interface FixedList {
  on: string
  settings: ScheduleSettings
  rooms: ScheduleRoom[]
  staff: FixedStaff[]
}

/** Mon-Fri, plus Sat and Sun when the center works weekends; Monday first */
export function scheduleWeekdays(weekends: boolean): Weekday[] {
  return weekends ? [1, 2, 3, 4, 5, 6, 0] : [1, 2, 3, 4, 5]
}

/** 'HH:MI' -> minutes after midnight (NaN when unreadable) */
export function toMinutes(hhmi: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmi ?? '')
  if (!m) return NaN
  const h = Number(m[1]), mi = Number(m[2])
  if (h > 23 || mi > 59) return NaN
  return h * 60 + mi
}

/** minutes after midnight -> 'HH:MI' */
export function fromMinutes(min: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Nearest multiple of the snap, kept inside [lo, hi] */
export function snapMinutes(min: number, slot: number, lo = 0, hi = 24 * 60): number {
  const s = Math.round(min / slot) * slot
  return Math.max(lo, Math.min(hi, s))
}

/** '07:00' -> '7 AM', '13:30' -> '1:30 PM' */
export function formatTime(hhmi: string): string {
  const min = toMinutes(hhmi)
  if (Number.isNaN(min)) return hhmi
  const h = Math.floor(min / 60), mi = min % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${mi ? `:${String(mi).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

/** Compact range for a box: '7–3', '7:30–1:15', '11–1' (a.m./p.m. dropped; the board's hour scale shows it) */
export function formatRange(start: string, end: string): string {
  const short = (hhmi: string) => {
    const min = toMinutes(hhmi)
    if (Number.isNaN(min)) return hhmi
    const h = Math.floor(min / 60) % 12 || 12, mi = min % 60
    return mi ? `${h}:${String(mi).padStart(2, '0')}` : `${h}`
  }
  return `${short(start)}–${short(end)}`
}

/** Time choices for a picker: every slot from the day's start to its end, plus any off-snap value already saved */
export function timeOptions(dayStart: string, dayEnd: string, slot: number, keep: string[] = []): string[] {
  const lo = toMinutes(dayStart), hi = toMinutes(dayEnd)
  const out = new Set<string>()
  for (let m = lo; m <= hi; m += slot) out.add(fromMinutes(m))
  for (const k of keep) if (!Number.isNaN(toMinutes(k))) out.add(fromMinutes(toMinutes(k)))
  return [...out].sort((a, b) => toMinutes(a) - toMinutes(b))
}

/** Hours of the blocks (overlaps are not expected; each block counts in full) */
export function blockHours(blocks: Pick<FixedBlock, 'start' | 'end'>[]): number {
  const min = blocks.reduce((sum, b) => sum + Math.max(0, toMinutes(b.end) - toMinutes(b.start)), 0)
  return Math.round(min / 6) / 10
}

/** '37.5 h', '8 h' */
export function formatHours(h: number): string {
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`
}

/** First problem with a teacher's pattern, the way the database would refuse it, or null when it can be saved */
export function checkPattern(blocks: FixedBlock[], s: Pick<ScheduleSettings, 'day_start' | 'day_end' | 'weekends'>): string | null {
  const lo = toMinutes(s.day_start), hi = toMinutes(s.day_end)
  const byDay = new Map<number, { a: number; b: number }[]>()
  for (const b of blocks) {
    const day = WEEKDAY_NAMES[b.weekday] ?? 'A day'
    const a = toMinutes(b.start), z = toMinutes(b.end)
    if (!s.weekends && (b.weekday === 0 || b.weekday === 6)) return `${day}: this center's schedule is Monday to Friday.`
    if (Number.isNaN(a) || Number.isNaN(z) || z <= a) return `${day}: each block has to end after it starts.`
    if (a % 15 || z % 15) return `${day}: times go in 15-minute steps.`
    if (a < lo || z > hi) return `${day}: ${formatTime(b.start)} to ${formatTime(b.end)} is outside the center's day (${formatTime(s.day_start)} to ${formatTime(s.day_end)}).`
    const list = byDay.get(b.weekday) ?? []
    const clash = list.find(o => a < o.b && z > o.a)
    if (clash) return `${day}: two blocks overlap (${formatTime(fromMinutes(clash.a))} to ${formatTime(fromMinutes(clash.b))} and ${formatTime(b.start)} to ${formatTime(b.end)}).`
    if (list.length >= 6) return `${day}: 6 blocks a day at most.`
    list.push({ a, b: z })
    byDay.set(b.weekday, list)
  }
  return null
}

/** Copy one day's blocks onto other days (replacing what they had) */
export function copyDay(blocks: FixedBlock[], from: Weekday, to: Weekday[]): FixedBlock[] {
  const source = blocks.filter(b => b.weekday === from)
  const kept = blocks.filter(b => b.weekday === from || !to.includes(b.weekday))
  const copies = to.filter(d => d !== from).flatMap(d => source.map(b => ({ weekday: d, start: b.start, end: b.end, room_id: b.room_id, notes: b.notes ?? null })))
  return sortBlocks([...kept, ...copies])
}

/** Monday first, then by start time */
export function sortBlocks<T extends Pick<FixedBlock, 'weekday' | 'start'>>(blocks: T[]): T[] {
  const order = (d: number) => (d === 0 ? 7 : d)
  return [...blocks].sort((x, y) => order(x.weekday) - order(y.weekday) || toMinutes(x.start) - toMinutes(y.start))
}

/**
 * Stack boxes that overlap in time into lanes (rows within a room), first fit by start time. Returns each item's
 * lane and the number of lanes, so a room with two teachers side by side in time shares one lane.
 */
export function packLanes<T extends { start: string; end: string }>(items: T[]): { lanes: number; placed: { item: T; lane: number }[] } {
  const sorted = [...items].sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || toMinutes(b.end) - toMinutes(a.end))
  const laneEnds: number[] = []
  const placed = sorted.map(item => {
    const a = toMinutes(item.start)
    let lane = laneEnds.findIndex(end => end <= a)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0) }
    laneEnds[lane] = toMinutes(item.end)
    return { item, lane }
  })
  return { lanes: laneEnds.length, placed }
}

/** Left offset and width of a box on the board, in percent of the day */
export function boxPosition(start: string, end: string, dayStart: string, dayEnd: string): { left: number; width: number } {
  const lo = toMinutes(dayStart), len = Math.max(1, toMinutes(dayEnd) - lo)
  const a = Math.max(0, toMinutes(start) - lo), z = Math.min(len, toMinutes(end) - lo)
  return { left: (a / len) * 100, width: (Math.max(0, z - a) / len) * 100 }
}

/** The hour marks to draw on the board's scale */
export function hourMarks(dayStart: string, dayEnd: string): string[] {
  const lo = toMinutes(dayStart), hi = toMinutes(dayEnd)
  const out: string[] = []
  for (let m = Math.ceil(lo / 60) * 60; m <= hi; m += 60) out.push(fromMinutes(m))
  return out
}

/** 'Ana L.' */
export function shortName(p: Pick<FixedStaff, 'first_name' | 'last_name'>): string {
  const first = (p.first_name ?? '').trim() || 'Staff'
  const last = (p.last_name ?? '').trim()
  return last ? `${first} ${last[0]}.` : first
}

/** Weekday of a 'YYYY-MM-DD' date (0 = Sunday), read as a calendar day so time zones can't shift it */
export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday
}

/** 'YYYY-MM-DD' plus n days */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/** 'Mon, Dec 1' */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// ── Daily board (phase 2) ────────────────────────────────────────────────────────────────────────────────────

export type AbsenceKind = 'called_out' | 'sick' | 'pto' | 'other'
export const ABSENCE_LABELS: Record<AbsenceKind, string> = { called_out: 'Called out', sick: 'Sick', pto: 'PTO', other: 'Other' }

export interface DayRoom extends ScheduleRoom { ratio: number | null; enrolled: number }

export interface DayPerson {
  staff_id: string
  center_staff_id: string | null   // null for a substitute
  kind: 'regular' | 'sub'
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
  home_room_id: string | null
  absence: { kind: AbsenceKind; start: string | null; end: string | null; note: string | null } | null
}

export interface DayBlock {
  id: string
  staff_id: string
  center_staff_id: string | null
  shift_claim_id: string | null
  room_id: string | null
  start: string
  end: string
  source: 'fixed' | 'added' | 'sub'
  note: string | null
}

export interface DayPayload {
  settings: ScheduleSettings
  day: { id: string; date: string; weekday: Weekday; status: 'draft' | 'published'; version: number; published_at: string | null }
  rooms: DayRoom[]
  people: DayPerson[]
  blocks: DayBlock[]
  /** Published day: people whose boxes changed since they were last notified (staff ids) */
  unnotified?: string[]
}

/** Teachers a room needs by its ratio for the children whose home room it is (0 = not ratio-checked) */
export function teachersNeeded(room: Pick<DayRoom, 'ratio' | 'enrolled'>): number {
  return room.ratio && room.enrolled > 0 ? Math.ceil(room.enrolled / room.ratio) : 0
}

/** How many people are scheduled in a room through the day, as runs of equal count: [{start, end, count}] */
export function coverage(blocks: Pick<DayBlock, 'start' | 'end'>[], dayStart: string, dayEnd: string): { start: string; end: string; count: number }[] {
  const lo = toMinutes(dayStart), hi = toMinutes(dayEnd)
  const cuts = new Set<number>([lo, hi])
  for (const b of blocks) {
    const a = Math.max(lo, toMinutes(b.start)), z = Math.min(hi, toMinutes(b.end))
    if (z > a) { cuts.add(a); cuts.add(z) }
  }
  const points = [...cuts].sort((x, y) => x - y)
  const runs: { start: string; end: string; count: number }[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], z = points[i + 1]
    const count = blocks.filter(b => toMinutes(b.start) <= a && toMinutes(b.end) >= z).length
    const last = runs.at(-1)
    if (last && last.count === count && toMinutes(last.end) === a) last.end = fromMinutes(z)
    else runs.push({ start: fromMinutes(a), end: fromMinutes(z), count })
  }
  return runs
}

/** Coverage tone for one run: short of the ratio, empty, or fine */
export function coverageTone(count: number, needed: number): 'short' | 'empty' | 'ok' | 'none' {
  if (needed > 0) return count === 0 ? 'empty' : count < needed ? 'short' : 'ok'
  return count > 0 ? 'ok' : 'none'
}

/** Minutes moved for a horizontal drag of dx pixels across a timeline `width` pixels wide */
export function dragMinutes(dx: number, width: number, dayStart: string, dayEnd: string): number {
  return width > 0 ? (dx / width) * (toMinutes(dayEnd) - toMinutes(dayStart)) : 0
}

/** The time under a pointer at x pixels into a timeline, snapped */
export function minutesAt(x: number, width: number, dayStart: string, dayEnd: string, slot: number): string {
  const lo = toMinutes(dayStart), hi = toMinutes(dayEnd)
  return fromMinutes(snapMinutes(lo + dragMinutes(x, width, dayStart, dayEnd), slot, lo, hi))
}

export type DragMode = 'move' | 'start' | 'end'

/**
 * Where a box lands after a drag: 'move' shifts both ends (keeping the length, stopping at the day's edges), 'start'
 * and 'end' resize one edge (never shorter than one slot). Times snap to the slot.
 */
export function applyDrag(block: Pick<DayBlock, 'start' | 'end'>, mode: DragMode, deltaMin: number, slot: number, dayStart: string, dayEnd: string): { start: string; end: string } {
  const lo = toMinutes(dayStart), hi = toMinutes(dayEnd)
  const a = toMinutes(block.start), z = toMinutes(block.end)
  if (mode === 'move') {
    const len = z - a
    const next = Math.max(lo, Math.min(hi - len, snapMinutes(a + deltaMin, slot, lo, hi)))
    return { start: fromMinutes(next), end: fromMinutes(next + len) }
  }
  if (mode === 'start') return { start: fromMinutes(Math.min(z - slot, snapMinutes(a + deltaMin, slot, lo, hi))), end: block.end }
  return { start: block.start, end: fromMinutes(Math.max(a + slot, snapMinutes(z + deltaMin, slot, lo, hi))) }
}

/** A new box for someone dropped from the tray at `at`: 8 hours (or up to the day's end), at least one hour */
export function dropBlock(at: string, slot: number, dayStart: string, dayEnd: string): { start: string; end: string } {
  const hi = toMinutes(dayEnd)
  const a = Math.min(snapMinutes(toMinutes(at), slot, toMinutes(dayStart), hi), hi - 60)
  return { start: fromMinutes(Math.max(toMinutes(dayStart), a)), end: fromMinutes(Math.min(hi, a + 8 * 60)) }
}

/** Would this person's box overlap another of theirs? (the board pre-checks what the database refuses) */
export function overlapsOwn(blocks: Pick<DayBlock, 'id' | 'staff_id' | 'start' | 'end'>[], staffId: string, start: string, end: string, ignoreId?: string): boolean {
  const a = toMinutes(start), z = toMinutes(end)
  return blocks.some(b => b.staff_id === staffId && b.id !== ignoreId && toMinutes(b.start) < z && toMinutes(b.end) > a)
}

// ── Teachers (phase 3) ───────────────────────────────────────────────────────────────────────────────────────

/** One published day of the signed-in person (my_schedule) */
export interface MyScheduleDay {
  center_id: string
  center_name: string
  date: string
  weekday: Weekday
  published_at: string | null
  /** false = their boxes changed since they last looked ("Updated") */
  seen: boolean
  /** they are off part or all of the day (no reason shown); start/end null = all day */
  off: { start: string | null; end: string | null } | null
  blocks: { room_id: string | null; room_name: string | null; start: string; end: string; note: string | null; sub: boolean }[]
}

/** "Infant A 7–11 · Toddler 11–3" */
export function describeMyDay(day: Pick<MyScheduleDay, 'blocks'>): string {
  return day.blocks.map(b => `${b.room_name ?? 'Floater'} ${formatRange(b.start, b.end)}`).join(' · ')
}

/** Index of the box running at `now` ('HH:MI'), else the next one coming up, else -1 */
export function currentBlockIndex(blocks: Pick<DayBlock, 'start' | 'end'>[], now: string): number {
  const t = toMinutes(now)
  const running = blocks.findIndex(b => toMinutes(b.start) <= t && t < toMinutes(b.end))
  if (running !== -1) return running
  return blocks.findIndex(b => toMinutes(b.start) > t)
}

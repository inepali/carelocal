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

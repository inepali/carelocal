// Self-contained on purpose (no imports) so the tests can load it with plain node.

/**
 * Time Clock helpers shared by the tablet, the admin page and the staff portal (20270120000000_time_clock.sql).
 *  - Time Card PINs: 4 digits, unique within a center, set only by owners and admins.
 *  - Pay periods: weekly or every 2 weeks, counted from the center's period start date.
 *  - Timesheets: worked hours from Time Clock periods only (never the Live Roster), overtime over 40 hours in a
 *    7-day week of the period, plus approved PTO, Sick and Unpaid hours.
 * Dates are 'YYYY-MM-DD' strings in center time; timestamps are ISO strings.
 */

// ── PINs ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TIME_PIN_LENGTH = 4

/** What was typed, as 4 digits, or null (spaces and dashes are ignored) */
export function normalizeTimePin(input: string): string | null {
  const pin = (input ?? '').replace(/[\s\-.]/g, '')
  return /^\d{4}$/.test(pin) ? pin : null
}

const COMMON_PINS = new Set(['1212', '6969', '1004', '2000', '2580', '0852', '1122', '1313', '4321', '1010', '2020', '1984'])

/** Why a PIN is too easy to guess, or null when it is fine */
export function weakTimePinReason(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'Use exactly 4 digits.'
  if (/^(\d)\1{3}$/.test(pin)) return 'Do not use the same digit four times.'
  const d = [...pin].map(Number)
  const steps = d.slice(1).map((x, i) => x - d[i])
  if (steps.every(s => s === 1) || steps.every(s => s === -1)) return 'Do not use digits in order, like 1234.'
  if (/^(\d\d)\1$/.test(pin)) return 'Do not repeat a pattern, like 1212.'
  if (COMMON_PINS.has(pin)) return 'That PIN is too common. Pick another.'
  return null
}

/** A PIN from a random number below 10,000 (the caller supplies it, e.g. crypto.randomInt) */
export function timePinFromNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 10_000) throw new Error('Need a whole number below 10,000')
  return String(n).padStart(TIME_PIN_LENGTH, '0')
}

// ── Dates ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const toUtc = (day: string) => Date.parse(`${day}T00:00:00Z`)
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * DAY_MS)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS)
}

/** 1 = Monday ... 7 = Sunday */
export function isoWeekday(day: string): number {
  const d = new Date(toUtc(day)).getUTCDay()
  return d === 0 ? 7 : d
}

export type PayPeriodKind = 'weekly' | 'biweekly'
export interface PayPeriod { start: string; end: string }

export const periodLength = (kind: PayPeriodKind) => (kind === 'biweekly' ? 14 : 7)

/** The pay period holding a day */
export function periodFor(day: string, anchor: string, kind: PayPeriodKind): PayPeriod {
  const len = periodLength(kind)
  const idx = Math.floor(daysBetween(anchor, day) / len)
  const start = addDays(anchor, idx * len)
  return { start, end: addDays(start, len - 1) }
}

/** The period before or after (step -1 / +1) */
export function shiftPeriod(p: PayPeriod, kind: PayPeriodKind, step: number): PayPeriod {
  const len = periodLength(kind) * step
  return { start: addDays(p.start, len), end: addDays(p.end, len) }
}

/** The day a timestamp falls on in a time zone */
export function dayInZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** "3:05 PM" in a time zone */
export function timeInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

/** Wall-clock 'YYYY-MM-DD' + 'HH:MM' in a time zone as an ISO timestamp (for admin edits) */
export function zonedToIso(day: string, hhmm: string, timeZone: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const guess = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), h, m)
  // The zone's offset at that moment, applied twice to settle near a daylight-saving change
  const offset = (ms: number) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms))
    const g = (t: string) => Number(p.find(x => x.type === t)?.value)
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ms
  }
  let ms = guess - offset(guess)
  ms = guess - offset(ms)
  return new Date(ms).toISOString()
}

/** "HH:MM" of a timestamp in a time zone, 24-hour (for time inputs) */
export function hhmmInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}

/** 125 -> "2:05" (hours:minutes) */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

/** 125 -> 2.08 (decimal hours, for payroll) */
export const minutesToHours = (min: number) => Math.round((min / 60) * 100) / 100

export const fmtHours = (h: number) => (Math.round(h * 100) / 100).toString()

// ── Timesheet ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TimeEntry {
  id: string
  center_staff_id: string
  name: string
  clock_in: string
  clock_out: string | null
  missed_out: boolean
  source?: 'clock' | 'admin'
  edited?: boolean
  /** clock-in day in center time */
  day: string
}

export type TimeOffKind = 'pto' | 'unpaid' | 'sick'
export type TimeOffStatus = 'pending' | 'approved' | 'denied' | 'cancelled'

export interface TimeOff {
  id: string
  center_staff_id: string
  name: string
  kind: TimeOffKind
  start_date: string
  end_date: string
  full_day: boolean
  hours: number
  reason: string | null
  status: TimeOffStatus
  via: 'clock' | 'portal' | 'admin'
  created_at: string
  decided_at: string | null
  decision_note: string | null
  pto?: PtoBalance | null
}

export interface PtoBalance {
  year_start: string
  year_end: string
  yearly: number
  carry_over: number
  used: number
  pending: number
  remaining: number
}

export const TIME_OFF_LABEL: Record<TimeOffKind, string> = { pto: 'PTO', unpaid: 'Unpaid', sick: 'Sick' }

export const WEEK_OVERTIME_MINUTES = 40 * 60

export interface TimesheetRow {
  center_staff_id: string
  name: string
  /** worked minutes per day of the period */
  days: Record<string, number>
  weeks: { start: string; minutes: number; overtime: number }[]
  worked: number
  regular: number
  overtime: number
  pto: number
  sick: number
  unpaid: number
  /** periods with no clock-out yet (still working) and missed clock-outs */
  open: number
  missed: number
}

/** Hours of a time off that fall on each day (Monday to Friday, split evenly; a weekend-only one on its first day) */
export function timeOffByDay(t: Pick<TimeOff, 'start_date' | 'end_date' | 'hours'>): Record<string, number> {
  const days: string[] = []
  for (let d = t.start_date; d <= t.end_date; d = addDays(d, 1)) if (isoWeekday(d) < 6) days.push(d)
  if (!days.length) return { [t.start_date]: Number(t.hours) }
  const each = Number(t.hours) / days.length
  return Object.fromEntries(days.map(d => [d, each]))
}

/**
 * One row per person with any time in the period. Worked time counts closed periods, by their clock-in day.
 * Overtime: minutes over 40 in each 7-day week counted from the period start.
 */
export function buildTimesheet(entries: TimeEntry[], timeOff: TimeOff[], period: PayPeriod): TimesheetRow[] {
  const rows = new Map<string, TimesheetRow>()
  const weekStarts: string[] = []
  for (let d = period.start; d <= period.end; d = addDays(d, 7)) weekStarts.push(d)
  const row = (id: string, name: string) => {
    let r = rows.get(id)
    if (!r) {
      r = { center_staff_id: id, name, days: {}, weeks: weekStarts.map(start => ({ start, minutes: 0, overtime: 0 })),
            worked: 0, regular: 0, overtime: 0, pto: 0, sick: 0, unpaid: 0, open: 0, missed: 0 }
      rows.set(id, r)
    }
    return r
  }

  for (const e of entries) {
    const inPeriod = e.day >= period.start && e.day <= period.end
    if (e.missed_out) { row(e.center_staff_id, e.name).missed++; continue }
    if (!inPeriod) continue
    const r = row(e.center_staff_id, e.name)
    if (!e.clock_out) { r.open++; continue }
    const min = Math.max(0, (Date.parse(e.clock_out) - Date.parse(e.clock_in)) / 60_000)
    r.days[e.day] = (r.days[e.day] ?? 0) + min
    r.worked += min
    const w = Math.floor(daysBetween(period.start, e.day) / 7)
    if (r.weeks[w]) r.weeks[w].minutes += min
  }

  for (const t of timeOff) {
    if (t.status !== 'approved') continue
    for (const [day, h] of Object.entries(timeOffByDay(t))) {
      if (day < period.start || day > period.end) continue
      const r = row(t.center_staff_id, t.name)
      r[t.kind] += h
    }
  }

  for (const r of rows.values()) {
    for (const w of r.weeks) w.overtime = Math.max(0, w.minutes - WEEK_OVERTIME_MINUTES)
    r.overtime = r.weeks.reduce((s, w) => s + w.overtime, 0)
    r.regular = r.worked - r.overtime
    r.pto = Math.round(r.pto * 100) / 100
    r.sick = Math.round(r.sick * 100) / 100
    r.unpaid = Math.round(r.unpaid * 100) / 100
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const cell = (v: string | number) => {
  const s = String(v)
  // Keep spreadsheet formulas from running (=, +, -, @ at the start)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
const line = (cells: (string | number)[]) => cells.map(cell).join(',')

/** Hours per person for payroll */
export function timesheetCsv(rows: TimesheetRow[], period: PayPeriod): string {
  const out = [line(['Name', 'Period start', 'Period end', 'Regular hours', 'Overtime hours', 'Worked hours', 'PTO hours', 'Sick hours', 'Unpaid hours', 'Missed clock-outs'])]
  for (const r of rows) {
    out.push(line([r.name, period.start, period.end, minutesToHours(r.regular), minutesToHours(r.overtime), minutesToHours(r.worked),
      r.pto, r.sick, r.unpaid, r.missed]))
  }
  return out.join('\r\n') + '\r\n'
}

/** Every punch in the period */
export function entriesCsv(entries: TimeEntry[], period: PayPeriod, timeZone: string): string {
  const out = [line(['Name', 'Date', 'Clock in', 'Clock out', 'Hours', 'Note'])]
  for (const e of entries) {
    if (e.day < period.start || e.day > period.end) continue
    const hours = e.clock_out ? minutesToHours((Date.parse(e.clock_out) - Date.parse(e.clock_in)) / 60_000) : ''
    const note = e.missed_out ? 'Missed clock-out' : !e.clock_out ? 'Still clocked in' : e.source === 'admin' ? 'Added by admin' : e.edited ? 'Edited by admin' : ''
    out.push(line([e.name, e.day, timeInZone(e.clock_in, timeZone), e.clock_out ? timeInZone(e.clock_out, timeZone) : '', hours, note]))
  }
  return out.join('\r\n') + '\r\n'
}

// ── Admin overview (timeclock_overview) ──────────────────────────────────────────────────────────────────────────

export interface TimeClockSettings {
  pay_period: PayPeriodKind
  period_anchor: string
  pto_year: 'calendar' | 'anniversary'
  carryover_max_hours: number
  full_day_hours: number
}

export interface TimeClockStaff {
  center_staff_id: string
  name: string
  avatar_url: string | null
  employment_class: 'regular' | 'substitute'
  part_time: boolean
  start_date: string | null
  has_pin: boolean
  pin_set_at: string | null
  pin_last_used_at: string | null
  pto: PtoBalance | null
}

export interface TimeClockDeviceRow { id: string; name: string; created_at: string; last_seen_at: string | null }

export interface TimeClockOverview {
  today: string
  timezone: string
  settings: TimeClockSettings
  staff: TimeClockStaff[]
  devices: TimeClockDeviceRow[]
}

/** "Full-time" / "Part-time" / "Substitute" */
export const staffTypeLabel = (s: Pick<TimeClockStaff, 'employment_class' | 'part_time'>) =>
  s.employment_class === 'substitute' ? 'Substitute' : s.part_time ? 'Part-time' : 'Full-time'

/** Weekly lesson plans: shared types and date helpers (center admin and teacher views) */

export type LessonPlanStatus = 'draft' | 'submitted' | 'approved' | 'changes_requested'

export interface LessonPlan {
  id: string
  center_id: string
  work_area_id: string
  /** Monday of the week, YYYY-MM-DD */
  week_start: string
  theme: string | null
  notes: string | null
  status: LessonPlanStatus
  created_by_name: string | null
  submitted_at: string | null
  submitted_by_name: string | null
  reviewed_at: string | null
  reviewed_by_name: string | null
  review_note: string | null
  updated_at: string
}

export interface LessonPlanItem {
  id: string
  center_id: string
  plan_id: string
  /** 1 = Monday … 7 = Sunday */
  day: number
  block: string | null
  title: string
  description: string | null
  materials: string | null
  sort_order: number
  goal_ids: string[]
}

export const PLAN_STATUS: Record<LessonPlanStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  submitted: { label: 'Waiting for approval', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { label: 'Approved', className: 'bg-brand-50 text-brand-700 border-brand-200' },
  changes_requested: { label: 'Changes requested', className: 'bg-red-50 text-red-700 border-red-200' },
}

/** Weekdays a plan covers (Mon–Fri) */
export const PLAN_DAYS = [1, 2, 3, 4, 5] as const
export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Common time blocks offered as suggestions; teachers can type their own */
export const PLAN_BLOCKS = ['Circle Time', 'Learning Centers', 'Small Group', 'Story Time', 'Art', 'Music & Movement', 'Outdoor', 'Science', 'Math']

/** YYYY-MM-DD in local time (never via toISOString, which shifts to UTC) */
export function toDateOnly(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Parse YYYY-MM-DD as a local date */
export function fromDateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Monday of the week containing d */
export function mondayOf(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = copy.getDay() || 7 // Sunday → 7
  copy.setDate(copy.getDate() - (dow - 1))
  return toDateOnly(copy)
}

export function addDays(dateOnly: string, days: number): string {
  const d = fromDateOnly(dateOnly)
  d.setDate(d.getDate() + days)
  return toDateOnly(d)
}

/** "Nov 9 – 13, 2026" / "Dec 29, 2025 – Jan 2, 2026" */
export function weekLabel(weekStart: string): string {
  const start = fromDateOnly(weekStart)
  const end = fromDateOnly(addDays(weekStart, 4))
  const sameYear = start.getFullYear() === end.getFullYear()
  const sameMonth = sameYear && start.getMonth() === end.getMonth()
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (sameMonth) return `${md(start)} – ${end.getDate()}, ${end.getFullYear()}`
  if (sameYear) return `${md(start)} – ${md(end)}, ${end.getFullYear()}`
  return `${md(start)}, ${start.getFullYear()} – ${md(end)}, ${end.getFullYear()}`
}

/** "Mon 9" for a weekday of a plan week */
export function dayLabel(weekStart: string, day: number): string {
  const d = fromDateOnly(addDays(weekStart, day - 1))
  return `${DAY_NAMES[day].slice(0, 3)} ${d.getDate()}`
}

import type { InspectionIntervalUnit } from './types'

/** Parse a YYYY-MM-DD date as a local calendar date (no timezone shift). */
export function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toDateOnly(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayDateOnly(): string {
  return toDateOnly(new Date())
}

/** Add an interval to a date, clamping month-end (Jan 31 + 1 month = Feb 28/29). */
export function addInterval(from: string, value: number, unit: InspectionIntervalUnit): string {
  const date = parseDateOnly(from)
  if (unit === 'days') date.setDate(date.getDate() + value)
  else if (unit === 'weeks') date.setDate(date.getDate() + value * 7)
  else {
    const months = unit === 'years' ? value * 12 : value
    const day = date.getDate()
    date.setDate(1)
    date.setMonth(date.getMonth() + months)
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(day, lastDay))
  }
  return toDateOnly(date)
}

export function daysUntil(dateOnly: string): number {
  const today = parseDateOnly(todayDateOnly())
  const target = parseDateOnly(dateOnly)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

export type InspectionStatus = 'overdue' | 'due_soon' | 'ok' | 'no_due_date'

export const DUE_SOON_DAYS = 30

export function inspectionStatus(nextDue?: string | null): InspectionStatus {
  if (!nextDue) return 'no_due_date'
  const days = daysUntil(nextDue)
  if (days < 0) return 'overdue'
  if (days <= DUE_SOON_DAYS) return 'due_soon'
  return 'ok'
}

export function formatInterval(value?: number | null, unit?: InspectionIntervalUnit | null): string {
  if (!value || !unit) return 'One-time / as needed'
  if (value === 1) {
    return { days: 'Daily', weeks: 'Weekly', months: 'Monthly', years: 'Annually' }[unit]
  }
  if (unit === 'months' && value === 3) return 'Quarterly'
  if (unit === 'months' && value === 6) return 'Every 6 months'
  return `Every ${value} ${unit}`
}

export function formatDate(dateOnly?: string | null): string {
  if (!dateOnly) return '—'
  return parseDateOnly(dateOnly).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

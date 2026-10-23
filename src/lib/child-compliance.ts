import { computeCompliance, type ComplianceResult, type ComplianceState } from '@/lib/compliance'
import type { Child, ChildDocumentStatus } from '@/lib/child-types'
import type { ChildRequirement } from '@/lib/children'

/**
 * A child's record status, worked out with the SAME rules engine the staff files use. The start of every due
 * window is the child's first day of attendance (the 30-day immunization and health assessment windows count
 * from it), falling back to the enrollment date.
 */
export const childStartDate = (child: Pick<Child, 'first_attended_on' | 'enrolled_on'>) => child.first_attended_on ?? child.enrolled_on

/** The compliance engine reads staff records, where some fields are optional rather than nullable */
export const engineRecord = (record: ChildDocumentStatus | null) => record && ({
  status: record.status,
  completed_on: record.completed_on,
  reviewed_at: record.reviewed_at ?? undefined,
  expires_on: record.expires_on,
  not_applicable: record.not_applicable,
  due_on: record.due_on,
  acknowledged_version: record.acknowledged_version,
})

export interface ChildRow {
  requirement: ChildRequirement
  record: ChildDocumentStatus | null
  result: ComplianceResult
}

export function childRows(child: Child, requirements: ChildRequirement[], records: ChildDocumentStatus[], today: Date = new Date()): ChildRow[] {
  const byRequirement = new Map(records.filter(r => r.child_id === child.id).map(r => [r.requirement_id, r]))
  return requirements.map(requirement => {
    const record = byRequirement.get(requirement.id) ?? null
    return { requirement, record, result: computeCompliance(requirement, engineRecord(record), childStartDate(child), null, today) }
  })
}

export interface ChildSummary {
  /** Items that apply to this child (not marked not applicable) */
  applicable: number
  /** Accepted and not expired */
  complete: number
  counts: Record<ComplianceState, number>
}

const EMPTY_COUNTS = (): Record<ComplianceState, number> =>
  ({ overdue: 0, due_soon: 0, pending_review: 0, rejected: 0, missing: 0, current: 0, not_applicable: 0 })

export function summarizeChild(rows: ChildRow[]): ChildSummary {
  const counts = EMPTY_COUNTS()
  for (const row of rows) counts[row.result.state]++
  const complete = rows.filter(r => r.record?.status === 'accepted' && (r.result.state === 'current' || r.result.state === 'due_soon')).length
  return { applicable: rows.length - counts.not_applicable, complete, counts }
}

/** "3 years", "14 months" or "9 weeks" from a date of birth */
export function describeAge(dateOfBirth: string, today: Date = new Date()) {
  const dob = new Date(`${dateOfBirth}T12:00:00`)
  if (Number.isNaN(dob.getTime())) return ''
  const months = (today.getFullYear() - dob.getFullYear()) * 12 + (today.getMonth() - dob.getMonth()) - (today.getDate() < dob.getDate() ? 1 : 0)
  if (months < 0) return 'due ' + dob.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  if (months < 3) return `${Math.max(0, Math.floor((today.getTime() - dob.getTime()) / (7 * 86_400_000)))} weeks`
  if (months < 24) return `${months} months`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'}`
}

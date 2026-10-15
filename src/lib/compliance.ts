import type {
  CenterDocumentRequirement, CenterStaffDocumentStatus,
  EvidenceType, RenewalType, RequirementSection,
} from '@/lib/types'

// ─── Labels ──────────────────────────────────────────────────────────────────

export const SECTIONS: { id: RequirementSection; label: string; description: string }[] = [
  { id: 'personnel',   label: 'Personnel File',           description: 'Application, background clearance, emergency information' },
  { id: 'health',      label: 'Health (Confidential)',    description: 'Medical records kept in a separate confidential file' },
  { id: 'training',    label: 'Training & Certifications', description: 'Required trainings, CPR / First Aid, safe sleep' },
  { id: 'policies',    label: 'Policies & Acknowledgements', description: 'Policies and plans staff must receive or review' },
  { id: 'evaluations', label: 'Evaluations & Development', description: 'Evaluations and professional development plans' },
]

export const EVIDENCE_TYPES: { id: EvidenceType; label: string; hint: string }[] = [
  { id: 'staff_document',  label: 'Staff provides a document', hint: 'Staff upload or link it from their document library' },
  { id: 'center_record',   label: 'Center keeps the record',   hint: 'Uploaded by the center; hidden from staff' },
  { id: 'acknowledgement', label: 'Staff acknowledgement',     hint: 'Staff confirm receipt or review of a policy/plan' },
  { id: 'training',        label: 'Training completion',       hint: 'Center records completion date and hours' },
]

export const RENEWAL_TYPES: { id: RenewalType; label: string }[] = [
  { id: 'none',            label: 'No renewal' },
  { id: 'interval',        label: 'Every N months' },
  { id: 'document_expiry', label: 'Before the document expires' },
  { id: 'policy_change',   label: 'When the policy changes' },
]

export const DUE_PRESETS: { days: number | null; label: string }[] = [
  { days: null, label: 'No deadline' },
  { days: 0,    label: 'By day 1' },
  { days: 14,   label: 'Within 2 weeks' },
  { days: 30,   label: 'Within 30 days' },
  { days: 60,   label: 'Within 2 months' },
  { days: 90,   label: 'Within 90 days' },
  { days: 180,  label: 'Within 6 months' },
  { days: 365,  label: 'Within 1 year' },
]

export function sectionLabel(id: RequirementSection) {
  return SECTIONS.find(s => s.id === id)?.label ?? id
}

export function evidenceLabel(id: EvidenceType) {
  return EVIDENCE_TYPES.find(e => e.id === id)?.label ?? id
}

/** "By day 1", "Within 90 days", "Within 1 year" … */
export function describeDue(days: number | null | undefined) {
  if (days === null || days === undefined) return 'No deadline'
  const preset = DUE_PRESETS.find(p => p.days === days)
  if (preset) return preset.label
  if (days % 365 === 0) return `Within ${days / 365} years`
  if (days % 30 === 0) return `Within ${days / 30} months`
  return `Within ${days} days`
}

/** "Annually", "Every 5 years", "Before expiry" … (empty for no renewal) */
export function describeRenewal(req: Pick<CenterDocumentRequirement, 'renewal_type' | 'renewal_months'>) {
  switch (req.renewal_type) {
    case 'interval': {
      const m = req.renewal_months ?? 0
      if (m === 12) return 'Annually'
      if (m % 12 === 0) return `Every ${m / 12} years`
      return `Every ${m} months`
    }
    case 'document_expiry': return 'Renew before expiry'
    case 'policy_change': return 'Again when policy changes'
    default: return ''
  }
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type ComplianceState =
  | 'current' | 'due_soon' | 'overdue' | 'pending_review' | 'rejected' | 'missing' | 'not_applicable'

export const DUE_SOON_DAYS = 30

export const COMPLIANCE_STATE_STYLE: Record<ComplianceState, { label: string; className: string }> = {
  current:        { label: 'Current',        className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  due_soon:       { label: 'Due soon',       className: 'bg-amber-50 text-amber-700 border-amber-200' },
  overdue:        { label: 'Overdue',        className: 'bg-red-50 text-red-700 border-red-200' },
  pending_review: { label: 'Needs review',   className: 'bg-sky-50 text-sky-700 border-sky-200' },
  rejected:       { label: 'Rejected',       className: 'bg-red-50 text-red-700 border-red-200' },
  missing:        { label: 'Not yet due',    className: 'bg-slate-50 text-slate-600 border-slate-200' },
  not_applicable: { label: 'N/A',            className: 'bg-slate-50 text-slate-500 border-slate-200' },
}

function parseDate(value: string | null | undefined) {
  if (!value) return null
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  return isNaN(d.getTime()) ? null : d
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function addMonths(date: Date, months: number) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export interface ComplianceResult {
  state: ComplianceState
  /** When it is (or was) due: the initial deadline if not done, else the next renewal */
  dueDate: Date | null
  completedOn: Date | null
}

/**
 * Where one requirement stands for one staff member.
 * - Not done: due `due_within_days` after the employment start date.
 * - Done (accepted): next due date comes from the renewal rule
 *   (completion + N months, or the document / recorded expiry date).
 */
export function computeCompliance(
  req: Pick<CenterDocumentRequirement, 'due_within_days' | 'renewal_type' | 'renewal_months'>
    & Partial<Pick<CenterDocumentRequirement, 'policy_version' | 'policy_updated_at'>>,
  record: Pick<CenterStaffDocumentStatus, 'status' | 'completed_on' | 'reviewed_at' | 'expires_on' | 'not_applicable'>
    & Partial<Pick<CenterStaffDocumentStatus, 'acknowledged_version'>> | null | undefined,
  employmentStartDate: string | null | undefined,
  documentExpiry?: string | null,
  today: Date = new Date(),
): ComplianceResult {
  const now = startOfDay(today)
  const soon = addDays(now, DUE_SOON_DAYS)

  if (record?.not_applicable) return { state: 'not_applicable', dueDate: null, completedOn: null }

  const start = parseDate(employmentStartDate)
  const initialDue = start && req.due_within_days != null ? addDays(start, req.due_within_days) : null

  // Acknowledged an older version of a policy that has since changed: acknowledge again
  if (
    record?.status === 'accepted' && req.renewal_type === 'policy_change' &&
    record.acknowledged_version != null && (req.policy_version ?? 1) > record.acknowledged_version
  ) {
    const due = parseDate(req.policy_updated_at) ?? now
    return { state: due < now ? 'overdue' : 'due_soon', dueDate: due, completedOn: parseDate(record.completed_on) }
  }

  if (record?.status === 'accepted') {
    const completedOn = parseDate(record.completed_on) ?? parseDate(record.reviewed_at)
    let next: Date | null = null
    if (req.renewal_type === 'interval' && req.renewal_months && completedOn) next = addMonths(completedOn, req.renewal_months)
    if (req.renewal_type === 'document_expiry') next = parseDate(record.expires_on) ?? parseDate(documentExpiry)

    const state: ComplianceState = !next ? 'current' : next < now ? 'overdue' : next <= soon ? 'due_soon' : 'current'
    return { state, dueDate: next, completedOn }
  }

  if (record?.status === 'pending_review') return { state: 'pending_review', dueDate: initialDue, completedOn: null }
  if (record?.status === 'rejected') {
    return { state: initialDue && initialDue < now ? 'overdue' : 'rejected', dueDate: initialDue, completedOn: null }
  }

  const state: ComplianceState = initialDue && initialDue < now ? 'overdue' : initialDue && initialDue <= soon ? 'due_soon' : 'missing'
  return { state, dueDate: initialDue, completedOn: null }
}

export function formatDate(date: Date | string | null | undefined) {
  const d = typeof date === 'string' ? parseDate(date) : date
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

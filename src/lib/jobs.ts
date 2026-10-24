import type { CenterDocumentRequirement, CenterStaffDocumentStatus, StaffDocument } from '@/lib/types'
import { computeCompliance } from '@/lib/compliance'

/**
 * Regular hiring (job postings) — shared types, labels and the document readiness engine.
 * Readiness answers one question per required item: will it be valid on the start date?
 * The same logic drives the staff apply sheet and the admin applicant badge.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type EmploymentType = 'full_time' | 'part_time'
export type JobStatus = 'draft' | 'published' | 'paused' | 'closed' | 'filled' | 'archived'
export type NeededAt = 'apply' | 'offer' | 'start'
export type ApplicationStage = 'applied' | 'reviewing' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn'

export interface JobPosting {
  id: string
  center_id: string
  domain_key: string
  slug: string
  title: string
  role_value: string | null
  employment_type: EmploymentType
  description: string
  schedule_summary: string | null
  hours_per_week: number | null
  pay_min: number | null
  pay_max: number | null
  pay_unit: 'hour' | 'year'
  benefits: string[]
  start_date: string | null
  openings: number
  status: JobStatus
  published_at: string | null
  closes_at: string | null
  created_at: string
  updated_at: string
}

export interface JobRequirement {
  job_id: string
  requirement_id: string
  needed_at: NeededAt
}

export interface JobApplication {
  id: string
  job_id: string
  center_id: string
  staff_id: string
  center_staff_id: string
  stage: ApplicationStage
  cover_note: string | null
  resume_document_id: string | null
  readiness: Partial<ReadinessSummary>
  interview_at: string | null
  interview_location: string | null
  interview_note: string | null
  offer_start_date: string | null
  offer_pay: number | null
  offer_note: string | null
  offer_sent_at: string | null
  offer_letter_file_key: string | null
  offer_letter_file_name: string | null
  offer_letter_viewed_at: string | null
  decided_at: string | null
  applied_at: string
  updated_at: string
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = { full_time: 'Full-time', part_time: 'Part-time' }

export const JOB_STATUS_STYLE: Record<JobStatus, { label: string; className: string }> = {
  draft:     { label: 'Draft',     className: 'bg-slate-50 text-slate-600 border-slate-200' },
  published: { label: 'Published', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  paused:    { label: 'Paused',    className: 'bg-amber-50 text-amber-700 border-amber-200' },
  closed:    { label: 'Closed',    className: 'bg-slate-100 text-slate-500 border-slate-200' },
  filled:    { label: 'Filled',    className: 'bg-sky-50 text-sky-700 border-sky-200' },
  archived:  { label: 'Archived',  className: 'bg-slate-50 text-slate-400 border-slate-200' },
}

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  applied: 'Applied', reviewing: 'Reviewing', interview: 'Interview', offer: 'Offer',
  hired: 'Hired', rejected: 'Not selected', withdrawn: 'Withdrawn',
}

export const BOARD_STAGES: ApplicationStage[] = ['applied', 'reviewing', 'interview', 'offer']
export const OPEN_STAGES: ApplicationStage[] = ['applied', 'reviewing', 'interview', 'offer']

export const NEEDED_AT_LABELS: Record<NeededAt, string> = { apply: 'To apply', offer: 'At offer', start: 'Before start' }

/** Fixed list of benefits a posting can show (stored as these keys) */
export const BENEFITS: { value: string; label: string }[] = [
  { value: 'health', label: 'Health insurance' },
  { value: 'dental', label: 'Dental' },
  { value: 'vision', label: 'Vision' },
  { value: 'pto', label: 'Paid time off' },
  { value: 'paid_holidays', label: 'Paid holidays' },
  { value: 'retirement', label: 'Retirement plan' },
  { value: 'childcare_discount', label: 'Child care discount' },
  { value: 'tuition', label: 'Tuition assistance' },
  { value: 'training', label: 'Paid training / CDA support' },
  { value: 'bonus', label: 'Sign-on bonus' },
]
export const benefitLabel = (value: string) => BENEFITS.find(b => b.value === value)?.label ?? value

export function formatPay(job: Pick<JobPosting, 'pay_min' | 'pay_max' | 'pay_unit'>) {
  if (job.pay_min == null) return 'Pay not listed'
  const money = (n: number) => job.pay_unit === 'year'
    ? `$${Math.round(n).toLocaleString('en-US')}`
    : `$${Number(n).toFixed(2).replace(/\.00$/, '')}`
  const unit = job.pay_unit === 'year' ? '/yr' : '/hr'
  return job.pay_max != null && Number(job.pay_max) !== Number(job.pay_min)
    ? `${money(job.pay_min)}–${money(job.pay_max)}${unit}`
    : `${money(job.pay_min)}${unit}`
}

/** "Tue, Nov 10, 2:30 PM" in the given time zone (the viewer's when omitted) */
export function formatInterviewTime(at: string | null | undefined, timeZone?: string) {
  if (!at) return ''
  return new Date(at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone })
}

/** A location that is a link (video call) */
export const isLink = (value: string | null | undefined) => !!value && /^https?:\/\//i.test(value.trim())

export function slugify(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'job'
}

// ─── Readiness ───────────────────────────────────────────────────────────────

export type ItemState = 'ready' | 'in_review' | 'expiring' | 'missing' | 'later'

export const ITEM_STATE_STYLE: Record<ItemState, { label: string; className: string }> = {
  ready:     { label: 'Ready',                 className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  in_review: { label: 'In review',             className: 'bg-slate-50 text-slate-600 border-slate-200' },
  expiring:  { label: 'Expires before start',  className: 'bg-amber-50 text-amber-700 border-amber-200' },
  missing:   { label: 'Missing',               className: 'bg-red-50 text-red-700 border-red-200' },
  later:     { label: 'After you’re hired',    className: 'bg-slate-50 text-slate-500 border-slate-200' },
}

export interface ReadinessItem {
  requirement: CenterDocumentRequirement
  neededAt: NeededAt
  state: ItemState
  /** The vault document used or suggested for this item */
  document: StaffDocument | null
  /** Already on file at this center (accepted / in review / N/A) — nothing to pick */
  onFile: boolean
}

export interface ReadinessSummary {
  ready: number
  in_review: number
  expiring: number
  missing: number
  resume: boolean
  checked_at: string
}

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const parseDay = (value: string | null | undefined) => (value ? new Date(`${value.slice(0, 10)}T00:00:00`) : null)

/** The date documents must be valid on: the job/offer start date, or today when the start is ASAP */
export function readinessDate(startDate: string | null | undefined, today = new Date()) {
  const start = parseDay(startDate)
  const now = startOfDay(today)
  return start && start > now ? start : now
}

/**
 * Pre-selects a vault document for a checklist item: the newest document of the same type (or whose
 * name matches) that is not already expired on the start date. Staff can change any pick.
 */
export function suggestVaultDoc(requirement: Pick<CenterDocumentRequirement, 'document_name' | 'document_category'>, vaultDocs: StaffDocument[], onDate: Date): StaffDocument | null {
  const name = requirement.document_name.toLowerCase()
  const candidates = vaultDocs.filter(d => {
    const docName = d.document_name.toLowerCase()
    const typeMatch = d.document_category === requirement.document_category
    const nameMatch = docName.includes(name) || name.includes(docName)
    if (!typeMatch && !nameMatch) return false
    const expiry = parseDay(d.expiry_date)
    return !expiry || expiry >= onDate
  })
  candidates.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
  return candidates[0] ?? null
}

/** The newest resume in the vault */
export function findResume(vaultDocs: StaffDocument[]) {
  return [...vaultDocs].filter(d => d.document_category === 'resume').sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))[0] ?? null
}

/**
 * Readiness of each required item for one person.
 *  records  their center_staff_document_status rows at this center
 *  picks    documents chosen on the apply sheet (requirement id -> document id); otherwise suggested
 */
export function computeReadiness(input: {
  items: { requirement: CenterDocumentRequirement; neededAt: NeededAt }[]
  records: CenterStaffDocumentStatus[]
  vaultDocs: StaffDocument[]
  startDate: string | null | undefined
  picks?: Record<string, string | null>
  today?: Date
}): ReadinessItem[] {
  const onDate = readinessDate(input.startDate, input.today)
  const onDateIso = `${onDate.getFullYear()}-${String(onDate.getMonth() + 1).padStart(2, '0')}-${String(onDate.getDate()).padStart(2, '0')}`

  return input.items.map(({ requirement, neededAt }) => {
    const record = input.records.find(r => r.requirement_id === requirement.id) ?? null
    const linked = record?.matched_document_id ? input.vaultDocs.find(d => d.id === record.matched_document_id) ?? null : null

    if (neededAt !== 'apply') {
      return { requirement, neededAt, state: 'later' as const, document: linked, onFile: !!record && record.status === 'accepted' }
    }

    // Already on file at this center
    if (record?.not_applicable) return { requirement, neededAt, state: 'ready' as const, document: linked, onFile: true }
    if (record?.status === 'accepted') {
      const result = computeCompliance(requirement, record, onDateIso, linked?.expiry_date, onDate)
      const state: ItemState = result.state === 'overdue' ? 'expiring' : 'ready'
      return { requirement, neededAt, state, document: linked, onFile: true }
    }
    if (record?.status === 'pending_review') {
      const expiry = parseDay(linked?.expiry_date)
      return { requirement, neededAt, state: expiry && expiry < onDate ? 'expiring' as const : 'in_review' as const, document: linked, onFile: true }
    }

    // Picked on the apply sheet, or suggested from the vault
    const pickId = input.picks?.[requirement.id]
    const document = pickId === null
      ? null
      : pickId
        ? input.vaultDocs.find(d => d.id === pickId) ?? null
        : suggestVaultDoc(requirement, input.vaultDocs, onDate)
    if (!document) return { requirement, neededAt, state: 'missing' as const, document: null, onFile: false }
    const expiry = parseDay(document.expiry_date)
    return { requirement, neededAt, state: expiry && expiry < onDate ? 'expiring' as const : 'ready' as const, document, onFile: false }
  })
}

export function summarizeReadiness(items: ReadinessItem[], hasResume: boolean): ReadinessSummary {
  const apply = items.filter(i => i.neededAt === 'apply')
  return {
    ready: apply.filter(i => i.state === 'ready').length,
    in_review: apply.filter(i => i.state === 'in_review').length,
    expiring: apply.filter(i => i.state === 'expiring').length,
    missing: apply.filter(i => i.state === 'missing').length + (hasResume ? 0 : 1),
    resume: hasResume,
    checked_at: new Date().toISOString(),
  }
}

/** The applicant card badge: Ready, N missing, or Expires before start */
export function readinessBadge(summary: Partial<ReadinessSummary> | null | undefined): { label: string; className: string } {
  if (!summary || summary.checked_at === undefined) return { label: 'Checking…', className: 'bg-slate-50 text-slate-500 border-slate-200' }
  if ((summary.missing ?? 0) > 0) return { label: `${summary.missing} missing`, className: ITEM_STATE_STYLE.missing.className }
  if ((summary.expiring ?? 0) > 0) return { label: 'Expires before start', className: ITEM_STATE_STYLE.expiring.className }
  if ((summary.in_review ?? 0) > 0) return { label: `${summary.in_review} in review`, className: ITEM_STATE_STYLE.in_review.className }
  return { label: 'Ready', className: ITEM_STATE_STYLE.ready.className }
}

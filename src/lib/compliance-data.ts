import type { SupabaseClient } from '@supabase/supabase-js'
import {
  appliesToEmploymentClass,
  type CenterDocumentRequirement, type CenterStaffDocumentStatus, type EmploymentClass,
} from '@/lib/types'
import { computeCompliance, type ComplianceResult, type ComplianceState } from '@/lib/compliance'

/**
 * Compliance for a whole center: every active employee × every requirement that applies
 * to them, with the computed status. Works with the browser client (RLS) and with the
 * service-role client (scheduled reminders).
 */
export interface EmployeeCompliance {
  staffId: string
  userId: string | null
  name: string
  employmentClass: EmploymentClass
  startDate: string | null
  /** keyed by requirement id; missing key = requirement does not apply */
  items: Record<string, ComplianceResult & { record: StatusRow | null }>
}

type StatusRow = Pick<CenterStaffDocumentStatus,
  'staff_id' | 'requirement_id' | 'status' | 'completed_on' | 'reviewed_at' | 'expires_on' | 'due_on' | 'not_applicable' | 'acknowledged_version'> & {
  matched_document: { expiry_date: string | null } | { expiry_date: string | null }[] | null
}

export interface CenterCompliance {
  requirements: CenterDocumentRequirement[]
  employees: EmployeeCompliance[]
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

export async function loadCenterCompliance(supabase: SupabaseClient, centerId: string, today: Date = new Date()): Promise<CenterCompliance> {
  const [staffRes, reqRes, statusRes] = await Promise.all([
    supabase.from('center_staff')
      .select('staff_id, employment_class, employment_start_date, staff_profiles(user_id, first_name, last_name)')
      .eq('center_id', centerId)
      .eq('status', 'active'),
    supabase.from('center_document_requirements').select('*').eq('center_id', centerId).eq('audience', 'staff')
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    supabase.from('center_staff_document_status')
      .select('staff_id, requirement_id, status, completed_on, reviewed_at, expires_on, due_on, not_applicable, acknowledged_version, matched_document:staff_documents(expiry_date)')
      .eq('center_id', centerId),
  ])

  const requirements = (reqRes.data || []) as CenterDocumentRequirement[]
  const statuses = (statusRes.data || []) as StatusRow[]

  const employees: EmployeeCompliance[] = (staffRes.data || []).map(row => {
    const profile = one(row.staff_profiles) as { user_id?: string; first_name?: string; last_name?: string } | null
    const items: EmployeeCompliance['items'] = {}
    for (const req of requirements) {
      if (!appliesToEmploymentClass(req, row.employment_class)) continue
      const record = statuses.find(s => s.staff_id === row.staff_id && s.requirement_id === req.id) ?? null
      const doc = one(record?.matched_document)
      items[req.id] = { ...computeCompliance(req, record, row.employment_start_date, doc?.expiry_date, today), record }
    }
    return {
      staffId: row.staff_id,
      userId: profile?.user_id ?? null,
      name: `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || 'Employee',
      employmentClass: row.employment_class,
      startDate: row.employment_start_date,
      items,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  return { requirements, employees }
}

export function countStates(data: CenterCompliance) {
  const counts: Record<ComplianceState, number> = {
    current: 0, due_soon: 0, overdue: 0, pending_review: 0, rejected: 0, missing: 0, not_applicable: 0,
  }
  for (const e of data.employees) for (const item of Object.values(e.items)) counts[item.state]++
  return counts
}

/** Whole days from today to `date` (negative = past) */
export function daysUntil(date: Date, today: Date = new Date()) {
  const a = new Date(today); a.setHours(0, 0, 0, 0)
  const b = new Date(date); b.setHours(0, 0, 0, 0)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

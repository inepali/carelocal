import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { computeReadiness, summarizeReadiness, type NeededAt, type ReadinessItem } from '@/lib/jobs'
import type { CenterDocumentRequirement, CenterStaffDocumentStatus, StaffDocument } from '@/lib/types'

/**
 * Server-only (service role): the job_applications.readiness cache. Readiness itself is always computed
 * from live data by computeReadiness(); the cache only feeds list views (applicant badges).
 */
export const serviceClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

/** Live readiness of one application, plus what the cache currently holds. */
export async function computeApplicationReadiness(db: SupabaseClient, appId: string) {
  const { data: app } = await db.from('job_applications')
    .select('id, job_id, center_id, staff_id, stage, resume_document_id, offer_start_date, readiness').eq('id', appId).maybeSingle()
  if (!app) return null
  const [{ data: job }, { data: reqRows }, { data: records }, { data: docs }] = await Promise.all([
    db.from('job_postings').select('start_date').eq('id', app.job_id).maybeSingle(),
    db.from('job_posting_requirements').select('needed_at, requirement:center_document_requirements(*)').eq('job_id', app.job_id),
    db.from('center_staff_document_status').select('*').eq('center_id', app.center_id).eq('staff_id', app.staff_id),
    db.from('staff_documents').select('*').eq('staff_id', app.staff_id),
  ])
  const items = (reqRows ?? []).flatMap(r => {
    const requirement = (Array.isArray(r.requirement) ? r.requirement[0] : r.requirement) as CenterDocumentRequirement | null
    return requirement ? [{ requirement, neededAt: r.needed_at as NeededAt }] : []
  })
  const vault = (docs ?? []) as StaffDocument[]
  const readiness: ReadinessItem[] = computeReadiness({
    items,
    records: (records ?? []) as CenterStaffDocumentStatus[],
    vaultDocs: vault,
    startDate: app.offer_start_date ?? job?.start_date ?? null,
  })
  const hasResume = !!app.resume_document_id && vault.some(d => d.id === app.resume_document_id)
  return { app, readiness, hasResume, cached: (app.readiness ?? {}) as Record<string, unknown> }
}

/** Recomputes and stores the cache for one application. Keeps the list of expiry nudges already sent. */
export async function refreshReadinessCache(appId: string, db: SupabaseClient = serviceClient()) {
  const result = await computeApplicationReadiness(db, appId)
  if (!result) return null
  await db.from('job_applications').update({
    readiness: { ...summarizeReadiness(result.readiness, result.hasResume), nudged: result.cached.nudged ?? [] },
  }).eq('id', appId)
  return result
}

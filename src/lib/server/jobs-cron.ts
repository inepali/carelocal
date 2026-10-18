import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyUsers } from '@/lib/server/notify'
import { refreshReadinessCache } from '@/lib/server/job-readiness'

/**
 * Daily regular-hiring upkeep, run from /api/cron/compliance-reminders (service role):
 *  1. Auto-close postings whose closes_at has passed (open applicants are told).
 *  2. Refresh the readiness cache of open applications, and nudge applicants once per item when a
 *     document will expire before the start date.
 *  3. End admin access 30 days after a rejection or withdrawal: the person's "applying" link to the
 *     center becomes "removed" when they have no other open application there.
 */
const OPEN = ['applied', 'reviewing', 'interview', 'offer']
const RELEASE_AFTER_DAYS = 30

export async function runJobsMaintenance(db: SupabaseClient) {
  const summary = { jobsClosed: 0, readinessRefreshed: 0, expiryNudges: 0, linksReleased: 0 }

  // 1. Auto-close
  const { data: expired } = await db.from('job_postings')
    .select('id, title, center:centers(name, domain_key)')
    .in('status', ['published', 'paused']).lt('closes_at', new Date().toISOString())
  for (const job of expired ?? []) {
    const { error } = await db.from('job_postings').update({ status: 'closed' }).eq('id', job.id)
    if (error) continue
    summary.jobsClosed++
    const center = (Array.isArray(job.center) ? job.center[0] : job.center) as { name?: string; domain_key?: string } | null
    const { data: apps } = await db.from('job_applications').select('id, staff:staff_profiles(user_id)').eq('job_id', job.id).in('stage', OPEN)
    for (const app of apps ?? []) {
      const staff = (Array.isArray(app.staff) ? app.staff[0] : app.staff) as { user_id?: string } | null
      if (!staff?.user_id) continue
      await notifyUsers([staff.user_id], {
        title: `${job.title} is no longer open`,
        message: `${center?.name ?? 'The center'} closed this job posting.`,
        type: 'job_closed', referenceId: app.id, url: '/staff/applications', emailCta: 'View applications',
      }, center?.domain_key).catch(() => {})
    }
  }

  // 2. Readiness cache + expiry nudges
  const { data: openApps } = await db.from('job_applications')
    .select('id, staff:staff_profiles(user_id), job:job_postings(title), center:centers(name, domain_key)')
    .in('stage', OPEN)
  for (const app of openApps ?? []) {
    const result = await refreshReadinessCache(app.id, db)
    if (!result) continue
    summary.readinessRefreshed++

    const nudged = new Set((result.cached.nudged as string[] | undefined) ?? [])
    const expiring = result.readiness.filter(i => i.state === 'expiring' && !nudged.has(i.requirement.id))
    if (expiring.length === 0) continue
    const staff = (Array.isArray(app.staff) ? app.staff[0] : app.staff) as { user_id?: string } | null
    const job = (Array.isArray(app.job) ? app.job[0] : app.job) as { title?: string } | null
    const center = (Array.isArray(app.center) ? app.center[0] : app.center) as { name?: string; domain_key?: string } | null
    if (staff?.user_id) {
      await notifyUsers([staff.user_id], {
        title: `Update a document for ${job?.title ?? 'your application'}`,
        message: `${expiring.map(i => i.requirement.document_name).join(', ')} will expire before your start date at ${center?.name ?? 'the center'}. Upload a newer copy.`,
        type: 'job_doc_expiring', referenceId: app.id, url: '/staff/documents', emailCta: 'Update documents',
      }, center?.domain_key).catch(() => {})
      summary.expiryNudges++
    }
    expiring.forEach(i => nudged.add(i.requirement.id))
    const { data: current } = await db.from('job_applications').select('readiness').eq('id', app.id).single()
    await db.from('job_applications').update({ readiness: { ...(current?.readiness ?? {}), nudged: [...nudged] } }).eq('id', app.id)
  }

  // 3. Release applicant access 30 days after the application closed
  const cutoff = new Date(Date.now() - RELEASE_AFTER_DAYS * 86_400_000).toISOString()
  const { data: closed } = await db.from('job_applications')
    .select('staff_id, center_id, center_staff_id')
    .in('stage', ['rejected', 'withdrawn']).lt('decided_at', cutoff)
  const seen = new Set<string>()
  for (const app of closed ?? []) {
    if (seen.has(app.center_staff_id)) continue
    seen.add(app.center_staff_id)
    const { count } = await db.from('job_applications').select('id', { count: 'exact', head: true })
      .eq('staff_id', app.staff_id).eq('center_id', app.center_id).in('stage', OPEN)
    if ((count ?? 0) > 0) continue
    // Only an applying link is released: an employee's active link is never touched
    const { data: released } = await db.from('center_staff').update({ status: 'removed' })
      .eq('id', app.center_staff_id).eq('status', 'applying').select('id')
    if (released?.length) summary.linksReleased++
  }

  return summary
}

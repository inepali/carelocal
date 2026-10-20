'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2 } from '@/lib/r2'
import { createClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/server/notify'
import { copyAcceptedDocuments } from '@/lib/server/document-snapshots'
import { refreshReadinessCache } from '@/lib/server/job-readiness'
import { sendJobAlerts } from '@/lib/server/job-alerts'
import { createDocumentRequests } from '@/app/actions/document-requests.actions'
import { formatInterviewTime, slugify, type EmploymentType, type JobStatus, type NeededAt } from '@/lib/jobs'

/**
 * Regular hiring. The database functions own the rules (apply_to_job, send_job_offer, accept_job_offer, …);
 * these actions handle auth, notifications, the readiness cache and revalidation, matching
 * document-requests.actions.ts.
 */

type Result<T = object> = ({ success: true } & T) | { success: false; error: string }
const fail = (error: string): { success: false; error: string } => ({ success: false, error })
const service = () => createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function session() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

async function adminCenter(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from('center_admins').select('center_id, centers(id, name, jobs_enabled, domain_key)')
    .eq('user_id', userId).limit(1).maybeSingle()
  const center = data?.centers as { id: string; name: string; jobs_enabled: boolean; domain_key: string } | { id: string; name: string; jobs_enabled: boolean; domain_key: string }[] | null | undefined
  return (Array.isArray(center) ? center[0] : center) ?? null
}

async function centerAdminUserIds(centerId: string) {
  const { data } = await service().from('center_admins').select('user_id').eq('center_id', centerId)
  return (data ?? []).map(r => r.user_id as string)
}

async function staffUserId(staffId: string) {
  const { data } = await service().from('staff_profiles').select('user_id, first_name, last_name').eq('id', staffId).maybeSingle()
  return data as { user_id: string; first_name: string; last_name: string } | null
}

/** Message from a database exception, without the Postgres prefix */
const dbError = (error: { message?: string } | null | undefined, fallback: string) => error?.message?.replace(/^.*?ERROR:\s*/, '') || fallback

// ─── Readiness cache ─────────────────────────────────────────────────────────

/** Recomputes job_applications.readiness for one application (service role; the cache only). */
async function refreshReadiness(appId: string) {
  await refreshReadinessCache(appId, service())
}

/** Admin board: refresh the cache for every open application on a job. */
export async function refreshJobReadiness(jobId: string): Promise<Result> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  const { data: apps } = await supabase.from('job_applications').select('id, stage').eq('job_id', jobId)
  for (const app of apps ?? []) {
    if (['applied', 'reviewing', 'interview', 'offer'].includes(app.stage)) await refreshReadiness(app.id)
  }
  return { success: true }
}

// ─── Postings ────────────────────────────────────────────────────────────────

export interface JobInput {
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
  closes_at: string | null
  requirements: { requirement_id: string; needed_at: NeededAt }[]
}

function cleanJob(input: JobInput) {
  return {
    title: input.title.trim(),
    role_value: input.role_value || null,
    employment_type: input.employment_type,
    description: input.description.trim(),
    schedule_summary: input.schedule_summary?.trim() || null,
    hours_per_week: input.hours_per_week ?? null,
    pay_min: input.pay_min ?? null,
    pay_max: input.pay_max ?? input.pay_min ?? null,   // a fixed pay is stored as min = max
    pay_unit: input.pay_unit,
    benefits: input.benefits,
    start_date: input.start_date || null,
    openings: Math.max(1, Math.round(input.openings || 1)),
    closes_at: input.closes_at || null,
  }
}

function validateJob(input: JobInput) {
  if (!input.title.trim()) return 'Add a job title.'
  if (!input.description.trim()) return 'Add a job description.'
  if (input.pay_min != null && input.pay_max != null && input.pay_max < input.pay_min) return 'The top of the pay range is below the bottom.'
  return null
}

async function saveRequirements(supabase: Awaited<ReturnType<typeof createClient>>, jobId: string, requirements: JobInput['requirements']) {
  await supabase.from('job_posting_requirements').delete().eq('job_id', jobId)
  if (requirements.length === 0) return null
  const { error } = await supabase.from('job_posting_requirements')
    .insert(requirements.map(r => ({ job_id: jobId, requirement_id: r.requirement_id, needed_at: r.needed_at })))
  return error
}

export async function createJob(input: JobInput, publish = false): Promise<Result<{ jobId: string }>> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  const center = await adminCenter(supabase, user.id)
  if (!center) return fail('Only center admins can post jobs.')
  if (!center.jobs_enabled) return fail('Job postings are not enabled for your center yet. Contact CareLocal support to turn them on.')
  const invalid = validateJob(input)
  if (invalid) return fail(invalid)

  const slug = `${slugify(input.title)}-${Math.random().toString(36).slice(2, 6)}`
  const { data, error } = await supabase.from('job_postings').insert({
    ...cleanJob(input), center_id: center.id, slug, status: 'draft', created_by: user.id,
  }).select('id').single()
  if (error || !data) return fail(dbError(error, 'Could not save the job.'))

  const reqError = await saveRequirements(supabase, data.id, input.requirements)
  if (reqError) return fail(dbError(reqError, 'The job was saved, but its required items were not.'))

  if (publish) {
    const published = await setJobStatus(data.id, 'published')
    if (!published.success) return fail(`Saved as a draft. ${published.error}`)
  }
  revalidatePath('/center/jobs')
  return { success: true, jobId: data.id as string }
}

export async function updateJob(jobId: string, input: JobInput): Promise<Result> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  const invalid = validateJob(input)
  if (invalid) return fail(invalid)

  const { error } = await supabase.from('job_postings').update(cleanJob(input)).eq('id', jobId)
  if (error) return fail(dbError(error, 'Could not save the job.'))
  const reqError = await saveRequirements(supabase, jobId, input.requirements)
  if (reqError) return fail(dbError(reqError, 'Could not save the required items.'))
  revalidatePath('/center/jobs')
  revalidatePath(`/center/jobs/${jobId}`)
  return { success: true }
}

/** Publish / pause / close / back to draft. Tier limit, past-due and pay rules are enforced by the database. */
export async function setJobStatus(jobId: string, status: Exclude<JobStatus, 'filled'>): Promise<Result> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  const { data: job, error } = await supabase.from('job_postings').update({ status }).eq('id', jobId)
    .select('id, title, center_id').maybeSingle()
  if (error) return fail(dbError(error, 'Could not change the job status.'))
  if (!job) return fail('Job not found.')

  if (status === 'closed') await notifyOpenApplicants(job.id, job.title, 'closed')
  // First publish: tell staff whose job alerts match (sent once per posting)
  if (status === 'published') await sendJobAlerts(job.id).catch(err => console.error('[jobs] job alerts failed', err))
  revalidatePath('/center/jobs')
  revalidatePath(`/center/jobs/${jobId}`)
  revalidatePath('/staff/jobs')
  revalidatePath('/jobs')
  return { success: true }
}

/** Tells applicants who are still open that the job was closed or filled. */
async function notifyOpenApplicants(jobId: string, title: string, why: 'closed' | 'filled', exceptAppId?: string) {
  const { data: apps } = await service().from('job_applications')
    .select('id, staff:staff_profiles(user_id), center:centers(name, domain_key)')
    .eq('job_id', jobId).in('stage', ['applied', 'reviewing', 'interview', 'offer'])
  for (const app of apps ?? []) {
    if (app.id === exceptAppId) continue
    const staff = (Array.isArray(app.staff) ? app.staff[0] : app.staff) as { user_id?: string } | null
    const center = (Array.isArray(app.center) ? app.center[0] : app.center) as { name?: string; domain_key?: string } | null
    if (!staff?.user_id) continue
    await notifyUsers([staff.user_id], {
      title: `${title} is no longer open`,
      message: `${center?.name ?? 'The center'} ${why === 'filled' ? 'has filled this position' : 'closed this job posting'}.`,
      type: 'job_closed', referenceId: app.id, url: '/staff/applications', emailCta: 'View applications',
    }, center?.domain_key).catch(() => {})
  }
}

/** Super admin: turn hiring on or off for a center (the Phase 1 pilot gate). */
export async function setCenterJobsEnabled(centerId: string, enabled: boolean): Promise<Result> {
  const { user } = await session()
  if (user?.app_metadata?.is_super_admin !== true) return fail('Not allowed')
  const { error } = await service().from('centers').update({ jobs_enabled: enabled }).eq('id', centerId)
  return error ? fail(error.message) : { success: true }
}

// ─── Staff ───────────────────────────────────────────────────────────────────

export async function applyToJob(input: {
  jobId: string
  coverNote: string
  items: { requirement_id: string; document_id: string }[]
  resumeDocumentId: string | null
}): Promise<Result<{ applicationId: string }>> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')

  const { data: appId, error } = await supabase.rpc('apply_to_job', {
    p_job_id: input.jobId,
    p_cover_note: input.coverNote || null,
    p_items: input.items,
    p_resume_document_id: input.resumeDocumentId,
  })
  if (error || !appId) return fail(dbError(error, 'Could not submit your application.'))
  const applicationId = appId as string

  await refreshReadiness(applicationId)
  try {
    const { data: app } = await service().from('job_applications')
      .select('center_id, staff_id, job:job_postings(title), center:centers(domain_key)').eq('id', applicationId).single()
    const job = (Array.isArray(app?.job) ? app.job[0] : app?.job) as { title?: string } | null
    const center = (Array.isArray(app?.center) ? app.center[0] : app?.center) as { domain_key?: string } | null
    const staff = app ? await staffUserId(app.staff_id) : null
    if (app) {
      await notifyUsers(await centerAdminUserIds(app.center_id), {
        title: `New application: ${job?.title ?? 'a job'}`,
        message: `${staff ? `${staff.first_name} ${staff.last_name}` : 'Someone'} applied.`,
        type: 'job_application', referenceId: applicationId,
        url: `/center/jobs/${input.jobId}/applications/${applicationId}`, emailCta: 'Review application',
      }, center?.domain_key)
    }
  } catch (err) {
    console.error('Failed to send application notification:', err)
  }
  revalidatePath('/staff/applications')
  return { success: true, applicationId }
}

async function notifyAdminsOfWithdrawal(appId: string, declined: boolean) {
  try {
    const { data: app } = await service().from('job_applications')
      .select('job_id, center_id, staff_id, job:job_postings(title), center:centers(domain_key)').eq('id', appId).single()
    if (!app) return
    const job = (Array.isArray(app.job) ? app.job[0] : app.job) as { title?: string } | null
    const center = (Array.isArray(app.center) ? app.center[0] : app.center) as { domain_key?: string } | null
    const staff = await staffUserId(app.staff_id)
    await notifyUsers(await centerAdminUserIds(app.center_id), {
      title: `${declined ? 'Offer declined' : 'Application withdrawn'}: ${job?.title ?? 'a job'}`,
      message: `${staff ? `${staff.first_name} ${staff.last_name}` : 'The applicant'} ${declined ? 'declined your offer' : 'withdrew their application'}.`,
      type: 'job_application_withdrawn', referenceId: appId,
      url: `/center/jobs/${app.job_id}/applications/${appId}`, emailCta: 'View application',
    }, center?.domain_key)
  } catch (err) {
    console.error('Failed to send withdrawal notification:', err)
  }
}

export async function withdrawApplication(appId: string): Promise<Result> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  const { error } = await supabase.rpc('withdraw_job_application', { p_app_id: appId })
  if (error) return fail(dbError(error, 'Could not withdraw.'))
  await notifyAdminsOfWithdrawal(appId, false)
  revalidatePath('/staff/applications')
  return { success: true }
}

export async function declineOffer(appId: string, note: string): Promise<Result> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  const { error } = await supabase.rpc('decline_job_offer', { p_app_id: appId, p_note: note || null })
  if (error) return fail(dbError(error, 'Could not decline the offer.'))
  await notifyAdminsOfWithdrawal(appId, true)
  revalidatePath('/staff/applications')
  return { success: true }
}

/**
 * Staff: leave a center they belong to (leave_center ends the link and withdraws pending shift
 * requests; it refuses while they have booked shifts, an open application or an admin role there).
 */
export async function leaveCenter(centerId: string): Promise<Result<{ centerName: string }>> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  const { data, error } = await supabase.rpc('leave_center', { p_center_id: centerId })
  if (error || !data) return fail(dbError(error, 'Could not leave the center.'))
  const result = data as { center_name: string; domain_key: string | null }

  try {
    const { data: me } = await service().from('staff_profiles').select('id, first_name, last_name').eq('user_id', user.id).maybeSingle()
    await notifyUsers(await centerAdminUserIds(centerId), {
      title: `${me ? `${me.first_name} ${me.last_name}` : 'A team member'} left your center`,
      message: `${me ? me.first_name : 'They'} ended their link with ${result.center_name} and will no longer see or claim your shifts.`,
      type: 'staff_left_center', referenceId: me?.id,
      url: '/center/team_member', emailCta: 'View team',
    }, result.domain_key)
  } catch (err) {
    console.error('Failed to send leave notification:', err)
  }
  revalidatePath('/staff/centers')
  return { success: true, centerName: result.center_name }
}

/** Staff: accept an offer. `leaveCenterIds`: other centers to leave first (a regular works at one center). */
export async function acceptOffer(appId: string, leaveCenterIds: string[] = []): Promise<Result<{ centerId: string }>> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  for (const centerId of leaveCenterIds) {
    const left = await leaveCenter(centerId)
    if (!left.success) return fail(left.error)
  }
  const { data, error } = await supabase.rpc('accept_job_offer', { p_app_id: appId })
  if (error || !data) return fail(dbError(error, 'Could not accept the offer.'))
  const result = data as { center_id: string; staff_id: string; job_id: string; filled: boolean }

  // The hire is done in the database; now the follow-ups (each can fail without undoing it)
  const copies = await copyAcceptedDocuments(result.center_id, result.staff_id).catch(() => null)
  if (copies && (!copies.success || copies.failed > 0)) console.error('[jobs] center copies after hire were incomplete', appId)

  try {
    const db = service()
    const [{ data: job }, { data: center }, staff] = await Promise.all([
      db.from('job_postings').select('title').eq('id', result.job_id).single(),
      db.from('centers').select('domain_key').eq('id', result.center_id).single(),
      staffUserId(result.staff_id),
    ])
    await notifyUsers(await centerAdminUserIds(result.center_id), {
      title: `Hired: ${staff ? `${staff.first_name} ${staff.last_name}` : 'your new employee'}`,
      message: `Your offer for ${job?.title ?? 'the job'} was accepted.`,
      type: 'job_offer_accepted', referenceId: appId,
      url: `/center/team_member/${result.staff_id}`, emailCta: 'View employee',
    }, center?.domain_key)
    if (result.filled && job) await notifyOpenApplicants(result.job_id, job.title, 'filled', appId)
  } catch (err) {
    console.error('Failed to send hire notifications:', err)
  }
  revalidatePath('/staff/applications')
  return { success: true, centerId: result.center_id }
}

// ─── Admin: applicants ───────────────────────────────────────────────────────

export async function moveApplicationStage(appId: string, stage: 'applied' | 'reviewing' | 'rejected', note?: string, reason?: string): Promise<Result> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  const { error } = await supabase.rpc('move_application_stage', { p_app_id: appId, p_stage: stage, p_note: note || null, p_reason: reason || null })
  if (error) return fail(dbError(error, 'Could not move the application.'))

  if (stage === 'rejected') {
    try {
      const { data: app } = await service().from('job_applications')
        .select('staff_id, job:job_postings(title), center:centers(name, domain_key)').eq('id', appId).single()
      const job = (Array.isArray(app?.job) ? app.job[0] : app?.job) as { title?: string } | null
      const center = (Array.isArray(app?.center) ? app.center[0] : app?.center) as { name?: string; domain_key?: string } | null
      const staff = app ? await staffUserId(app.staff_id) : null
      if (staff) {
        await notifyUsers([staff.user_id], { title: `Update on ${job?.title ?? 'your application'}`, message: `${center?.name ?? 'The center'} has decided not to move forward with your application. Thank you for applying.`, type: 'job_not_selected', referenceId: appId, url: '/staff/applications', emailCta: 'View applications' },
          center?.domain_key)
      }
    } catch (err) {
      console.error('Failed to send stage notification:', err)
    }
  }
  return { success: true }
}

/**
 * Schedule (or reschedule) the interview: date + time and where are required. Moves the application
 * to Interview and tells the applicant the details. `at` is an ISO timestamp.
 */
export async function scheduleInterview(appId: string, input: { at: string; location: string; note: string }): Promise<Result> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  const { data: before } = await supabase.from('job_applications').select('stage').eq('id', appId).maybeSingle()
  const { error } = await supabase.rpc('schedule_job_interview', {
    p_app_id: appId, p_at: input.at, p_location: input.location, p_note: input.note || null,
  })
  if (error) return fail(dbError(error, 'Could not schedule the interview.'))

  try {
    const { data: app } = await service().from('job_applications')
      .select('staff_id, job:job_postings(title), center:centers(name, domain_key, timezone)').eq('id', appId).single()
    const job = (Array.isArray(app?.job) ? app.job[0] : app?.job) as { title?: string } | null
    const center = (Array.isArray(app?.center) ? app.center[0] : app?.center) as { name?: string; domain_key?: string; timezone?: string } | null
    const staff = app ? await staffUserId(app.staff_id) : null
    if (staff) {
      const when = formatInterviewTime(input.at, center?.timezone || 'America/New_York')
      const rescheduled = before?.stage === 'interview'
      await notifyUsers([staff.user_id], {
        title: `${rescheduled ? 'Interview rescheduled' : 'Interview'}: ${job?.title ?? 'your application'}`,
        message: `${center?.name ?? 'The center'} ${rescheduled ? 'moved your interview to' : 'would like to interview you on'} ${when} at ${input.location.trim()}.${input.note.trim() ? ` ${input.note.trim()}` : ''}`,
        type: 'job_stage_interview', referenceId: appId, url: '/staff/applications', emailCta: 'View interview details',
      }, center?.domain_key)
    }
  } catch (err) {
    console.error('Failed to send interview notification:', err)
  }
  return { success: true }
}

/** A letter uploaded for an offer that was not sent: remove it (only from the admin's own center folder). */
async function discardOfferLetter(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, fileKey: string) {
  const center = await adminCenter(supabase, userId)
  const bucket = process.env.R2_CENTER_BUCKET_INTERNAL
  if (!center || !bucket || !fileKey.startsWith(`offer_letter/${center.id}/`)) return
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: fileKey }))
  } catch (err) {
    console.error('Failed to remove unsent offer letter:', err)
  }
}

export async function sendOffer(appId: string, input: {
  startDate: string; pay: number | null; note: string
  /** Offer letter already uploaded with uploadStoredFile('offer_letter', …) */
  letter?: { fileKey: string; bucketName: string; name: string } | null
}): Promise<Result<{ requests: number }>> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  const { data, error } = await supabase.rpc('send_job_offer', {
    p_app_id: appId, p_start_date: input.startDate, p_pay: input.pay, p_note: input.note || null,
    p_letter_key: input.letter?.fileKey ?? null, p_letter_bucket: input.letter?.bucketName ?? null, p_letter_name: input.letter?.name ?? null,
  })
  if (error) {
    if (input.letter) await discardOfferLetter(supabase, user.id, input.letter.fileKey)
    return fail(dbError(error, 'Could not send the offer.'))
  }
  await refreshReadiness(appId)

  try {
    const { data: app } = await service().from('job_applications')
      .select('staff_id, job:job_postings(title), center:centers(name, domain_key)').eq('id', appId).single()
    const job = (Array.isArray(app?.job) ? app.job[0] : app?.job) as { title?: string } | null
    const center = (Array.isArray(app?.center) ? app.center[0] : app?.center) as { name?: string; domain_key?: string } | null
    const staff = app ? await staffUserId(app.staff_id) : null
    if (staff) {
      await notifyUsers([staff.user_id], {
        title: `Job offer: ${job?.title ?? 'a position'}`,
        message: `${center?.name ?? 'A center'} sent you an offer starting ${new Date(`${input.startDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.${input.letter ? ' Your offer letter is attached; open and review it,' : ' Review it'} and accept it in CareLocal.`,
        type: 'job_offer', referenceId: appId, url: '/staff/applications', emailCta: 'View offer',
      }, center?.domain_key)
    }
  } catch (err) {
    console.error('Failed to send offer notification:', err)
  }
  return { success: true, requests: (data as number) ?? 0 }
}

/** Ask an applicant for a missing checklist item (reuses document requests). */
export async function requestApplicantDocument(appId: string, requirementId: string): Promise<Result> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  const { data: app } = await supabase.from('job_applications').select('staff_id').eq('id', appId).maybeSingle()
  if (!app) return fail('Application not found.')
  const res = await createDocumentRequests({ staffIds: [app.staff_id], requirementId })
  if (!res.success) return fail(res.error)
  if (res.count === 0) return fail('There is already an open request for this item.')
  return { success: true }
}

/** Recompute one application's readiness (detail view / after a review). */
export async function refreshApplicationReadiness(appId: string): Promise<Result> {
  const { supabase, user } = await session()
  if (!user) return fail('Please sign in again.')
  const { data } = await supabase.from('job_applications').select('id').eq('id', appId).maybeSingle()
  if (!data) return fail('Application not found.')
  await refreshReadiness(appId)
  return { success: true }
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { StaffAvatar } from '@/components/StaffAvatar'
import { useStaffRoles } from '@/lib/hooks/useStaffRoles'
import { lookupLabel } from '@/lib/lookups'
import { showAlert, showConfirm } from '@/lib/dialog'
import { refreshJobReadiness, setJobStatus } from '@/app/actions/jobs.actions'
import {
  BOARD_STAGES, EMPLOYMENT_TYPE_LABELS, JOB_STATUS_STYLE, STAGE_LABELS, formatInterviewTime, formatPay, readinessBadge,
  type JobApplication, type JobPosting, type JobStatus,
} from '@/lib/jobs'

type Card = JobApplication & {
  staff: { id: string; first_name: string; last_name: string; staff_type: string | null; avatar_url: string | null } | null
  years: number
}

/** Years of experience from the applicant's work history (overlaps not merged; a rough guide) */
function yearsOfExperience(rows: { start_month: number | null; start_year: number | null; end_month: number | null; end_year: number | null; is_current: boolean }[]) {
  const now = new Date()
  let months = 0
  for (const r of rows) {
    if (!r.start_year) continue
    const start = r.start_year * 12 + (r.start_month ?? 1)
    const end = r.is_current || !r.end_year ? now.getFullYear() * 12 + now.getMonth() + 1 : r.end_year * 12 + (r.end_month ?? 12)
    months += Math.max(0, end - start)
  }
  return Math.round(months / 12)
}

/** Center admin: one job's applicants as a board (Applied → Reviewing → Interview → Offer). */
export default function JobBoardPage() {
  const { id } = useParams<{ id: string }>()
  const { roles } = useStaffRoles()
  const [job, setJob] = useState<JobPosting | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showClosed, setShowClosed] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: jobRow }, { data: apps }] = await Promise.all([
      supabase.from('job_postings').select('*').eq('id', id).maybeSingle(),
      supabase.from('job_applications')
        .select('*, staff:staff_profiles(id, first_name, last_name, staff_type, avatar_url)')
        .eq('job_id', id).order('applied_at', { ascending: true }),
    ])
    setJob(jobRow as JobPosting | null)
    const staffIds = (apps ?? []).map(a => a.staff_id)
    const { data: exp } = staffIds.length
      ? await supabase.from('staff_experiences').select('staff_id, start_month, start_year, end_month, end_year, is_current').in('staff_id', staffIds)
      : { data: [] }
    setCards((apps ?? []).map(a => ({
      ...(a as JobApplication),
      staff: (Array.isArray(a.staff) ? a.staff[0] : a.staff) ?? null,
      years: yearsOfExperience((exp ?? []).filter(e => e.staff_id === a.staff_id)),
    })))
    setLoading(false)
  }, [id])

  useEffect(() => {
    // Show the cached readiness straight away, then refresh it and reload
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().then(() => refreshJobReadiness(id)).then(() => load())
  }, [id, load])

  async function changeStatus(status: Exclude<JobStatus, 'filled'>, confirmText?: string) {
    if (confirmText && !await showConfirm(confirmText, { tone: status === 'closed' ? 'danger' : 'default' })) return
    setBusy(true)
    const res = await setJobStatus(id, status)
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!job) return <p className="text-muted">Job not found.</p>

  const style = JOB_STATUS_STYLE[job.status]
  const closed = cards.filter(c => !BOARD_STAGES.includes(c.stage))

  return (
    <div className="max-w-7xl">
      <Link href="/center/jobs" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> Back to Jobs</Link>

      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-extrabold text-heading">{job.title}</h1>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${style.className}`}>{style.label}</span>
          </div>
          <p className="text-muted">
            {[job.role_value ? lookupLabel(roles, job.role_value) : null, EMPLOYMENT_TYPE_LABELS[job.employment_type], formatPay(job),
              job.start_date ? `Starts ${new Date(`${job.start_date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Starts ASAP',
              `${job.openings} opening${job.openings === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/center/jobs/${job.id}/edit`} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-brand-600 hover:bg-brand-50"><Pencil className="h-4 w-4" /> Edit</Link>
          {(job.status === 'draft' || job.status === 'closed') && (
            <button disabled={busy} onClick={() => changeStatus('published')} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">{job.status === 'draft' ? 'Publish' : 'Reopen'}</button>
          )}
          {job.status === 'published' && (
            <button disabled={busy} onClick={() => changeStatus('paused')} className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-muted hover:bg-surface disabled:opacity-50">Pause</button>
          )}
          {job.status === 'paused' && (
            <button disabled={busy} onClick={() => changeStatus('published')} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">Resume</button>
          )}
          {(job.status === 'published' || job.status === 'paused') && (
            <button disabled={busy} onClick={() => changeStatus('closed', 'Close this job? It stops taking applications. Open applicants are told it closed, and you can still hire from it.')}
              className="rounded-xl border border-red-100 bg-white px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">Close</button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_STAGES.map(stage => {
          const column = cards.filter(c => c.stage === stage)
          return (
            <div key={stage} className="rounded-2xl border border-border bg-surface p-3">
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="text-sm font-bold text-text-main">{STAGE_LABELS[stage]}</h2>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-muted">{column.length}</span>
              </div>
              <div className="space-y-2">
                {column.length === 0 && <p className="px-1 py-4 text-center text-xs text-subtle">No one here</p>}
                {column.map(card => {
                  const badge = readinessBadge(card.readiness)
                  return (
                    <Link key={card.id} href={`/center/jobs/${job.id}/applications/${card.id}`}
                      className="block rounded-xl border border-border bg-white p-3 shadow-sm transition-shadow hover:shadow-md">
                      <div className="flex items-center gap-3">
                        <StaffAvatar avatarKey={card.staff?.avatar_url} firstName={card.staff?.first_name ?? ''} lastName={card.staff?.last_name ?? ''}
                          className="h-9 w-9 rounded-xl bg-brand-50 text-xs font-bold text-brand-600" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-text-main">{card.staff ? `${card.staff.first_name} ${card.staff.last_name}` : 'Applicant'}</div>
                          <div className="truncate text-xs text-muted">
                            {[card.staff?.staff_type ? lookupLabel(roles, card.staff.staff_type) : null, `${card.years} yr${card.years === 1 ? '' : 's'} exp.`].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-subtle" />
                      </div>
                      <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] ${badge.className}`}>{badge.label}</span>
                      {card.stage === 'interview' && card.interview_at && (
                        <div className="mt-1.5 text-[11px] font-semibold text-violet-700">Interview {formatInterviewTime(card.interview_at)}</div>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {closed.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-white">
          <button onClick={() => setShowClosed(v => !v)} className="flex w-full items-center justify-between px-5 py-3 text-sm font-bold text-text-main">
            Hired, not selected and withdrawn ({closed.length})
            <ChevronDown className={`h-4 w-4 transition-transform ${showClosed ? 'rotate-180' : ''}`} />
          </button>
          {showClosed && (
            <div className="divide-y divide-border border-t border-border">
              {closed.map(card => (
                <Link key={card.id} href={`/center/jobs/${job.id}/applications/${card.id}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-surface">
                  <span className="font-medium text-text-main">{card.staff ? `${card.staff.first_name} ${card.staff.last_name}` : 'Applicant'}</span>
                  <span className="text-xs text-muted">{STAGE_LABELS[card.stage]}{card.decided_at ? ` · ${new Date(card.decided_at).toLocaleDateString()}` : ''}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

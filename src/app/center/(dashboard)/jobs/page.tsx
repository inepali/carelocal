'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Briefcase, ExternalLink, Loader2, Plus, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  BOARD_STAGES, EMPLOYMENT_TYPE_LABELS, JOB_STATUS_STYLE, STAGE_LABELS, formatPay,
  type ApplicationStage, type JobPosting,
} from '@/lib/jobs'

/** Center admin: every job posting with its status, applicants per stage and days open. */
export default function CenterJobsPage() {
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [centerSlug, setCenterSlug] = useState<string | null>(null)
  const [jobs, setJobs] = useState<JobPosting[]>([])
  const [now, setNow] = useState(0)
  const [showArchived, setShowArchived] = useState(false)
  const [counts, setCounts] = useState<Record<string, Partial<Record<ApplicationStage, number>>>>({})

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: admin } = await supabase.from('center_admins').select('center_id, centers(jobs_enabled, slug)').eq('user_id', user.id).limit(1).maybeSingle()
      const center = (Array.isArray(admin?.centers) ? admin.centers[0] : admin?.centers) as { jobs_enabled?: boolean; slug?: string } | null
      setEnabled(!!center?.jobs_enabled)
      setCenterSlug(center?.slug ?? null)
      if (!admin) { setLoading(false); return }

      const [{ data: jobRows }, { data: apps }] = await Promise.all([
        supabase.from('job_postings').select('*').eq('center_id', admin.center_id).order('created_at', { ascending: false }),
        supabase.from('job_applications').select('job_id, stage').eq('center_id', admin.center_id),
      ])
      const tally: Record<string, Partial<Record<ApplicationStage, number>>> = {}
      for (const a of apps ?? []) {
        const stage = a.stage as ApplicationStage
        tally[a.job_id] = { ...tally[a.job_id], [stage]: (tally[a.job_id]?.[stage] ?? 0) + 1 }
      }
      setJobs((jobRows ?? []) as JobPosting[])
      setCounts(tally)
      setNow(Date.now())
      setLoading(false)
    })()
  }, [])

  const archivedCount = jobs.filter(j => j.status === 'archived').length
  const visibleJobs = jobs.filter(j => showArchived || j.status !== 'archived')

  const daysOpen = (job: JobPosting) => job.published_at
    ? Math.max(0, Math.floor((now - new Date(job.published_at).getTime()) / 86_400_000))
    : null

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-heading mb-1">Jobs</h1>
          <p className="text-muted">Post regular full-time and part-time positions and hire from your applicants.</p>
        </div>
        {enabled && (
          <Link href="/center/jobs/new" className="inline-flex items-center justify-center gap-2 font-semibold px-5 py-3 rounded-xl shadow-sm bg-brand-600 text-white hover:bg-brand-800">
            <Plus className="w-5 h-5" /> New job
          </Link>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : !enabled ? (
        <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-50 p-10 text-center">
          <Briefcase className="mx-auto mb-3 h-10 w-10 text-brand-600" />
          <h2 className="mb-2 text-xl font-bold text-heading">Hiring is coming soon</h2>
          <p className="mx-auto max-w-md text-text-muted">Job postings are being piloted with a few centers. Contact CareLocal support if you would like to try them.</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-50 p-10 text-center">
          <Briefcase className="mx-auto mb-3 h-10 w-10 text-brand-600" />
          <h2 className="mb-2 text-xl font-bold text-heading">No jobs yet</h2>
          <p className="mx-auto mb-6 max-w-md text-text-muted">Post your first regular position. Required documents come straight from your compliance checklist.</p>
          <Link href="/center/jobs/new" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-800"><Plus className="h-5 w-5" /> New job</Link>
        </div>
      ) : (
        <>
        {archivedCount > 0 && (
          <label className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-muted">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="accent-brand-600" />
            Show archived ({archivedCount})
          </label>
        )}
        <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-border text-[15px] font-bold text-text-main">
                  <th scope="col" className="px-6 py-4">Job</th>
                  <th scope="col" className="px-4 py-4">Status</th>
                  <th scope="col" className="px-4 py-4">Applicants</th>
                  <th scope="col" className="px-4 py-4">Days open</th>
                  <th scope="col" className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm text-text-muted">
                {visibleJobs.map(job => {
                  const c = counts[job.id] ?? {}
                  const open = BOARD_STAGES.reduce((n, s) => n + (c[s] ?? 0), 0)
                  const style = JOB_STATUS_STYLE[job.status]
                  return (
                    <tr key={job.id} className="align-top hover:bg-surface">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/center/jobs/${job.id}`} className="font-semibold text-text-main hover:text-brand-600 hover:underline">{job.title}</Link>
                          {centerSlug && job.status !== 'draft' && (
                            <a href={`/jobs/${centerSlug}/${job.slug}`} target="_blank" rel="noopener noreferrer" title="View the public page" aria-label={`View the public page for ${job.title}`} className="rounded p-1 text-subtle hover:bg-brand-50 hover:text-brand-600">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                        <div className="text-xs text-muted">{EMPLOYMENT_TYPE_LABELS[job.employment_type]} · {formatPay(job)}</div>
                      </td>
                      <td className="px-4 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${style.className}`}>{style.label}</span></td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1.5 font-semibold text-text-main"><Users className="h-4 w-4 text-subtle" /> {open} open</div>
                        <div className="text-xs text-muted">
                          {BOARD_STAGES.filter(s => c[s]).map(s => `${STAGE_LABELS[s]} ${c[s]}`).join(' · ') || 'No applicants yet'}
                          {c.hired ? ` · Hired ${c.hired}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-4">{daysOpen(job) ?? '—'}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/center/jobs/${job.id}/edit`} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800">Edit</Link>
                          <Link href={`/center/jobs/${job.id}`} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800">Applicants</Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}
    </div>
  )
}

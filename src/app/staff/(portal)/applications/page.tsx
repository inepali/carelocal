'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Briefcase, CalendarClock, CheckCircle2, ClipboardList, FileText, Inbox, Loader2, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'
import { openStoredFile } from '@/lib/files'
import { acceptOffer, declineOffer, withdrawApplication } from '@/app/actions/jobs.actions'
import { OPEN_STAGES, STAGE_LABELS, formatInterviewTime, formatPay, isLink, type JobApplication, type JobPosting } from '@/lib/jobs'

type Row = JobApplication & { job: (Pick<JobPosting, 'id' | 'title' | 'pay_unit' | 'status'> & { center: { name: string } | null }) | null }

const STAGE_STYLE: Record<string, string> = {
  applied: 'bg-slate-50 text-slate-700 border-slate-200',
  reviewing: 'bg-sky-50 text-sky-700 border-sky-200',
  interview: 'bg-violet-50 text-violet-700 border-violet-200',
  offer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  hired: 'bg-emerald-600 text-white border-emerald-600',
  rejected: 'bg-slate-50 text-slate-500 border-slate-200',
  withdrawn: 'bg-slate-50 text-slate-500 border-slate-200',
}

/** Staff: their applications — stage, last update, open document requests, withdraw / accept / decline. */
export default function StaffApplicationsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Row[]>([])
  const [requests, setRequests] = useState<Record<string, number>>({})
  const [otherCenters, setOtherCenters] = useState<{ center_id: string; name: string }[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
    if (!profile) { setLoading(false); return }
    const [{ data: apps }, { data: reqs }, { data: links }] = await Promise.all([
      supabase.from('job_applications').select('*, job:job_postings(id, title, pay_unit, status, center:centers(name))')
        .eq('staff_id', profile.id).order('updated_at', { ascending: false }),
      supabase.from('document_requests').select('center_id').eq('staff_id', profile.id).eq('status', 'open'),
      supabase.from('center_staff').select('center_id, status, center:centers(name)').eq('staff_id', profile.id).in('status', ['active', 'inactive']),
    ])
    setRows((apps ?? []).map(a => {
      const job = Array.isArray(a.job) ? a.job[0] : a.job
      return { ...a, job: job ? { ...job, center: Array.isArray(job.center) ? job.center[0] : job.center } : null }
    }) as Row[])
    const counts: Record<string, number> = {}
    for (const r of reqs ?? []) counts[r.center_id] = (counts[r.center_id] ?? 0) + 1
    setRequests(counts)
    setOtherCenters((links ?? []).map(l => ({ center_id: l.center_id, name: ((Array.isArray(l.center) ? l.center[0] : l.center) as { name?: string } | null)?.name ?? 'a center' })))
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function withdraw(row: Row) {
    if (!await showConfirm(`Withdraw your application for ${row.job?.title ?? 'this job'}?`, { confirmLabel: 'Withdraw' })) return
    setBusyId(row.id)
    const res = await withdrawApplication(row.id)
    setBusyId(null)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  /** Opens the offer letter; the first open is recorded, which unlocks Accept. */
  async function openLetter(row: Row) {
    await openStoredFile('offer_letter', row.id)
    if (!row.offer_letter_viewed_at) load()
  }

  async function accept(row: Row) {
    if (row.offer_letter_file_key && !row.offer_letter_viewed_at) {
      showAlert('Open and review the offer letter before accepting.', { title: 'One more step' })
      return
    }
    const others = rows.filter(r => r.id !== row.id && OPEN_STAGES.includes(r.stage))
    // A regular works at one center: the other centers are left as part of accepting
    const leaving = otherCenters.filter(c => c.center_id !== row.center_id)
    const leavingNames = leaving.map(b => b.name).join(', ')
    const impact = [
      `You will become a regular employee at ${row.job?.center?.name ?? 'this center'}.`,
      leaving.length ? `You will leave ${leavingNames} first, since a regular employee works at one center. You will no longer see or claim shifts there, and pending shift requests there are withdrawn.` : null,
      others.length ? `Your ${others.length} other open application${others.length === 1 ? ' will be' : 's will be'} withdrawn.` : null,
    ].filter(Boolean).join('\n\n')
    if (!await showConfirm(impact, { title: 'Accept this offer?', confirmLabel: leaving.length ? 'Leave and accept' : 'Accept offer', tone: 'default' })) return
    setBusyId(row.id)
    const res = await acceptOffer(row.id, leaving.map(c => c.center_id))
    setBusyId(null)
    if (!res.success) { showAlert(res.error); load(); return }   // some centers may already have been left
    showAlert(`Welcome aboard! You are now part of ${row.job?.center?.name ?? 'the center'}. Check My Center for anything still needed before you start.`, { title: 'You’re hired', tone: 'default' })
    router.push('/staff/center')
  }

  async function decline(row: Row) {
    const note = await showPrompt('Let the center know why (optional).', '', { title: 'Decline offer' })
    if (note === null) return
    setBusyId(row.id)
    const res = await declineOffer(row.id, note)
    setBusyId(null)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  return (
    <div className="max-w-5xl pb-32">
      <div className="mb-10">
        <h1 className="text-4xl font-black text-heading mb-2 tracking-tight">Applications</h1>
        <p className="text-muted text-lg font-medium">Jobs you have applied for and where each one stands.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center">
          <ClipboardList className="mx-auto mb-3 h-10 w-10 text-subtle" />
          <p className="mb-4 font-bold text-muted">You haven’t applied for any jobs yet.</p>
          <Link href="/staff/jobs" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-800"><Briefcase className="h-5 w-5" /> Browse jobs</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map(row => {
            const open = requests[row.center_id] ?? 0
            const canWithdraw = ['applied', 'reviewing', 'interview'].includes(row.stage)
            return (
              <div key={row.id} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/staff/jobs/${row.job_id}`} className="text-lg font-bold text-heading hover:text-brand-600 hover:underline">{row.job?.title ?? 'Job'}</Link>
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${STAGE_STYLE[row.stage]}`}>{STAGE_LABELS[row.stage]}</span>
                    </div>
                    <div className="text-sm text-muted">{row.job?.center?.name} · Updated {new Date(row.updated_at).toLocaleDateString()}</div>
                    {open > 0 && OPEN_STAGES.includes(row.stage) && (
                      <Link href="/staff/requests" className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700 hover:underline">
                        <Inbox className="h-4 w-4" /> {open} document request{open === 1 ? '' : 's'} waiting
                      </Link>
                    )}
                  </div>
                  {canWithdraw && (
                    <button disabled={busyId === row.id} onClick={() => withdraw(row)} className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-muted hover:bg-surface disabled:opacity-50">Withdraw</button>
                  )}
                </div>

                {row.stage === 'interview' && row.interview_at && (
                  <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4 text-violet-900">
                    <p className="font-bold">Your interview</p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm"><CalendarClock className="h-4 w-4" /> {formatInterviewTime(row.interview_at)}</p>
                    <p className="mt-0.5 flex items-start gap-1.5 break-words text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                      {isLink(row.interview_location) ? <a href={row.interview_location!} target="_blank" rel="noopener noreferrer" className="underline">Join the video call</a> : row.interview_location}
                    </p>
                    {row.interview_note && <p className="mt-1 whitespace-pre-line text-sm">{row.interview_note}</p>}
                  </div>
                )}

                {row.stage === 'offer' && (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="font-bold text-emerald-900">You have an offer</p>
                    <p className="text-sm text-emerald-900">
                      Starts {row.offer_start_date ? new Date(`${row.offer_start_date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                      {row.offer_pay != null && row.job ? ` · ${formatPay({ pay_min: row.offer_pay, pay_max: row.offer_pay, pay_unit: row.job.pay_unit })}` : ''}
                    </p>
                    {row.offer_note && <p className="mt-1 whitespace-pre-line text-sm text-emerald-900">{row.offer_note}</p>}
                    {row.offer_letter_file_key && (
                      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-white px-3 py-2">
                        <FileText className="h-5 w-5 shrink-0 text-emerald-700" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-emerald-900">{row.offer_letter_file_name || 'Offer letter'}</p>
                          <p className="text-xs text-emerald-800">{row.offer_letter_viewed_at ? 'Opened. You can accept or decline below.' : 'Open and review your offer letter before accepting.'}</p>
                        </div>
                        <button onClick={() => openLetter(row)} className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-bold text-emerald-900 hover:bg-emerald-50">
                          {row.offer_letter_viewed_at ? 'Open again' : 'Open offer letter'}
                        </button>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button disabled={busyId === row.id || (!!row.offer_letter_file_key && !row.offer_letter_viewed_at)} onClick={() => accept(row)} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-5 py-2 text-sm font-black text-white hover:bg-brand-800 disabled:opacity-50">
                        {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Accept offer
                      </button>
                      <button disabled={busyId === row.id} onClick={() => decline(row)} className="rounded-xl border border-emerald-300 bg-white px-5 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50">Decline</button>
                    </div>
                  </div>
                )}

                {row.stage === 'hired' && row.offer_letter_file_key && (
                  <button onClick={() => openLetter(row)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
                    <FileText className="h-4 w-4" /> {row.offer_letter_file_name || 'Offer letter'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

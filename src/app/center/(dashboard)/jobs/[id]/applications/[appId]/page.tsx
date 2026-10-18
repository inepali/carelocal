'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Briefcase, CalendarClock, CheckCircle2, ExternalLink, FileText, Loader2, Mail, MapPin, Phone, Send, ShieldCheck, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { openStoredFile } from '@/lib/files'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'
import { StaffAvatar } from '@/components/StaffAvatar'
import type { CenterDocumentRequirement, CenterStaffDocumentStatus, StaffDocument, StaffReference } from '@/lib/types'
import {
  moveApplicationStage, refreshApplicationReadiness, requestApplicantDocument, scheduleInterview, sendOffer,
} from '@/app/actions/jobs.actions'
import {
  ITEM_STATE_STYLE, NEEDED_AT_LABELS, STAGE_LABELS, computeReadiness, formatInterviewTime, formatPay, isLink,
  type JobApplication, type JobPosting, type NeededAt,
} from '@/lib/jobs'

type Profile = { id: string; first_name: string; last_name: string; email: string; phone: string | null; city: string | null; state: string | null; avatar_url: string | null }
type Experience = { id: string; employer: string; role: string; start_year: number | null; end_year: number | null; is_current: boolean }
type Credential = { id: string; credential_name: string; issuing_body: string | null; expiry_date: string | null }
type Event = { id: string; from_stage: string | null; to_stage: string; note: string | null; created_at: string }

const LBL = 'block text-sm font-medium text-[#1a2e25] mb-1.5'
const FLD = 'w-full px-3.5 py-2.5 rounded-xl border border-[#e2e8e4] bg-white text-sm text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354]'

/** Center admin: one applicant — profile, required items with live readiness, actions and timeline. */
export default function ApplicationDetailPage() {
  const { id: jobId, appId } = useParams<{ id: string; appId: string }>()
  const [loading, setLoading] = useState(true)
  const [job, setJob] = useState<JobPosting | null>(null)
  const [app, setApp] = useState<JobApplication | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [items, setItems] = useState<{ requirement: CenterDocumentRequirement; neededAt: NeededAt }[]>([])
  const [records, setRecords] = useState<CenterStaffDocumentStatus[]>([])
  const [docs, setDocs] = useState<StaffDocument[]>([])
  const [experience, setExperience] = useState<Experience[]>([])
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [references, setReferences] = useState<StaffReference[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [busy, setBusy] = useState(false)
  const [offerOpen, setOfferOpen] = useState(false)
  const [offer, setOffer] = useState({ startDate: '', pay: '', note: '' })
  const [interviewOpen, setInterviewOpen] = useState(false)
  const [interview, setInterview] = useState({ date: '', time: '', location: '', note: '' })

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: appRow } = await supabase.from('job_applications').select('*').eq('id', appId).maybeSingle()
    if (!appRow) { setLoading(false); return }
    const a = appRow as JobApplication
    const [{ data: jobRow }, { data: reqRows }, { data: prof }, { data: recs }, { data: vault }, { data: exp }, { data: creds }, { data: refs }, { data: evts }] = await Promise.all([
      supabase.from('job_postings').select('*').eq('id', a.job_id).maybeSingle(),
      supabase.from('job_posting_requirements').select('needed_at, requirement:center_document_requirements(*)').eq('job_id', a.job_id),
      supabase.from('staff_profiles').select('id, first_name, last_name, email, phone, city, state, avatar_url').eq('id', a.staff_id).maybeSingle(),
      supabase.from('center_staff_document_status').select('*').eq('center_id', a.center_id).eq('staff_id', a.staff_id),
      supabase.from('staff_documents').select('*').eq('staff_id', a.staff_id),   // only documents shared with this center
      supabase.from('staff_experiences').select('id, employer, role, start_year, end_year, is_current').eq('staff_id', a.staff_id).order('start_year', { ascending: false }),
      supabase.from('staff_credentials').select('id, credential_name, issuing_body, expiry_date').eq('staff_id', a.staff_id),
      supabase.from('staff_references').select('*').eq('staff_id', a.staff_id),
      supabase.from('job_application_events').select('id, from_stage, to_stage, note, created_at').eq('application_id', appId).order('created_at', { ascending: true }),
    ])
    setApp(a)
    setJob(jobRow as JobPosting | null)
    setItems((reqRows ?? []).flatMap(r => {
      const requirement = (Array.isArray(r.requirement) ? r.requirement[0] : r.requirement) as CenterDocumentRequirement | null
      return requirement ? [{ requirement, neededAt: r.needed_at as NeededAt }] : []
    }))
    setProfile(prof as Profile | null)
    setRecords((recs ?? []) as CenterStaffDocumentStatus[])
    setDocs((vault ?? []) as StaffDocument[])
    setExperience((exp ?? []) as Experience[])
    setCredentials((creds ?? []) as Credential[])
    setReferences((refs ?? []) as StaffReference[])
    setEvents((evts ?? []) as Event[])
    setOffer(o => ({ ...o, startDate: o.startDate || (jobRow?.start_date ?? ''), pay: o.pay || (jobRow?.pay_min != null ? String(jobRow.pay_min) : '') }))
    setLoading(false)
  }, [appId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    refreshApplicationReadiness(appId)   // keep the board's cached badge in step with what is shown here
  }, [appId, load])

  const readiness = useMemo(() => computeReadiness({
    items, records, vaultDocs: docs, startDate: app?.offer_start_date ?? job?.start_date ?? null,
    picks: Object.fromEntries(items.map(i => [i.requirement.id, null])),   // admins only see what is on file
  }), [items, records, docs, app, job])
  const resume = docs.find(d => d.id === app?.resume_document_id) ?? null

  /** Opens the scheduling dialog, pre-filled when rescheduling */
  function openInterview() {
    if (app?.interview_at) {
      const d = new Date(app.interview_at)
      const pad = (n: number) => String(n).padStart(2, '0')
      setInterview({
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        location: app.interview_location ?? '',
        note: app.interview_note ?? '',
      })
    }
    setInterviewOpen(true)
  }

  async function submitInterview() {
    if (!interview.date || !interview.time) { showAlert('Choose the interview date and time.'); return }
    if (!interview.location.trim()) { showAlert('Add where the interview takes place: an address, phone number or video link.'); return }
    const at = new Date(`${interview.date}T${interview.time}`)   // the admin's local time
    if (Number.isNaN(at.getTime())) { showAlert('That date and time is not valid.'); return }
    if (at.getTime() < Date.now() && !await showConfirm('That time is in the past. Schedule it anyway?')) return
    setBusy(true)
    const res = await scheduleInterview(appId, { at: at.toISOString(), location: interview.location, note: interview.note })
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    setInterviewOpen(false)
    load()
  }

  async function move(stage: 'reviewing') {
    setBusy(true)
    const res = await moveApplicationStage(appId, stage)
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  async function reject() {
    const reason = await showPrompt('Reason for your records. It is never shown to the applicant; they only see “Not selected”.', '', { title: 'Not selected' })
    if (reason === null) return
    setBusy(true)
    const res = await moveApplicationStage(appId, 'rejected', undefined, reason)
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  async function submitOffer() {
    if (!offer.startDate) { showAlert('Choose a start date for the offer.'); return }
    if (!await showConfirm(`Send the offer to ${profile?.first_name ?? 'this applicant'}? They will be hired when they accept it.`, { title: 'Send offer', confirmLabel: 'Send offer' })) return
    setBusy(true)
    const res = await sendOffer(appId, { startDate: offer.startDate, pay: offer.pay ? Number(offer.pay) : null, note: offer.note })
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    setOfferOpen(false)
    if (res.requests > 0) showAlert(`Offer sent. ${res.requests} document request${res.requests === 1 ? ' was' : 's were'} raised for the items needed at the offer stage.`, { title: 'Offer sent' })
    load()
  }

  async function request(requirementId: string) {
    const res = await requestApplicantDocument(appId, requirementId)
    if (!res.success) { showAlert(res.error); return }
    showAlert('Requested. The applicant has been notified.', { title: 'Request sent' })
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-[#157354]" /></div>
  if (!app || !job) return <p className="text-[#6b7a73]">Application not found.</p>

  const canMove = ['applied', 'reviewing', 'interview'].includes(app.stage)

  return (
    <div className="max-w-6xl mx-auto">
      <Link href={`/center/jobs/${jobId}`} className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#6b7a73] hover:text-[#157354]"><ArrowLeft className="h-4 w-4" /> Back to {job.title}</Link>

      <div className="mb-8 flex flex-col gap-5 rounded-2xl border border-[#e2e8e4] bg-white p-6 shadow-sm md:flex-row md:items-center">
        <StaffAvatar avatarKey={profile?.avatar_url} firstName={profile?.first_name ?? ''} lastName={profile?.last_name ?? ''} className="h-16 w-16 rounded-2xl bg-[#edf7f3] text-xl font-black text-[#157354]" />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-extrabold text-[#0b3828]">{profile ? `${profile.first_name} ${profile.last_name}` : 'Applicant'}</h1>
            <span className="rounded-full border border-[#d4ede4] bg-[#edf7f3] px-2.5 py-1 text-xs font-bold text-[#157354]">{STAGE_LABELS[app.stage]}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-4 text-sm text-[#6b7a73]">
            {profile?.email && <a href={`mailto:${profile.email}`} className="flex items-center gap-1.5 hover:text-[#157354]"><Mail className="h-4 w-4" />{profile.email}</a>}
            {profile?.phone && <a href={`tel:${profile.phone}`} className="flex items-center gap-1.5 hover:text-[#157354]"><Phone className="h-4 w-4" />{profile.phone}</a>}
            <span>Applied {new Date(app.applied_at).toLocaleDateString()}</span>
          </div>
        </div>
        <Link href={`/center/team_member/${app.staff_id}`} className="inline-flex items-center gap-1.5 rounded-xl border border-[#e2e8e4] px-4 py-2 text-sm font-bold text-[#157354] hover:bg-[#edf7f3]">
          <ShieldCheck className="h-4 w-4" /> Review documents
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-[#e2e8e4] bg-white shadow-sm">
            <div className="border-b border-[#e2e8e4] px-6 py-4">
              <h2 className="text-lg font-bold text-[#1a2e25]">Required items</h2>
              <p className="text-xs text-[#6b7a73]">Checked against {app.offer_start_date || job.start_date ? 'the start date' : 'today (ASAP start)'}. Accept or reject documents from Review documents.</p>
            </div>
            <div className="divide-y divide-[#e2e8e4]">
              <div className="flex flex-wrap items-center gap-3 px-6 py-3">
                <div className="flex-1 min-w-[180px] text-sm font-medium text-[#1a2e25]">Resume</div>
                {resume ? (
                  <button onClick={() => openStoredFile('vault', resume.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#157354] hover:underline"><FileText className="h-3.5 w-3.5" /> {resume.document_name}</button>
                ) : <span className={`rounded-full border px-2 py-0.5 text-[11px] ${ITEM_STATE_STYLE.missing.className}`}>Missing</span>}
              </div>
              {readiness.map(item => {
                const st = ITEM_STATE_STYLE[item.state]
                const showRequest = canMove || app.stage === 'offer'
                return (
                  <div key={item.requirement.id} className="flex flex-wrap items-center gap-3 px-6 py-3">
                    <div className="flex-1 min-w-[180px]">
                      <div className="text-sm font-medium text-[#1a2e25]">{item.requirement.document_name}</div>
                      <div className="text-[11px] text-[#a8b5ae]">{NEEDED_AT_LABELS[item.neededAt]}</div>
                    </div>
                    {item.document && (
                      <button onClick={() => openStoredFile('vault', item.document!.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#157354] hover:underline">
                        <ExternalLink className="h-3.5 w-3.5" /> {item.document.document_name}
                      </button>
                    )}
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${item.state === 'later' ? ITEM_STATE_STYLE.later.className : st.className}`}>
                      {item.state === 'later' ? NEEDED_AT_LABELS[item.neededAt] : st.label}
                    </span>
                    {showRequest && (item.state === 'missing' || item.state === 'expiring') && (
                      <button onClick={() => request(item.requirement.id)} className="inline-flex items-center gap-1 rounded-lg border border-[#e2e8e4] px-2.5 py-1 text-xs font-bold text-[#157354] hover:bg-[#edf7f3]">
                        <Send className="h-3 w-3" /> Request
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {app.cover_note && (
            <section className="rounded-2xl border border-[#e2e8e4] bg-white p-6 shadow-sm">
              <h2 className="mb-2 text-lg font-bold text-[#1a2e25]">Cover note</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-[#3d5a4f]">{app.cover_note}</p>
            </section>
          )}

          <section className="rounded-2xl border border-[#e2e8e4] bg-white p-6 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-[#1a2e25]"><Briefcase className="h-5 w-5 text-[#157354]" /> Experience</h2>
            {experience.length === 0 ? <p className="text-sm text-[#6b7a73]">None added.</p> : (
              <ul className="space-y-2 text-sm">
                {experience.map(e => (
                  <li key={e.id}><span className="font-semibold text-[#1a2e25]">{e.role}</span> · {e.employer}
                    <span className="text-xs text-[#a8b5ae]"> {e.start_year ?? ''}{e.start_year ? '–' : ''}{e.is_current ? 'present' : e.end_year ?? ''}</span></li>
                ))}
              </ul>
            )}
            {credentials.length > 0 && (
              <>
                <h3 className="mb-2 mt-5 text-sm font-bold text-[#1a2e25]">Credentials</h3>
                <ul className="space-y-1 text-sm text-[#3d5a4f]">
                  {credentials.map(c => <li key={c.id}>{c.credential_name}{c.issuing_body ? ` · ${c.issuing_body}` : ''}{c.expiry_date ? ` · expires ${new Date(`${c.expiry_date}T00:00:00`).toLocaleDateString()}` : ''}</li>)}
                </ul>
              </>
            )}
          </section>

          <section className="rounded-2xl border border-[#e2e8e4] bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-bold text-[#1a2e25]">References</h2>
            {references.length === 0 ? <p className="text-sm text-[#6b7a73]">None added.</p> : (
              <ul className="space-y-3 text-sm">
                {references.map(r => (
                  <li key={r.id}>
                    <div className="font-semibold text-[#1a2e25]">{r.full_name} <span className="font-normal text-[#6b7a73]">· {r.title}, {r.business}</span></div>
                    <div className="text-xs text-[#6b7a73]"><a href={`mailto:${r.email}`} className="hover:text-[#157354]">{r.email}</a> · <a href={`tel:${r.phone}`} className="hover:text-[#157354]">{r.phone}</a></div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-[#e2e8e4] bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[#6b7a73]">Actions</h2>
            {app.stage === 'offer' ? (
              <div className="space-y-1 text-sm text-[#3d5a4f]">
                <p className="font-semibold text-[#1a2e25]">Offer sent — waiting for the applicant</p>
                <p>Start {app.offer_start_date ? new Date(`${app.offer_start_date}T00:00:00`).toLocaleDateString() : '—'}{app.offer_pay != null ? ` · ${formatPay({ pay_min: app.offer_pay, pay_max: app.offer_pay, pay_unit: job.pay_unit })}` : ''}</p>
              </div>
            ) : canMove ? (
              <div className="flex flex-col gap-2">
                {app.stage === 'applied' && <button disabled={busy} onClick={() => move('reviewing')} className="rounded-xl border border-[#e2e8e4] px-4 py-2.5 text-sm font-bold text-[#157354] hover:bg-[#edf7f3] disabled:opacity-50">Move to Reviewing</button>}
                {app.stage === 'interview' && app.interview_at && (
                  <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
                    <div className="flex items-center gap-1.5 font-semibold"><CalendarClock className="h-4 w-4" /> {formatInterviewTime(app.interview_at)}</div>
                    <div className="mt-0.5 flex items-start gap-1.5 break-words"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{isLink(app.interview_location) ? <a href={app.interview_location!} target="_blank" rel="noopener noreferrer" className="underline">{app.interview_location}</a> : app.interview_location}</div>
                    {app.interview_note && <div className="mt-1 text-xs">{app.interview_note}</div>}
                  </div>
                )}
                <button disabled={busy} onClick={openInterview} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#e2e8e4] px-4 py-2.5 text-sm font-bold text-[#157354] hover:bg-[#edf7f3] disabled:opacity-50"><CalendarClock className="h-4 w-4" /> {app.stage === 'interview' ? 'Reschedule interview' : 'Move to Interview'}</button>
                <button disabled={busy} onClick={() => setOfferOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#157354] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0f4a36] disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Send offer</button>
                <button disabled={busy} onClick={reject} className="rounded-xl border border-red-100 px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">Not selected</button>
              </div>
            ) : (
              <p className="text-sm text-[#6b7a73]">{STAGE_LABELS[app.stage]}{app.decided_at ? ` on ${new Date(app.decided_at).toLocaleDateString()}` : ''}.</p>
            )}
          </section>

          <section className="rounded-2xl border border-[#e2e8e4] bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[#6b7a73]">Timeline</h2>
            <ol className="space-y-3">
              {events.map(e => (
                <li key={e.id} className="text-sm">
                  <div className="font-semibold text-[#1a2e25]">{STAGE_LABELS[e.to_stage as keyof typeof STAGE_LABELS] ?? e.to_stage}</div>
                  <div className="text-xs text-[#a8b5ae]">{new Date(e.created_at).toLocaleString()}</div>
                  {e.note && <div className="mt-0.5 text-xs text-[#6b7a73]">{e.note}</div>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      {interviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b3828]/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="interview-title">
          <div className="w-full max-w-md rounded-3xl border border-[#e2e8e4] bg-white p-7 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 id="interview-title" className="text-xl font-black text-[#0b3828]">{app.stage === 'interview' ? 'Reschedule interview' : 'Schedule interview'}</h2>
              <button onClick={() => setInterviewOpen(false)} className="rounded-lg p-1.5 text-[#6b7a73] hover:bg-[#f8faf9]" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LBL}>Date *</label>
                  <input type="date" value={interview.date} onChange={e => setInterview({ ...interview, date: e.target.value })} className={FLD} />
                </div>
                <div>
                  <label className={LBL}>Time *</label>
                  <input type="time" value={interview.time} onChange={e => setInterview({ ...interview, time: e.target.value })} className={FLD} />
                </div>
              </div>
              <div>
                <label className={LBL}>Location *</label>
                <input value={interview.location} onChange={e => setInterview({ ...interview, location: e.target.value })} className={FLD} placeholder="Center address, a phone number, or a video link" />
              </div>
              <div>
                <label className={LBL}>Details for the applicant</label>
                <textarea rows={3} value={interview.note} onChange={e => setInterview({ ...interview, note: e.target.value })} className={`${FLD} resize-none`} placeholder="Who to ask for, what to bring, how long it takes…" />
              </div>
              <p className="text-xs text-[#6b7a73]">The applicant gets the date, time and location right away. Times are in your time zone.</p>
              <div className="flex gap-3">
                <button onClick={() => setInterviewOpen(false)} className="flex-1 rounded-xl border-2 border-[#f0f4f2] bg-[#f8faf9] px-4 py-3 font-bold text-[#6b7a73]">Cancel</button>
                <button disabled={busy} onClick={submitInterview} className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-[#157354] px-4 py-3 font-black text-white hover:bg-[#0f4a36] disabled:opacity-60">
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : app.stage === 'interview' ? 'Save new time' : 'Schedule & move to Interview'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {offerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b3828]/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="offer-title">
          <div className="w-full max-w-md rounded-3xl border border-[#e2e8e4] bg-white p-7 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 id="offer-title" className="text-xl font-black text-[#0b3828]">Send offer</h2>
              <button onClick={() => setOfferOpen(false)} className="rounded-lg p-1.5 text-[#6b7a73] hover:bg-[#f8faf9]" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className={LBL}>Start date *</label>
                <input type="date" value={offer.startDate} onChange={e => setOffer({ ...offer, startDate: e.target.value })} className={FLD} />
              </div>
              <div>
                <label className={LBL}>Pay ($ per {job.pay_unit})</label>
                <input type="number" min={0} step="0.01" value={offer.pay} onChange={e => setOffer({ ...offer, pay: e.target.value })} className={FLD} />
              </div>
              <div>
                <label className={LBL}>Note to the applicant</label>
                <textarea rows={3} value={offer.note} onChange={e => setOffer({ ...offer, note: e.target.value })} className={`${FLD} resize-none`} placeholder="Schedule details, who to report to on day one…" />
              </div>
              <p className="text-xs text-[#6b7a73]">Every “To apply” item must be accepted or in review. Items needed at the offer become document requests.</p>
              <div className="flex gap-3">
                <button onClick={() => setOfferOpen(false)} className="flex-1 rounded-xl border-2 border-[#f0f4f2] bg-[#f8faf9] px-4 py-3 font-bold text-[#6b7a73]">Cancel</button>
                <button disabled={busy} onClick={submitOffer} className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-[#157354] px-4 py-3 font-black text-white hover:bg-[#0f4a36] disabled:opacity-60">
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send offer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

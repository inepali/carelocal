'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, Clock, AlertTriangle, XCircle, Loader2, Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { storeUpload, DOCUMENT_ACCEPT, type UploadSource } from '@/lib/files'
import { showAlert } from '@/lib/dialog'
import { PhoneUploadButton } from '@/components/center/PhoneUploadDialog'
import { applyToJob } from '@/app/actions/jobs.actions'
import type { CenterDocumentRequirement, CenterStaffDocumentStatus, StaffDocument } from '@/lib/types'
import {
  ITEM_STATE_STYLE, NEEDED_AT_LABELS, computeReadiness, findResume, readinessDate,
  type ItemState, type JobPosting, type NeededAt,
} from '@/lib/jobs'

const STATE_ICON: Record<ItemState, React.ElementType> = {
  ready: CheckCircle2, in_review: Clock, expiring: AlertTriangle, missing: XCircle, later: Clock,
}

/**
 * Staff apply sheet: each required item with its state, the vault document used for it (pre-selected,
 * changeable), an inline upload, an optional note and Submit. One tap when everything is ready.
 */
export function ApplySheet({
  job, staffId, items, records, vaultDocs, onClose, onApplied,
}: {
  job: JobPosting
  staffId: string
  items: { requirement: CenterDocumentRequirement; neededAt: NeededAt }[]
  records: CenterStaffDocumentStatus[]
  vaultDocs: StaffDocument[]
  onClose: () => void
  onApplied: () => void
}) {
  const [docs, setDocs] = useState(vaultDocs)
  const [picks, setPicks] = useState<Record<string, string | null>>({})
  const [resumeId, setResumeId] = useState<string | null>(() => findResume(vaultDocs)?.id ?? null)
  const [note, setNote] = useState('')
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const readiness = useMemo(() => computeReadiness({ items, records, vaultDocs: docs, startDate: job.start_date, picks }), [items, records, docs, job.start_date, picks])
  const applyItems = readiness.filter(r => r.neededAt === 'apply')
  const laterItems = readiness.filter(r => r.neededAt !== 'apply')
  const resumes = docs.filter(d => d.document_category === 'resume')
  const blocked = !resumeId || applyItems.some(r => r.state === 'missing')
  const startLabel = job.start_date ? readinessDate(job.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'today'

  /** Saves an upload to the vault, then selects it for the item (or as the resume). */
  async function addDocument(source: UploadSource, target: { requirement?: CenterDocumentRequirement; resume?: boolean }): Promise<string | void> {
    const key = target.resume ? 'resume' : target.requirement!.id
    setUploadingFor(key)
    try {
      const stored = await storeUpload('vault', source)
      const { data, error } = await createClient().from('staff_documents').insert({
        staff_id: staffId,
        document_name: target.resume ? 'Resume' : target.requirement!.document_name,
        document_category: target.resume ? 'resume' : target.requirement!.document_category,
        file_url: 'r2_private_access',
        file_key: stored.fileKey,
        bucket_name: stored.bucketName,
        file_name: stored.name,
      }).select('*').single()
      if (error || !data) throw error ?? new Error('Could not save the document')
      setDocs(prev => [data as StaffDocument, ...prev])
      if (target.resume) setResumeId(data.id)
      else setPicks(prev => ({ ...prev, [key]: data.id }))
    } catch (err) {
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Upload failed'
      if (!(source instanceof File)) return message
      showAlert(message)
    } finally {
      setUploadingFor(null)
    }
  }

  function pickFile(target: { requirement?: CenterDocumentRequirement; resume?: boolean }) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = DOCUMENT_ACCEPT
    input.onchange = () => { const f = input.files?.[0]; if (f) addDocument(f, target) }
    input.click()
  }

  async function submit() {
    setSubmitting(true)
    const res = await applyToJob({
      jobId: job.id,
      coverNote: note,
      resumeDocumentId: resumeId,
      items: readiness.filter(r => !r.onFile && r.document).map(r => ({ requirement_id: r.requirement.id, document_id: r.document!.id })),
    })
    setSubmitting(false)
    if (!res.success) { showAlert(res.error); return }
    onApplied()
  }

  const uploadButtons = (target: { requirement?: CenterDocumentRequirement; resume?: boolean }, label: string) => {
    const key = target.resume ? 'resume' : target.requirement!.id
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={uploadingFor !== null} onClick={() => pickFile(target)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-bold text-brand-600 hover:bg-brand-50 disabled:opacity-50">
          {uploadingFor === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
        </button>
        <PhoneUploadButton kind="vault" label={label} text="Phone" disabled={uploadingFor !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-bold text-brand-600 hover:bg-brand-50 disabled:opacity-50"
          onReceived={upload => addDocument(upload, target)} />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="apply-title">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-border bg-white p-6 shadow-2xl sm:rounded-3xl">
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 id="apply-title" className="text-xl font-black text-heading">Apply: {job.title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-5 text-sm text-muted">Documents are checked against the start date ({startLabel}). Your profile, experience and references are included automatically.</p>

        <div className="divide-y divide-border rounded-2xl border border-border">
          {/* Resume: always first, always required */}
          <div className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              {resumeId ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-red-600" />}
              <span className="flex-1 text-sm font-bold text-text-main">Resume</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${resumeId ? ITEM_STATE_STYLE.ready.className : ITEM_STATE_STYLE.missing.className}`}>{resumeId ? 'Ready' : 'Missing'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-7">
              {resumes.length > 0 && (
                <select value={resumeId ?? ''} onChange={e => setResumeId(e.target.value || null)} className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs">
                  {resumes.map(d => <option key={d.id} value={d.id}>{d.document_name} · {new Date(d.uploaded_at).toLocaleDateString()}</option>)}
                </select>
              )}
              {uploadButtons({ resume: true }, 'Resume')}
            </div>
          </div>

          {applyItems.map(item => {
            const Icon = STATE_ICON[item.state]
            const style = ITEM_STATE_STYLE[item.state]
            return (
              <div key={item.requirement.id} className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <Icon className={`h-5 w-5 ${item.state === 'ready' ? 'text-emerald-600' : item.state === 'missing' ? 'text-red-600' : item.state === 'expiring' ? 'text-amber-600' : 'text-slate-400'}`} />
                  <span className="flex-1 text-sm font-bold text-text-main">{item.requirement.document_name}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${style.className}`}>{style.label}</span>
                </div>
                {item.onFile ? (
                  <p className="pl-7 text-xs text-muted">Already on file at this center{item.document ? `: ${item.document.document_name}` : ''}.</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 pl-7">
                    {docs.length > 0 && (
                      <select value={item.document?.id ?? ''} onChange={e => setPicks(prev => ({ ...prev, [item.requirement.id]: e.target.value || null }))}
                        className="max-w-[260px] rounded-lg border border-border bg-white px-2 py-1.5 text-xs">
                        <option value="">Choose from my documents…</option>
                        {docs.map(d => <option key={d.id} value={d.id}>{d.document_name}{d.expiry_date ? ` · exp. ${new Date(`${d.expiry_date}T00:00:00`).toLocaleDateString()}` : ''}</option>)}
                      </select>
                    )}
                    {uploadButtons({ requirement: item.requirement }, item.requirement.document_name)}
                    {item.state === 'expiring' && <span className="text-xs text-amber-700">Expires before the start date. Upload a newer one if you have it.</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {laterItems.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-bold text-text-main">After you’re hired</h3>
            <ul className="space-y-1 text-sm text-muted">
              {laterItems.map(i => <li key={i.requirement.id}>• {i.requirement.document_name} <span className="text-xs text-subtle">({NEEDED_AT_LABELS[i.neededAt].toLowerCase()})</span></li>)}
            </ul>
          </div>
        )}

        <div className="mt-5">
          <label className="mb-1.5 block text-sm font-medium text-text-main">Note to the center (optional)</label>
          <textarea rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)}
            className="w-full resize-none rounded-xl border border-border px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
            placeholder="Why you are a good fit, availability, anything else…" />
        </div>

        <div className="mt-5 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl border-2 border-border bg-surface px-4 py-3 font-bold text-muted">Cancel</button>
          <button disabled={blocked || submitting || uploadingFor !== null} onClick={submit}
            className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 font-black text-white hover:bg-brand-800 disabled:opacity-50">
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Submit application'}
          </button>
        </div>
        {blocked && <p className="mt-2 text-center text-xs text-red-600">Add your resume and every item marked Missing to apply.</p>}
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Baby, FileText, Loader2, Pencil, Search, Trash2, Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { canOpenChildFiles, useCenterContext } from '../../../context'
import { deleteChildFile, registerChildFile } from '@/app/actions/child-files.actions'
import { PhoneUploadButton } from '@/components/center/PhoneUploadDialog'
import { openChildFile, uploadChildFile } from '@/lib/child-files'
import type { PhoneUpload } from '@/lib/files'
import { formatDate } from '@/lib/compliance'
import { showAlert, showConfirm } from '@/lib/dialog'
import { BTN, BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD } from '../../_components/ui'

type IncidentForm = { id: string; file_name: string; created_at: string; incident_note: string | null }

const NOTE_MAX = 500
type ChildName = { id: string; first_name: string; last_name: string }

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*'

/** A child's incident forms on their own page: upload a scan or photo of each form, open it later, or remove it. */
export default function ChildIncidentsPage() {
  const { id } = useParams<{ id: string }>()
  const ctx = useCenterContext()
  const allowed = canOpenChildFiles(ctx)
  const [child, setChild] = useState<ChildName | null>(null)
  const [forms, setForms] = useState<IncidentForm[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: childRow }, { data: files, error }] = await Promise.all([
      supabase.from('children').select('id, first_name, last_name').eq('id', id).maybeSingle(),
      supabase.from('child_files').select('id, file_name, created_at, incident_note').eq('child_id', id).eq('category', 'incident').order('created_at', { ascending: false }),
    ])
    if (error) showAlert('Could not load the incident forms: ' + error.message)
    setChild(childRow as ChildName | null)
    setForms((files ?? []) as IncidentForm[])
    setLoading(false)
  }, [id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (allowed) load(); else setLoading(false) }, [allowed, load])

  async function upload(file: File) {
    setBusy(true)
    try {
      await uploadChildFile(id, file, null, 'incident')
      await load()
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'The upload failed. Please try again.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  /** A photo sent from the phone is already in storage: just record it */
  async function recordFromPhone(phoneUpload: PhoneUpload) {
    const res = await registerChildFile(id, { fileKey: phoneUpload.fileKey, fileName: phoneUpload.name, contentType: phoneUpload.type, category: 'incident' })
    if (!res.success) return res.error
    await load()
  }

  function startNote(form: IncidentForm) {
    setEditingId(form.id)
    setDraft(form.incident_note ?? '')
  }

  async function saveNote(form: IncidentForm) {
    setSavingNote(true)
    const note = draft.trim()
    const { error } = await createClient().from('child_files').update({ incident_note: note || null }).eq('id', form.id)
    setSavingNote(false)
    if (error) { showAlert('Could not save the details: ' + error.message); return }
    setForms(prev => prev.map(f => f.id === form.id ? { ...f, incident_note: note || null } : f))
    setEditingId(null)
  }

  async function remove(form: IncidentForm) {
    if (!await showConfirm(`Delete the incident form "${form.file_name}"? This cannot be undone.`, { title: 'Delete incident form', tone: 'danger', confirmLabel: 'Delete' })) return
    setBusy(true)
    const res = await deleteChildFile(form.id)
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  const query = search.trim().toLowerCase()
  const shown = query ? forms.filter(f => `${f.file_name} ${f.incident_note ?? ''}`.toLowerCase().includes(query)) : forms

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>

  if (!allowed || !child) {
    return (
      <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center shadow-sm">
        <Baby className="mx-auto mb-3 h-10 w-10 text-brand-200" />
        <p className="text-muted">{allowed ? 'Child not found, or you do not have access to it.' : 'Only the owner and administrators of a child care center with Child Files turned on can open child records.'}</p>
        <Link href="/center/children" className="mt-4 inline-block text-sm font-semibold text-brand-600 hover:underline">Back to Children</Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl pb-20">
      <Link href="/center/children" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> Back to Children</Link>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="mb-1 text-3xl font-extrabold text-heading">Incidents</h1>
          <p className="text-muted">
            {child.first_name} {child.last_name} · <Link href={`/center/children/${child.id}`} className="font-semibold text-brand-600 hover:underline">Files</Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PhoneUploadButton
            kind="child_incident"
            childId={child.id}
            label="Incident form"
            text="Phone"
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-600 px-4 py-2.5 text-sm font-bold text-brand-600 hover:bg-brand-50 disabled:opacity-50"
            onReceived={recordFromPhone}
          />
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload
          </button>
          <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) upload(file) }} />
        </div>
      </div>

      <p className="mb-4 text-sm text-muted">Upload each completed incident form as a PDF or a photo (up to 15 MB), then add a short description so it is easy to find later. Only the owner and administrators can see them.</p>

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <h2 className="text-lg font-bold text-text-main">Incident forms</h2>
          <span className="text-sm text-muted">{query ? `${shown.length} of ${forms.length}` : `${forms.length} on file`}</span>
        </div>
        {forms.length > 0 && (
          <div className="relative border-b border-border px-6 py-3">
            <Search className="absolute left-9 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search file names and descriptions" className={`${FLD} pl-10`} />
          </div>
        )}
        {forms.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted">No incident forms for this child yet.</p>
        ) : shown.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted">No incident forms match “{search.trim()}”.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map(form => (
              <li key={form.id} className="px-6 py-3.5">
                <div className="flex items-center justify-between gap-4">
                  <button type="button" onClick={() => openChildFile(form.id)} className="flex min-w-0 items-center gap-2.5 text-left text-sm font-semibold text-text-main hover:text-brand-600">
                    <FileText className="h-4 w-4 shrink-0 text-brand-600" />
                    <span className="truncate">{form.file_name}</span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted">{formatDate(form.created_at.slice(0, 10))}</span>
                    {editingId !== form.id && (
                      <button type="button" onClick={() => startNote(form)} className={BTN_QUIET_SM}>
                        <Pencil className="h-3.5 w-3.5" /> {form.incident_note ? 'Edit' : 'Add details'}
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => remove(form)} aria-label="Delete incident form" className="rounded-lg p-1.5 text-subtle hover:bg-red-50 hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {editingId === form.id ? (
                  <div className="mt-3">
                    <textarea
                      autoFocus
                      rows={3}
                      maxLength={NOTE_MAX}
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      placeholder="What happened, in a sentence or two (for example: fell on the playground, ice applied, parent called)"
                      className={`${FLD} resize-none`}
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-xs text-subtle">{draft.length} / {NOTE_MAX}</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setEditingId(null)} className={BTN_QUIET}>Cancel</button>
                        <button type="button" disabled={savingNote} onClick={() => saveNote(form)} className={BTN}>
                          {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save details
                        </button>
                      </div>
                    </div>
                  </div>
                ) : form.incident_note ? (
                  <p className="mt-2 whitespace-pre-line pl-[26px] text-sm text-text-muted">{form.incident_note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

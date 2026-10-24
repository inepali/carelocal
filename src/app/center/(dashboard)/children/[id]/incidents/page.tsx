'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Baby, FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { canOpenChildFiles, useCenterContext } from '../../../context'
import { deleteChildFile, registerChildFile } from '@/app/actions/child-files.actions'
import { PhoneUploadButton } from '@/components/center/PhoneUploadDialog'
import { openChildFile, uploadChildFile } from '@/lib/child-files'
import type { PhoneUpload } from '@/lib/files'
import { formatDate } from '@/lib/compliance'
import { showAlert, showConfirm } from '@/lib/dialog'
import { BTN_PRIMARY } from '../../_components/ui'

type IncidentForm = { id: string; file_name: string; created_at: string }
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
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: childRow }, { data: files, error }] = await Promise.all([
      supabase.from('children').select('id, first_name, last_name').eq('id', id).maybeSingle(),
      supabase.from('child_files').select('id, file_name, created_at').eq('child_id', id).eq('category', 'incident').order('created_at', { ascending: false }),
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

  async function remove(form: IncidentForm) {
    if (!await showConfirm(`Delete the incident form "${form.file_name}"? This cannot be undone.`, { title: 'Delete incident form', tone: 'danger', confirmLabel: 'Delete' })) return
    setBusy(true)
    const res = await deleteChildFile(form.id)
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

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
            {child.first_name} {child.last_name} · <Link href={`/center/children/${child.id}`} className="font-semibold text-brand-600 hover:underline">Open file</Link>
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

      <p className="mb-4 text-sm text-muted">Upload each completed incident form as a PDF or a photo (up to 15 MB). Only the owner and administrators can see them.</p>

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <h2 className="text-lg font-bold text-text-main">Incident forms</h2>
          <span className="text-sm text-muted">{forms.length} on file</span>
        </div>
        {forms.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted">No incident forms for this child yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {forms.map(form => (
              <li key={form.id} className="flex items-center justify-between gap-4 px-6 py-3.5">
                <button type="button" onClick={() => openChildFile(form.id)} className="flex min-w-0 items-center gap-2.5 text-left text-sm font-semibold text-text-main hover:text-brand-600">
                  <FileText className="h-4 w-4 shrink-0 text-brand-600" />
                  <span className="truncate">{form.file_name}</span>
                </button>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted">{formatDate(form.created_at.slice(0, 10))}</span>
                  <button type="button" disabled={busy} onClick={() => remove(form)} aria-label="Delete incident form" className="rounded-lg p-1.5 text-subtle hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, ChevronRight, Inbox, Loader2, Lock, PenLine, Send, Upload, X } from 'lucide-react'
import type { DocumentRequest, StaffDocument } from '@/lib/types'
import { submitDocumentRequest } from '@/app/actions/document-requests.actions'
import { storeUpload, DOCUMENT_ACCEPT, type UploadSource } from '@/lib/files'
import { PhoneUploadButton } from '@/components/center/PhoneUploadDialog'
import { formatDate } from '@/lib/compliance'
import { showAlert } from '@/lib/dialog'

type Row = DocumentRequest & {
  center: { name: string; slug: string } | null
  requirement: { evidence_type: string; document_category: string } | null
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

/**
 * A staff member's document requests from their centers. They answer from their
 * document library (or upload a new file into it); only that document is shared.
 */
export function RequestInbox({ variant = 'page', onCountChange }: { variant?: 'page' | 'mobile'; onCountChange?: (open: number) => void }) {
  const mobile = variant === 'mobile'
  const [staffId, setStaffId] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [docs, setDocs] = useState<StaffDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [answering, setAnswering] = useState<Row | null>(null)
  const [note, setNote] = useState('')
  const [file, setFile] = useState<UploadSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
    if (!profile) { setLoading(false); return }
    setStaffId(profile.id)

    const [{ data: requests }, { data: library }] = await Promise.all([
      supabase.from('document_requests')
        .select('*, center:centers(name, slug), requirement:center_document_requirements(evidence_type, document_category)')
        .eq('staff_id', profile.id)
        .order('created_at', { ascending: false }),
      supabase.from('staff_documents').select('*').eq('staff_id', profile.id).order('uploaded_at', { ascending: false }),
    ])
    const mapped = (requests || []).map(r => ({ ...r, center: one(r.center), requirement: one(r.requirement) })) as Row[]
    setRows(mapped)
    setDocs(library || [])
    onCountChange?.(mapped.filter(r => r.status === 'open').length)
    setLoading(false)
  }, [onCountChange])

  useEffect(() => { load() }, [load])

  function startAnswer(row: Row) {
    setAnswering(row)
    setNote('')
    setFile(null)
  }

  async function send(documentId: string) {
    if (!answering) return
    setBusy(true)
    const res = await submitDocumentRequest(answering.id, documentId, note)
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    setAnswering(null)
    load()
  }

  async function uploadAndSend() {
    if (!answering || !file || !staffId) return
    setBusy(true)
    try {
      const { fileKey, bucketName, name: storedName } = await storeUpload('vault', file)
      const { data: doc, error } = await createClient().from('staff_documents').insert({
        staff_id: staffId,
        document_name: answering.title,
        document_category: answering.requirement?.document_category || 'other',
        file_url: 'r2_private_access',
        file_key: fileKey,
        bucket_name: bucketName,
        file_name: storedName,
      }).select('id').single()
      if (error || !doc) throw error ?? new Error('Failed to save the document')
      setBusy(false)
      await send(doc.id)
    } catch (err) {
      setBusy(false)
      showAlert(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  const active = rows.filter(r => r.status === 'open' || r.status === 'submitted')
  const history = rows.filter(r => r.status === 'completed' || r.status === 'cancelled')
  const today = new Date().toISOString().slice(0, 10)

  if (loading) {
    return mobile ? null : <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-[#157354]" /></div>
  }
  if (mobile && active.length === 0) return null

  return (
    <div className={mobile ? 'space-y-3' : 'space-y-6'}>
      {mobile && (
        <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[#0b3828]">
          <Inbox className="h-4 w-4 text-[#157354]" /> Requests from your center
        </h3>
      )}

      {active.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#a9dac9] bg-[#edf7f3] p-10 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-[#157354]" />
          <p className="font-bold text-[#0b3828]">You&apos;re all caught up</p>
          <p className="text-sm text-[#3d5a4f]">When a center asks you for a document, it will appear here.</p>
        </div>
      ) : (
        <div className={mobile ? 'space-y-3' : 'grid gap-4'}>
          {active.map(row => {
            const isAck = row.requirement?.evidence_type === 'acknowledgement'
            const overdue = row.status === 'open' && row.due_date && row.due_date < today
            return (
              <div key={row.id} className={`rounded-2xl border bg-white shadow-sm ${mobile ? 'p-4' : 'p-5'} ${overdue ? 'border-red-200' : 'border-[#e2e8e4]'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className={`flex items-center gap-1.5 font-bold text-[#1a2e25] ${mobile ? 'text-xs' : ''}`}>
                      {row.title} {row.is_confidential && <Lock className="h-3.5 w-3.5 text-amber-600" />}
                    </div>
                    <div className={`text-[#6b7a73] ${mobile ? 'text-[10px]' : 'text-sm'}`}>
                      {row.center?.name} · requested {formatDate(row.created_at)}
                      {row.due_date && <span className={overdue ? 'text-red-600 font-semibold' : ''}> · due {formatDate(row.due_date)}</span>}
                    </div>
                    {row.message && <p className={`mt-1.5 text-[#3d5a4f] ${mobile ? 'text-[11px]' : 'text-sm'}`}>{row.message}</p>}
                    {row.center_note && row.status === 'open' && (
                      <p className={`mt-1.5 text-red-600 ${mobile ? 'text-[11px]' : 'text-sm'}`}>Center note: {row.center_note}</p>
                    )}
                  </div>
                  {row.status === 'submitted' ? (
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs text-sky-700">Sent · awaiting review</span>
                  ) : isAck ? (
                    <Link href={mobile ? `/mobile/documents?center=${row.center?.slug ?? ''}` : '/staff/centers'}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#157354] px-4 py-2 text-xs font-bold text-white hover:bg-[#0f4a36]">
                      <PenLine className="h-3.5 w-3.5" /> Sign in checklist
                    </Link>
                  ) : (
                    <button onClick={() => startAnswer(row)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#157354] px-4 py-2 text-xs font-bold text-white hover:bg-[#0f4a36]">
                      <Send className="h-3.5 w-3.5" /> Send document
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!mobile && history.length > 0 && (
        <div>
          <button onClick={() => setShowHistory(v => !v)} className="text-sm font-semibold text-[#157354] hover:underline">
            {showHistory ? 'Hide' : 'Show'} past requests ({history.length})
          </button>
          {showHistory && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-[#e2e8e4] bg-white">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#e2e8e4] text-[15px] font-bold text-[#1a2e25]">
                    <th className="px-5 py-3">Document</th>
                    <th className="px-4 py-3">Center</th>
                    <th className="px-4 py-3">Requested</th>
                    <th className="px-5 py-3">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e2e8e4] text-sm text-[#3d5a4f]">
                  {history.map(r => (
                    <tr key={r.id}>
                      <td className="px-5 py-3 text-[#1a2e25]">{r.title}</td>
                      <td className="px-4 py-3">{r.center?.name}</td>
                      <td className="px-4 py-3">{formatDate(r.created_at)}</td>
                      <td className="px-5 py-3">{r.status === 'completed' ? `Accepted ${formatDate(r.resolved_at)}` : 'Cancelled'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Answer dialog */}
      {answering && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b3828]/50 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-[#e2e8e4] bg-[#f8faf9] px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-[#1a2e25]">Send: {answering.title}</h3>
                <p className="text-xs text-[#6b7a73]">Only the document you choose is shared with {answering.center?.name ?? 'the center'}.</p>
              </div>
              <button onClick={() => setAnswering(null)} className="rounded-lg p-1.5 text-[#6b7a73] hover:bg-[#e2e8e4]"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto p-6 space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium text-[#1a2e25]">From your library</p>
                <div className="max-h-56 overflow-y-auto space-y-2">
                  {docs.length === 0 && <p className="text-sm text-[#6b7a73]">Your library is empty — upload the file below.</p>}
                  {[...docs]
                    .sort((a, b) => Number(b.document_category === answering.requirement?.document_category) - Number(a.document_category === answering.requirement?.document_category))
                    .map(doc => (
                      <button key={doc.id} disabled={busy} onClick={() => send(doc.id)}
                        className="flex w-full items-center justify-between rounded-xl border-2 border-[#f0f4f2] p-3 text-left hover:border-[#157354] disabled:opacity-50">
                        <span>
                          <span className="block text-sm font-bold text-[#0b3828]">{doc.document_name}</span>
                          <span className="block text-xs text-[#6b7a73]">Uploaded {formatDate(doc.uploaded_at)}{doc.expiry_date ? ` · expires ${formatDate(doc.expiry_date)}` : ''}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-[#a8b5ae]" />
                      </button>
                    ))}
                </div>
              </div>

              <div className="border-t border-[#e2e8e4] pt-4">
                <p className="mb-2 text-sm font-medium text-[#1a2e25]">Or upload a new file</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input type="file" accept={DOCUMENT_ACCEPT} onChange={e => setFile(e.target.files?.[0] ?? null)}
                    className="flex-1 text-sm text-[#6b7a73] file:mr-3 file:rounded-lg file:border-0 file:bg-[#edf7f3] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[#157354]" />
                  <button disabled={busy || !file} onClick={uploadAndSend}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#157354] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f4a36] disabled:opacity-50">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload & send
                  </button>
                </div>
                {!mobile && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <PhoneUploadButton kind="vault" label={answering.title} onReceived={upload => { setFile(upload) }} />
                    {file && !(file instanceof File) && <span className="text-xs font-semibold text-[#157354]">Photo received: {file.name}</span>}
                  </div>
                )}
                <p className="mt-1 text-[11px] text-[#a8b5ae]">It is also saved to your document library.</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-[#1a2e25]">Note to the center (optional)</label>
                <input value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-xl border border-[#e2e8e4] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#157354]/30" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

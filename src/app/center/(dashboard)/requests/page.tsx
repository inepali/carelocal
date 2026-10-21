'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Inbox, Loader2, Lock, Plus, ExternalLink } from 'lucide-react'
import type { DocumentRequest, DocumentRequestStatus } from '@/lib/types'
import { resolveDocumentRequest } from '@/app/actions/document-requests.actions'
import { RequestDocumentsDialog } from '@/components/center/RequestDocumentsDialog'
import { openStoredFile } from '@/lib/files'
import { formatDate } from '@/lib/compliance'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'
import { snapshotAcceptedDocuments } from '@/app/actions/document-snapshots.actions'

type Row = DocumentRequest & { staff: { id: string; first_name: string; last_name: string } | null }

const TABS: { id: DocumentRequestStatus; label: string }[] = [
  { id: 'submitted', label: 'Needs review' },
  { id: 'open', label: 'Waiting on staff' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
]

export default function DocumentRequestsPage() {
  const supabase = createClient()
  const [centerId, setCenterId] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<DocumentRequestStatus>('submitted')
  const [showDialog, setShowDialog] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: admin } = await supabase.from('center_admins').select('center_id').eq('user_id', user.id).limit(1).maybeSingle()
    if (!admin) { setLoading(false); return }
    setCenterId(admin.center_id)
    const { data } = await supabase
      .from('document_requests')
      .select('*, staff:staff_profiles(id, first_name, last_name)')
      .eq('center_id', admin.center_id)
      .order('created_at', { ascending: false })
    setRows((data || []).map(r => ({ ...r, staff: Array.isArray(r.staff) ? r.staff[0] : r.staff })) as Row[])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  async function act(row: Row, action: 'accept' | 'reject' | 'cancel') {
    let note: string | undefined
    if (action === 'reject') {
      note = (await showPrompt('What should the employee send instead?', '', { title: 'Reject document' })) ?? undefined
      if (!note?.trim()) return
    }
    if (action === 'cancel' && !await showConfirm(`Cancel the request for "${row.title}"?`)) return
    setBusyId(row.id)
    const res = await resolveDocumentRequest(row.id, action, note)
    setBusyId(null)
    if (!res.success) { showAlert(res.error); return }
    if (action === 'accept') {
      const copy = await snapshotAcceptedDocuments(row.center_id, row.staff_id)
      if (!copy.success || copy.failed > 0) showAlert('The document was accepted, but the center copy could not be saved. It will be retried the next time you open the employee record.')
    }
    load()
  }

  const counts = Object.fromEntries(TABS.map(t => [t.id, rows.filter(r => r.status === t.id).length])) as Record<DocumentRequestStatus, number>
  const visible = rows.filter(r => r.status === tab)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-heading mb-1">Document Requests</h1>
          <p className="text-muted">Ask staff for documents and review what they send. Staff answer from their own document library.</p>
        </div>
        <button onClick={() => setShowDialog(true)} disabled={!centerId}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
          <Plus className="h-5 w-5" /> New request
        </button>
      </div>

      {notice && <div className="mb-6 rounded-xl border border-[#bbf7d0] bg-brand-50 px-4 py-3 text-sm text-[#16a34a]">{notice}</div>}

      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${tab === t.id ? 'bg-brand-600 text-white' : 'bg-white text-muted border border-border hover:bg-brand-50'}`}>
            {t.label}{counts[t.id] > 0 && <span className="ml-1.5 opacity-80">({counts[t.id]})</span>}
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center text-muted">
            <Inbox className="mx-auto mb-3 h-10 w-10 text-brand-100" />
            Nothing here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-border text-[15px] font-bold text-text-main">
                  <th scope="col" className="px-6 py-4">Employee</th>
                  <th scope="col" className="px-4 py-4">Document</th>
                  <th scope="col" className="px-4 py-4">Requested</th>
                  <th scope="col" className="px-4 py-4">Due</th>
                  <th scope="col" className="px-4 py-4">{tab === 'submitted' ? 'Sent' : 'Notes'}</th>
                  <th scope="col" className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm font-normal text-text-muted">
                {visible.map(row => {
                  const overdue = row.status === 'open' && row.due_date && row.due_date < today
                  return (
                    <tr key={row.id} className="align-top hover:bg-surface">
                      <td className="px-6 py-4">
                        {row.staff ? (
                          <Link href={`/center/team_member/${row.staff.id}`} className="text-text-main hover:text-brand-600 hover:underline">
                            {row.staff.first_name} {row.staff.last_name}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1.5 text-text-main">
                          {row.title} {row.is_confidential && <Lock className="h-3.5 w-3.5 text-amber-600" />}
                        </div>
                        <div className="text-xs text-subtle">{row.requirement_id ? 'Checklist item' : 'Other document'}</div>
                        {row.message && <div className="mt-0.5 max-w-xs text-xs text-muted line-clamp-2">{row.message}</div>}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">{formatDate(row.created_at)}</td>
                      <td className={`px-4 py-4 whitespace-nowrap ${overdue ? 'text-red-600' : ''}`}>{formatDate(row.due_date)}</td>
                      <td className="px-4 py-4 text-xs">
                        {tab === 'submitted' ? (
                          <>
                            <div>{formatDate(row.submitted_at)}</div>
                            {row.staff_note && <div className="text-muted">“{row.staff_note}”</div>}
                          </>
                        ) : (row.center_note || row.staff_note || '—')}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {row.submitted_document_id && (
                            <button onClick={() => openStoredFile('vault', row.submitted_document_id!)} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800">
                              <ExternalLink className="h-3.5 w-3.5" /> View
                            </button>
                          )}
                          {row.status === 'submitted' && (row.requirement_id ? (
                            <Link href={`/center/team_member/${row.staff_id}`} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800">
                              Review in record
                            </Link>
                          ) : (
                            <>
                              <button disabled={busyId === row.id} onClick={() => act(row, 'reject')} className="rounded-lg border border-red-100 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">Reject</button>
                              <button disabled={busyId === row.id} onClick={() => act(row, 'accept')} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800">Accept</button>
                            </>
                          ))}
                          {(row.status === 'open' || row.status === 'submitted') && (
                            <button disabled={busyId === row.id} onClick={() => act(row, 'cancel')} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted hover:bg-surface">Cancel</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showDialog && centerId && (
        <RequestDocumentsDialog
          centerId={centerId}
          onClose={() => setShowDialog(false)}
          onCreated={count => {
            setShowDialog(false)
            setNotice(count > 0 ? `Sent ${count} request${count === 1 ? '' : 's'}. Staff were notified.` : 'Everyone selected already has an open request for this item.')
            setTab('open')
            load()
          }}
        />
      )}
    </div>
  )
}

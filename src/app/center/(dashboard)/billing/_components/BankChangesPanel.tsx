'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, FileText, Landmark, Loader2, Printer, X } from 'lucide-react'
import { approveBankChange, bankChangeFormPdf, declineBankChange, listBankChanges } from '@/app/actions/billing-bank-change.actions'
import { openChildFile, uploadChildFile } from '@/lib/child-files'
import { showAlert } from '@/lib/dialog'
import { formatDate } from '@/lib/compliance'
import { bankChangeLabel, type BankChangeRequest } from '@/lib/parent-billing'
import { BTN, BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD, LBL, Modal, Pill, todayISO } from '../../children/_components/ui'

/**
 * Billing page → Bank change requests (owners and admins). A parent asked online for a new bank account or to stop
 * ACH: print the pre-filled form, have them sign it, then approve with the signed form uploaded (it goes into the
 * child's file), or decline with a reason. The change starts tomorrow; drafts already queued keep the old account.
 */

const PILL: Record<BankChangeRequest['status'], string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-900',
  approved: 'border-brand-100 bg-brand-50 text-brand-700',
  declined: 'border-red-200 bg-red-50 text-red-800',
  canceled: 'border-border bg-surface text-muted',
}
const STATUS: Record<BankChangeRequest['status'], string> = { pending: 'Waiting', approved: 'Approved', declined: 'Declined', canceled: 'Canceled by parent' }

async function printForm(id: string) {
  const tab = window.open('', '_blank')
  const res = await bankChangeFormPdf(id)
  if (!res.success) { tab?.close(); await showAlert(res.error, { tone: 'error' }); return }
  const bytes = Uint8Array.from(atob(res.base64), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  if (tab) tab.location.href = url
  else { const a = document.createElement('a'); a.href = url; a.download = res.filename; a.click() }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export default function BankChangesPanel({ centerId }: { centerId: string }) {
  const [rows, setRows] = useState<BankChangeRequest[] | null>(null)
  const [showOld, setShowOld] = useState(false)
  const [acting, setActing] = useState<{ row: BankChangeRequest; mode: 'approve' | 'decline' } | null>(null)

  const load = useCallback(async () => {
    const res = await listBankChanges(centerId)
    // Not set up on this database yet, or Tuition off: show nothing
    setRows(res.success ? res.requests : null)
  }, [centerId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  if (!rows || rows.length === 0) return null
  const open = rows.filter(r => r.status === 'pending')
  const shown = showOld ? rows : open

  return (
    <section className="mb-6 rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-heading">
          <Landmark className="h-5 w-5 text-brand-600" /> Bank change requests
          {open.length > 0 && <Pill className="border-amber-200 bg-amber-50 font-bold text-amber-900">{open.length} waiting</Pill>}
        </h2>
        {rows.length > open.length && (
          <button type="button" onClick={() => setShowOld(v => !v)} className="text-xs font-bold text-brand-600">{showOld ? 'Hide past requests' : 'Show past requests'}</button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">No requests waiting.</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map(r => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0 text-sm">
                <p className="font-bold text-text-main">{r.requester_name} · {bankChangeLabel(r)}</p>
                <p className="text-xs text-muted">
                  For {r.lines.map(l => `${l.child} (now ${l.method === 'ach' ? `ACH ••${l.last4 ?? '----'}` : l.method.replace('_', ' ')})`).join(', ')}
                  {r.kind === 'new_account' && r.routing_number ? ` · routing ${r.routing_number} · ${r.holder_name}` : ''}
                </p>
                <p className="text-xs text-muted">
                  Sent {formatDate(r.created_at.slice(0, 10))}
                  {r.decided_at ? ` · ${STATUS[r.status].toLowerCase()} ${formatDate(r.decided_at.slice(0, 10))}${r.decided_by ? ` by ${r.decided_by}` : ''}` : ''}
                  {r.status === 'approved' && r.effective_from ? ` · from ${formatDate(r.effective_from)}` : ''}
                  {r.decision_note ? ` · “${r.decision_note}”` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {r.status !== 'pending' && <Pill className={PILL[r.status]}>{STATUS[r.status]}</Pill>}
                {r.authorization_file_id && r.lines[0] && (
                  <button type="button" className={BTN_QUIET_SM} onClick={() => openChildFile(r.authorization_file_id!)}><FileText className="h-3.5 w-3.5" /> Signed form</button>
                )}
                {r.status === 'pending' && (
                  <>
                    <button type="button" className={BTN_QUIET_SM} onClick={() => printForm(r.id)}><Printer className="h-3.5 w-3.5" /> Print form</button>
                    <button type="button" className={BTN} onClick={() => setActing({ row: r, mode: 'approve' })}><Check className="h-3.5 w-3.5" /> Approve</button>
                    <button type="button" className={BTN_QUIET_SM} onClick={() => setActing({ row: r, mode: 'decline' })}><X className="h-3.5 w-3.5" /> Decline</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {acting && <DecideModal row={acting.row} mode={acting.mode} onClose={() => setActing(null)} onDone={() => { setActing(null); load() }} />}
    </section>
  )
}

function DecideModal({ row, mode, onClose, onDone }: { row: BankChangeRequest; mode: 'approve' | 'decline'; onClose: () => void; onDone: () => void }) {
  const needsForm = mode === 'approve' && row.kind === 'new_account'
  const children = [...new Map(row.lines.map(l => [l.child_id, l.child])).entries()]
  const [childId, setChildId] = useState(children[0]?.[0] ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [signedOn, setSignedOn] = useState(todayISO())
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setError(null)
    if (needsForm && !file) return setError('Upload the signed authorization form.')
    if (mode === 'decline' && !reason.trim()) return setError('Give the parent a reason.')
    setBusy(true)
    try {
      if (mode === 'decline') {
        const res = await declineBankChange(row.id, reason)
        if (!res.success) return setError(res.error)
      } else {
        const fileId = needsForm && file ? await uploadChildFile(childId, file) : null
        const res = await approveBankChange(row.id, fileId, needsForm ? signedOn : null)
        if (!res.success) return setError(res.error)
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={mode === 'approve' ? 'Approve bank change' : 'Decline bank change'} onClose={onClose}
      footer={<>
        <button type="button" className={BTN_QUIET} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={BTN_PRIMARY} onClick={go} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {mode === 'approve' ? 'Approve' : 'Decline and tell the parent'}
        </button>
      </>}>
      <div className="space-y-4 text-sm">
        <p><b>{row.requester_name}</b>: {bankChangeLabel(row)}, for {children.map(c => c[1]).join(', ')}.</p>
        {mode === 'approve' ? (
          <>
            {needsForm && (
              <>
                <div>
                  <label className={LBL} htmlFor="bc-file">Signed authorization form (PDF or photo)</label>
                  <input id="bc-file" type="file" accept="application/pdf,image/*" className={FLD} onChange={e => setFile(e.target.files?.[0] ?? null)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {children.length > 1 && (
                    <div>
                      <label className={LBL} htmlFor="bc-child">Save in the file of</label>
                      <select id="bc-child" className={FLD} value={childId} onChange={e => setChildId(e.target.value)}>
                        {children.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className={LBL} htmlFor="bc-signed">Date signed</label>
                    <input id="bc-signed" type="date" className={FLD} value={signedOn} max={todayISO()} onChange={e => setSignedOn(e.target.value)} />
                  </div>
                </div>
              </>
            )}
            <p className="text-muted">
              {row.kind === 'new_account'
                ? 'From tomorrow, new ACH drafts come from the new account. Drafts already queued keep the old one. The parent gets an email.'
                : 'From tomorrow, this parent pays at the center (check, cash or card). Drafts already queued still go out. The parent gets an email.'}
            </p>
          </>
        ) : (
          <div>
            <label className={LBL} htmlFor="bc-reason">Reason (the parent sees this)</label>
            <textarea id="bc-reason" className={FLD} rows={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="For example: the routing number belongs to a different bank. Please send a new request." />
          </div>
        )}
        {error && <p role="alert" className="font-medium text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}

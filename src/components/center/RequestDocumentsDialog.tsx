'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Lock, Send, X } from 'lucide-react'
import { createDocumentRequests } from '@/app/actions/document-requests.actions'
import { appliesToEmploymentClass, EMPLOYMENT_CLASS_LABELS, type CenterDocumentRequirement, type EmploymentClass } from '@/lib/types'
import { computeCompliance, type ComplianceState } from '@/lib/compliance'

interface Employee {
  staffId: string
  name: string
  employmentClass: EmploymentClass
  startDate: string | null
}

type StatusRow = {
  staff_id: string
  requirement_id: string
  status: string
  completed_on: string | null
  reviewed_at: string | null
  expires_on: string | null
  not_applicable: boolean
  acknowledged_version: number | null
  matched_document: { expiry_date: string | null } | { expiry_date: string | null }[] | null
}

const NEEDS: ComplianceState[] = ['missing', 'overdue', 'due_soon', 'rejected']
const FLD = 'w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600'
const LBL = 'block text-sm font-medium text-text-main mb-1.5'

function inTwoWeeks() {
  const d = new Date()
  d.setDate(d.getDate() + 14)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Request a checklist item or any other document from one or many employees.
 * "Needs this item" selects everyone for whom the chosen item is missing, rejected,
 * overdue or due soon.
 */
export function RequestDocumentsDialog({
  centerId, onClose, onCreated, initialStaffIds = [], initialRequirementId = '',
}: {
  centerId: string
  onClose: () => void
  onCreated: (count: number) => void
  initialStaffIds?: string[]
  initialRequirementId?: string
}) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [requirements, setRequirements] = useState<CenterDocumentRequirement[]>([])
  const [statuses, setStatuses] = useState<StatusRow[]>([])
  const [loading, setLoading] = useState(true)

  const [requirementId, setRequirementId] = useState(initialRequirementId)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [dueDate, setDueDate] = useState(inTwoWeeks())
  const [selected, setSelected] = useState<string[]>(initialStaffIds)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('center_staff')
        .select('staff_id, employment_class, employment_start_date, status, staff_profiles(first_name, last_name)')
        .eq('center_id', centerId).eq('status', 'active'),
      supabase.from('center_document_requirements').select('*').eq('center_id', centerId)
        .neq('evidence_type', 'center_record').order('section').order('sort_order'),
      supabase.from('center_staff_document_status')
        .select('staff_id, requirement_id, status, completed_on, reviewed_at, expires_on, not_applicable, acknowledged_version, matched_document:staff_documents(expiry_date)')
        .eq('center_id', centerId),
    ]).then(([staffRes, reqRes, statusRes]) => {
      setEmployees((staffRes.data || []).map(row => {
        const p = (Array.isArray(row.staff_profiles) ? row.staff_profiles[0] : row.staff_profiles) as { first_name?: string; last_name?: string } | null
        return {
          staffId: row.staff_id,
          name: `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || 'Employee',
          employmentClass: row.employment_class,
          startDate: row.employment_start_date,
        }
      }).sort((a, b) => a.name.localeCompare(b.name)))
      setRequirements(reqRes.data || [])
      setStatuses((statusRes.data || []) as StatusRow[])
      setLoading(false)
    })
  }, [centerId])

  const requirement = requirements.find(r => r.id === requirementId) ?? null

  // Employees for whom the chosen checklist item still needs something
  const needing = useMemo(() => {
    if (!requirement) return new Set<string>()
    return new Set(employees.filter(e => {
      if (!appliesToEmploymentClass(requirement, e.employmentClass)) return false
      const record = statuses.find(s => s.staff_id === e.staffId && s.requirement_id === requirement.id)
      const doc = Array.isArray(record?.matched_document) ? record?.matched_document[0] : record?.matched_document
      // Partial rows are enough for the calculation
      const state = computeCompliance(requirement, record as never, e.startDate, doc?.expiry_date).state
      return NEEDS.includes(state)
    }).map(e => e.staffId))
  }, [requirement, employees, statuses])

  const eligible = requirement ? employees.filter(e => appliesToEmploymentClass(requirement, e.employmentClass)) : employees

  function pick(ids: string[]) {
    setSelected(ids)
  }

  async function handleSend() {
    setError('')
    if (!requirement && !title.trim()) { setError('Choose a checklist item or describe the document.'); return }
    if (selected.length === 0) { setError('Choose at least one employee.'); return }
    setSending(true)
    const res = await createDocumentRequests({
      staffIds: selected,
      requirementId: requirement?.id ?? null,
      title: requirement ? undefined : title.trim(),
      message,
      dueDate: dueDate || null,
    })
    setSending(false)
    if (!res.success) { setError(res.error); return }
    onCreated(res.count ?? 0)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-900/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <h2 className="text-lg font-bold text-text-main">Request documents</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-border" title="Close"><X className="h-5 w-5" /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div>
        ) : (
          <div className="overflow-y-auto p-6 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={LBL}>What do you need?</label>
                <select value={requirementId} onChange={e => { setRequirementId(e.target.value); setSelected(initialStaffIds) }} className={FLD}>
                  <option value="">Other document (describe it)</option>
                  {requirements.map(r => (
                    <option key={r.id} value={r.id}>{r.is_confidential ? '🔒 ' : ''}{r.document_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LBL}>Due date</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={FLD} />
              </div>
            </div>

            {!requirement && (
              <div>
                <label className={LBL}>Document</label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Updated driver's license" className={FLD} />
              </div>
            )}
            {requirement?.is_confidential && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700"><Lock className="h-3.5 w-3.5" /> Confidential: only the Owner and Admins can open what staff send.</p>
            )}

            <div>
              <label className={LBL}>Message (optional)</label>
              <textarea rows={2} value={message} onChange={e => setMessage(e.target.value)} className={`${FLD} resize-none`} placeholder="Anything the employee should know" />
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-text-main mr-1">Send to</span>
                <button type="button" onClick={() => pick(eligible.map(e => e.staffId))} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-text-muted hover:bg-surface">Everyone</button>
                {(['regular', 'substitute'] as EmploymentClass[]).map(c => (
                  <button key={c} type="button" onClick={() => pick(eligible.filter(e => e.employmentClass === c).map(e => e.staffId))} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-text-muted hover:bg-surface">
                    {EMPLOYMENT_CLASS_LABELS[c]}
                  </button>
                ))}
                {requirement && (
                  <button type="button" onClick={() => pick([...needing])} className="rounded-lg border border-brand-600 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-600">
                    Needs this item ({needing.size})
                  </button>
                )}
                <button type="button" onClick={() => pick([])} className="text-xs text-muted hover:underline">Clear</button>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                {eligible.length === 0 && <p className="p-4 text-sm text-muted">No active employees this applies to.</p>}
                {eligible.map(e => (
                  <label key={e.staffId} className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface">
                    <span className="flex items-center gap-3">
                      <input type="checkbox" checked={selected.includes(e.staffId)}
                        onChange={() => setSelected(s => s.includes(e.staffId) ? s.filter(x => x !== e.staffId) : [...s, e.staffId])}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                      <span className="text-text-main">{e.name}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      {needing.has(e.staffId) && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">Needs it</span>}
                      {EMPLOYMENT_CLASS_LABELS[e.employmentClass]}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-subtle">Employees who already have an open request for this item are skipped.</p>
            </div>

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button onClick={onClose} className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted hover:bg-surface">Cancel</button>
          <button onClick={handleSend} disabled={sending || loading || selected.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send {selected.length > 0 ? `${selected.length} request${selected.length === 1 ? '' : 's'}` : 'requests'}
          </button>
        </div>
      </div>
    </div>
  )
}

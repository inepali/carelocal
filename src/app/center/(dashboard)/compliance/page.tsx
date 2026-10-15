'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Lock, Send, ShieldCheck } from 'lucide-react'
import { EMPLOYMENT_CLASS_LABELS, type EmploymentClass, type RequirementSection } from '@/lib/types'
import { SECTIONS, COMPLIANCE_STATE_STYLE, formatDate, type ComplianceState } from '@/lib/compliance'
import { loadCenterCompliance, countStates, type CenterCompliance } from '@/lib/compliance-data'
import { RequestDocumentsDialog } from '@/components/center/RequestDocumentsDialog'

const CELL: Record<ComplianceState, string> = {
  current: 'bg-emerald-500',
  due_soon: 'bg-amber-400',
  overdue: 'bg-red-500',
  pending_review: 'bg-sky-500',
  rejected: 'bg-white ring-2 ring-inset ring-red-500',
  missing: 'bg-slate-200',
  not_applicable: 'bg-white ring-1 ring-inset ring-slate-300',
}

const ATTENTION: ComplianceState[] = ['overdue', 'due_soon', 'pending_review', 'rejected']
const LEGEND: ComplianceState[] = ['current', 'due_soon', 'overdue', 'pending_review', 'rejected', 'missing', 'not_applicable']

export default function CompliancePage() {
  const supabase = createClient()
  const [centerId, setCenterId] = useState<string | null>(null)
  const [data, setData] = useState<CenterCompliance | null>(null)
  const [loading, setLoading] = useState(true)
  const [classFilter, setClassFilter] = useState<'all' | EmploymentClass>('all')
  const [sectionFilter, setSectionFilter] = useState<'all' | RequirementSection>('all')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [requestFor, setRequestFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: admin } = await supabase.from('center_admins').select('center_id').eq('user_id', user.id).limit(1).maybeSingle()
    if (!admin) { setLoading(false); return }
    setCenterId(admin.center_id)
    setData(await loadCenterCompliance(supabase, admin.center_id))
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  const columns = useMemo(() => (data?.requirements ?? [])
    .filter(r => sectionFilter === 'all' || r.section === sectionFilter)
    .sort((a, b) => SECTIONS.findIndex(s => s.id === a.section) - SECTIONS.findIndex(s => s.id === b.section) || a.sort_order - b.sort_order),
  [data, sectionFilter])

  const rows = useMemo(() => (data?.employees ?? [])
    .filter(e => classFilter === 'all' || e.employmentClass === classFilter)
    .filter(e => !attentionOnly || columns.some(c => e.items[c.id] && ATTENTION.includes(e.items[c.id].state))),
  [data, classFilter, attentionOnly, columns])

  const counts = data ? countStates(data) : null

  return (
    <div className="max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Compliance Overview</h1>
          <p className="text-[#6b7a73]">Every employee&apos;s file at a glance. Select a square to open their record.</p>
        </div>
        {counts && (
          <div className="flex flex-wrap gap-2">
            {(['overdue', 'due_soon', 'pending_review', 'rejected'] as ComplianceState[]).map(s => (
              <span key={s} className={`rounded-full border px-3 py-1 text-xs font-semibold ${COMPLIANCE_STATE_STYLE[s].className}`}>
                {COMPLIANCE_STATE_STYLE[s].label}: {counts[s]}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={classFilter} onChange={e => setClassFilter(e.target.value as 'all' | EmploymentClass)} className="rounded-xl border border-[#e2e8e4] bg-white px-3 py-2 text-sm">
          <option value="all">All employees</option>
          {(Object.entries(EMPLOYMENT_CLASS_LABELS) as [EmploymentClass, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={sectionFilter} onChange={e => setSectionFilter(e.target.value as 'all' | RequirementSection)} className="rounded-xl border border-[#e2e8e4] bg-white px-3 py-2 text-sm">
          <option value="all">All sections</option>
          {SECTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-[#1a2e25]">
          <input type="checkbox" checked={attentionOnly} onChange={e => setAttentionOnly(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-[#157354] focus:ring-[#157354]" />
          Needs attention only
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-[#6b7a73]">
          {LEGEND.map(s => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded-sm ${CELL[s]}`} /> {s === 'missing' ? 'Not done yet' : COMPLIANCE_STATE_STYLE[s].label}
            </span>
          ))}
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#e2e8e4] bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-[#157354]" /></div>
        ) : !data || columns.length === 0 ? (
          <div className="py-16 text-center text-[#6b7a73]">
            <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-[#d4ede4]" />
            No requirements yet. Add them in <Link href="/center/documents" className="text-[#157354] hover:underline">Documents</Link>.
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-[#6b7a73]">No employees match these filters.</div>
        ) : (
          <div className="overflow-auto max-h-[75vh]">
            <table className="border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 border-b border-r border-[#e2e8e4] bg-[#f8faf9] px-5 py-3 text-[15px] font-bold text-[#1a2e25] min-w-[220px]">Employee</th>
                  {columns.map((req, i) => {
                    const newSection = req.section !== columns[i - 1]?.section
                    return (
                      <th key={req.id} className={`sticky top-0 z-20 border-b border-[#e2e8e4] bg-[#f8faf9] px-1 pb-2 pt-3 align-bottom ${newSection && i > 0 ? 'border-l-2 border-l-[#d4ede4]' : ''}`}>
                        <div className="flex h-44 flex-col items-center justify-end gap-1.5">
                          <span className="max-h-36 overflow-hidden text-xs font-semibold text-[#1a2e25] [writing-mode:vertical-rl] rotate-180" title={req.document_name}>
                            {req.is_confidential && <Lock className="mb-1 inline h-3 w-3 text-amber-600" />} {req.document_name}
                          </span>
                          {req.evidence_type !== 'center_record' && (
                            <button onClick={() => setRequestFor(req.id)} className="rounded p-0.5 text-[#157354] hover:bg-[#edf7f3]" title={`Request "${req.document_name}"`}>
                              <Send className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(emp => {
                  const applicable = columns.filter(c => emp.items[c.id] && emp.items[c.id].state !== 'not_applicable')
                  const done = applicable.filter(c => {
                    const item = emp.items[c.id]
                    return item.record?.status === 'accepted' && (item.state === 'current' || item.state === 'due_soon')
                  }).length
                  return (
                    <tr key={emp.staffId} className="hover:bg-[#fbfcfb]">
                      <td className="sticky left-0 z-10 border-b border-r border-[#e2e8e4] bg-white px-5 py-2.5">
                        <Link href={`/center/team_member/${emp.staffId}`} className="font-medium text-[#1a2e25] hover:text-[#157354] hover:underline">{emp.name}</Link>
                        <div className="text-xs text-[#6b7a73]">{EMPLOYMENT_CLASS_LABELS[emp.employmentClass]} · {done}/{applicable.length} complete</div>
                      </td>
                      {columns.map((req, i) => {
                        const item = emp.items[req.id]
                        const newSection = req.section !== columns[i - 1]?.section
                        return (
                          <td key={req.id} className={`border-b border-[#e2e8e4] px-1 py-2.5 text-center ${newSection && i > 0 ? 'border-l-2 border-l-[#d4ede4]' : ''}`}>
                            {item ? (
                              <Link
                                href={`/center/team_member/${emp.staffId}`}
                                title={`${req.document_name}: ${item.state === 'missing' ? 'Not done yet' : COMPLIANCE_STATE_STYLE[item.state].label}${item.dueDate ? ` · ${item.record?.status === 'accepted' ? 'renews' : 'due'} ${formatDate(item.dueDate)}` : ''}`}
                                className={`mx-auto block h-5 w-5 rounded ${CELL[item.state]}`}
                              />
                            ) : (
                              <span className="text-[#e2e8e4]" title="Does not apply">·</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {requestFor && centerId && (
        <RequestDocumentsDialog
          centerId={centerId}
          initialRequirementId={requestFor}
          onClose={() => setRequestFor(null)}
          onCreated={count => {
            setRequestFor(null)
            alert(count > 0 ? `Sent ${count} request${count === 1 ? '' : 's'}.` : 'Everyone selected already has an open request for this item.')
          }}
        />
      )}
    </div>
  )
}

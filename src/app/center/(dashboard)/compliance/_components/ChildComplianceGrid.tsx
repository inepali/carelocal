'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Baby, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { loadChildrenOverview, type ChildRequirement, type Classroom } from '@/lib/children'
import { childRows } from '@/lib/child-compliance'
import { CHILD_SECTIONS } from '@/lib/child-template'
import { COMPLIANCE_STATE_STYLE, formatDate, type ComplianceState } from '@/lib/compliance'
import type { Child, ChildDocumentStatus } from '@/lib/child-types'
import { ATTENTION, CELL } from './cells'

const sectionIndex = (id: string) => {
  const i = CHILD_SECTIONS.findIndex(s => s.id === id)
  return i === -1 ? CHILD_SECTIONS.length : i
}

/** Every enrolled child's record at a glance, in the same grid as the staff files. Owner and admins only. */
export function ChildComplianceGrid({ centerId }: { centerId: string }) {
  const [loading, setLoading] = useState(true)
  const [children, setChildren] = useState<Child[]>([])
  const [requirements, setRequirements] = useState<ChildRequirement[]>([])
  const [records, setRecords] = useState<ChildDocumentStatus[]>([])
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [error, setError] = useState<string | null>(null)
  const [classroom, setClassroom] = useState('')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [attentionOnly, setAttentionOnly] = useState(false)

  const load = useCallback(async () => {
    const res = await loadChildrenOverview(createClient(), centerId)
    if (res.success) {
      setChildren(res.children.filter(c => c.status === 'enrolled'))
      setRequirements(res.requirements); setRecords(res.records); setClassrooms(res.classrooms)
    } else {
      setError(res.error)
    }
    setLoading(false)
  }, [centerId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const columns = useMemo(() => requirements
    .filter(r => sectionFilter === 'all' || r.section === sectionFilter)
    .sort((a, b) => sectionIndex(a.section) - sectionIndex(b.section) || (a.sort_order ?? 0) - (b.sort_order ?? 0)),
  [requirements, sectionFilter])

  const allRows = useMemo(() => children.map(child => ({
    child,
    items: new Map(childRows(child, requirements, records).map(r => [r.requirement.id, r])),
  })), [children, requirements, records])

  const rows = useMemo(() => allRows
    .filter(r => !classroom || r.child.classroom_id === classroom)
    .filter(r => !attentionOnly || columns.some(c => ATTENTION.includes(r.items.get(c.id)?.result.state as ComplianceState))),
  [allRows, classroom, attentionOnly, columns])

  const counts = useMemo(() => {
    const totals: Partial<Record<ComplianceState, number>> = {}
    for (const r of allRows) for (const item of r.items.values()) totals[item.result.state] = (totals[item.result.state] ?? 0) + 1
    return totals
  }, [allRows])

  const sections = CHILD_SECTIONS.filter(s => requirements.some(r => r.section === s.id))
  const roomName = (id: string | null) => classrooms.find(c => c.id === id)?.name

  return (
    <div className="mt-12">
      <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="mb-1 text-2xl font-extrabold text-heading">Children</h2>
          <p className="text-muted">Every enrolled child&apos;s record against the NC child care rules. Select a square to open their file.</p>
        </div>
        {!loading && allRows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {ATTENTION.map(s => (
              <span key={s} className={`rounded-full border px-3 py-1 text-xs font-semibold ${COMPLIANCE_STATE_STYLE[s].className}`}>
                {COMPLIANCE_STATE_STYLE[s].label}: {counts[s] ?? 0}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={classroom} onChange={e => setClassroom(e.target.value)} className="rounded-xl border border-border bg-white px-3 py-2 text-sm">
          <option value="">All classrooms</option>
          {classrooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sectionFilter} onChange={e => setSectionFilter(e.target.value)} className="rounded-xl border border-border bg-white px-3 py-2 text-sm">
          <option value="all">All sections</option>
          {sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-text-main">
          <input type="checkbox" checked={attentionOnly} onChange={e => setAttentionOnly(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
          Needs attention only
        </label>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div>
        ) : error ? (
          <div className="py-16 text-center text-muted">{error}</div>
        ) : columns.length === 0 && sectionFilter === 'all' ? (
          <div className="py-16 text-center text-muted">
            <Baby className="mx-auto mb-3 h-10 w-10 text-brand-100" />
            No child record checklist yet. Set it up on the <Link href="/center/children" className="text-brand-600 hover:underline">Children</Link> page.
          </div>
        ) : allRows.length === 0 ? (
          <div className="py-16 text-center text-muted">
            <Baby className="mx-auto mb-3 h-10 w-10 text-brand-100" />
            No enrolled children yet. Add them on the <Link href="/center/children" className="text-brand-600 hover:underline">Children</Link> page.
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-muted">No children match these filters.</div>
        ) : (
          <div className="overflow-auto max-h-[75vh]">
            <table className="border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 border-b border-r border-border bg-surface px-5 py-3 text-[15px] font-bold text-text-main min-w-[220px]">Child</th>
                  {columns.map((req, i) => {
                    const newSection = req.section !== columns[i - 1]?.section
                    return (
                      <th key={req.id} className={`sticky top-0 z-20 border-b border-border bg-surface px-1 pb-2 pt-3 align-bottom ${newSection && i > 0 ? 'border-l-2 border-l-brand-100' : ''}`}>
                        <div className="flex h-44 flex-col items-center justify-end">
                          <span className="max-h-40 overflow-hidden text-xs font-semibold text-text-main [writing-mode:vertical-rl] rotate-180" title={req.document_name}>
                            {req.document_name}
                          </span>
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ child, items }) => {
                  const applicable = columns.filter(c => items.get(c.id) && items.get(c.id)!.result.state !== 'not_applicable')
                  const done = applicable.filter(c => {
                    const item = items.get(c.id)!
                    return item.record?.status === 'accepted' && (item.result.state === 'current' || item.result.state === 'due_soon')
                  }).length
                  const href = `/center/children/${child.id}`
                  const room = roomName(child.classroom_id)
                  return (
                    <tr key={child.id} className="hover:bg-surface">
                      <td className="sticky left-0 z-10 border-b border-r border-border bg-white px-5 py-2.5">
                        <Link href={href} className="font-medium text-text-main hover:text-brand-600 hover:underline">
                          {child.preferred_name || child.first_name} {child.last_name}
                        </Link>
                        <div className="text-xs text-muted">{room ? `${room} · ` : ''}{done}/{applicable.length} complete</div>
                      </td>
                      {columns.map((req, i) => {
                        const item = items.get(req.id)
                        const newSection = req.section !== columns[i - 1]?.section
                        const state = item?.result.state
                        return (
                          <td key={req.id} className={`border-b border-border px-1 py-2.5 text-center ${newSection && i > 0 ? 'border-l-2 border-l-brand-100' : ''}`}>
                            {item && state ? (
                              <Link
                                href={href}
                                title={`${req.document_name}: ${state === 'missing' ? 'Not done yet' : COMPLIANCE_STATE_STYLE[state].label}${item.result.dueDate ? ` · ${item.record?.status === 'accepted' ? 'renews' : 'due'} ${formatDate(item.result.dueDate)}` : ''}`}
                                className={`mx-auto block h-5 w-5 rounded ${CELL[state]}`}
                              />
                            ) : (
                              <span className="text-border" title="Does not apply">·</span>
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
    </div>
  )
}

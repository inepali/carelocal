'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Baby, ListChecks, Loader2, Plus, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { canOpenChildFiles, useCenterContext } from '../context'
import { loadChildrenOverview, type ChildRequirement, type Classroom } from '@/lib/children'
import { childRows, describeAge, summarizeChild } from '@/lib/child-compliance'
import { seedNcChildRequirements } from '@/lib/child-template'
import { IMMUNIZATION_STATUS_LABELS, type Child, type ChildDocumentStatus, type ImmunizationStatus } from '@/lib/child-types'
import { formatDate } from '@/lib/compliance'
import { showAlert } from '@/lib/dialog'
import { AddChildDialog } from './_components/AddChildDialog'
import { BTN, Pill } from './_components/ui'

const IMMUNIZATION_STYLE: Record<ImmunizationStatus, string> = {
  missing: 'bg-amber-50 text-amber-700 border-amber-200',
  complete: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  in_progress: 'bg-sky-50 text-sky-700 border-sky-200',
  medical_exemption: 'bg-slate-50 text-slate-700 border-slate-200',
  religious_exemption: 'bg-slate-50 text-slate-700 border-slate-200',
}

type StatusFilter = 'enrolled' | 'withdrawn' | 'all'

/** Owner and admin: every enrolled child, how complete each file is, and what is overdue. */
export default function ChildrenPage() {
  const ctx = useCenterContext()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [children, setChildren] = useState<Child[]>([])
  const [requirements, setRequirements] = useState<ChildRequirement[]>([])
  const [records, setRecords] = useState<ChildDocumentStatus[]>([])
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('enrolled')
  const [classroom, setClassroom] = useState('')
  const [adding, setAdding] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const allowed = canOpenChildFiles(ctx)

  const load = useCallback(async () => {
    if (!ctx.centerId) return
    const res = await loadChildrenOverview(createClient(), ctx.centerId)
    if (res.success) {
      setChildren(res.children); setRequirements(res.requirements); setRecords(res.records); setClassrooms(res.classrooms)
    } else {
      showAlert(res.error)
    }
    setLoading(false)
  }, [ctx.centerId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (allowed) load(); else setLoading(false) }, [allowed, load])

  async function addChecklist() {
    if (!ctx.centerId) return
    setSeeding(true)
    const res = await seedNcChildRequirements(createClient(), ctx.centerId)
    setSeeding(false)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  const rows = useMemo(() => children
    .filter(c => status === 'all' || c.status === status)
    .filter(c => !classroom || c.classroom_id === classroom)
    .filter(c => !search.trim() || `${c.first_name} ${c.last_name} ${c.preferred_name ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    .map(child => ({ child, summary: summarizeChild(childRows(child, requirements, records)) })),
  [children, requirements, records, status, classroom, search])
  const roomName = (id: string | null) => classrooms.find(c => c.id === id)?.name ?? '—'
  const enrolledCount = children.filter(c => c.status === 'enrolled').length

  if (!allowed) {
    return (
      <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center shadow-sm">
        <Baby className="mx-auto mb-3 h-10 w-10 text-brand-200" />
        <h1 className="mb-2 text-xl font-bold text-heading">Child Files</h1>
        <p className="text-muted">
          {ctx.domainKey !== 'childcare' ? 'Child Files is available for child care centers.'
            : !ctx.childFilesEnabled ? 'Child Files is not turned on for your center yet. Contact CareLocal support to join the pilot.'
            : 'Only the owner and administrators can open child records.'}
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="mb-1 text-3xl font-extrabold text-heading">Children</h1>
          <p className="text-muted">Enrollment records for each child, tracked against the NC child care rules. Only the owner and administrators can open them.</p>
        </div>
        <button onClick={() => setAdding(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white shadow-sm hover:bg-brand-800"><Plus className="h-5 w-5" /> Add child</button>
      </div>

      {!loading && requirements.length === 0 && (
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-amber-900">
            <div className="font-bold">Set up the North Carolina child record checklist</div>
            <p className="text-xs">Adds 17 items: the application and emergency forms due on the first day, the immunization record and health assessment due in 30 days, and the parent-signed policies. Dates follow the rules; items whose timing is not yet verified have no deadline.</p>
          </div>
          <button onClick={addChecklist} disabled={seeding} className={BTN}>{seeding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />} Add the NC checklist</button>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search children" className="w-full rounded-xl border border-border bg-white py-2.5 pl-10 pr-4 text-sm text-text-main focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value as StatusFilter)} className="rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-main focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30">
          <option value="enrolled">Enrolled ({enrolledCount})</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="all">All</option>
        </select>
        <select value={classroom} onChange={e => setClassroom(e.target.value)} className="rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-main focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30">
          <option value="">All classrooms</option>
          {classrooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-muted">
            <Baby className="mx-auto mb-3 h-10 w-10 text-brand-100" />
            {children.length === 0 ? 'No children yet. Add the first child, or enroll one from a tour request.' : 'No children match.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-border text-[15px] font-bold text-text-main">
                  <th scope="col" className="px-6 py-4">Child</th>
                  <th scope="col" className="px-4 py-4">Classroom</th>
                  <th scope="col" className="px-4 py-4">First day</th>
                  <th scope="col" className="px-4 py-4">Records</th>
                  <th scope="col" className="px-4 py-4">Immunization</th>
                  <th scope="col" className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm text-text-muted">
                {rows.map(({ child, summary }) => (
                  <tr key={child.id} className="align-top hover:bg-surface">
                    <td className="px-6 py-4">
                      <Link href={`/center/children/${child.id}`} className="font-semibold text-text-main hover:text-brand-600 hover:underline">{child.first_name} {child.last_name}</Link>
                      <div className="text-xs text-muted">{describeAge(child.date_of_birth)}{child.preferred_name ? ` · goes by ${child.preferred_name}` : ''}{child.status === 'withdrawn' ? ' · withdrawn' : ''}</div>
                      {child.custody_restriction && <div className="mt-0.5 text-xs font-semibold text-amber-700">Custody restriction on file</div>}
                    </td>
                    <td className="px-4 py-4">{roomName(child.classroom_id)}</td>
                    <td className="whitespace-nowrap px-4 py-4">{formatDate(child.first_attended_on ?? child.enrolled_on)}</td>
                    <td className="px-4 py-4">
                      <div className="font-semibold text-text-main">{summary.complete} of {summary.applicable}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {summary.counts.overdue > 0 && <Pill className="border-red-200 bg-red-50 text-red-700">{summary.counts.overdue} overdue</Pill>}
                        {summary.counts.due_soon > 0 && <Pill className="border-amber-200 bg-amber-50 text-amber-700">{summary.counts.due_soon} due soon</Pill>}
                        {summary.counts.pending_review > 0 && <Pill className="border-sky-200 bg-sky-50 text-sky-700">{summary.counts.pending_review} to review</Pill>}
                      </div>
                    </td>
                    <td className="px-4 py-4"><Pill className={IMMUNIZATION_STYLE[child.immunization_status]}>{IMMUNIZATION_STATUS_LABELS[child.immunization_status]}</Pill></td>
                    <td className="px-6 py-4 text-right"><Link href={`/center/children/${child.id}`} className={BTN}>Open file</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adding && ctx.centerId && (
        <AddChildDialog centerId={ctx.centerId} classrooms={classrooms} onClose={() => setAdding(false)} onCreated={child => router.push(`/center/children/${child.id}`)} />
      )}
    </div>
  )
}

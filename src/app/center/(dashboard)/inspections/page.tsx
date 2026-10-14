'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useLookups } from '@/hooks/use-lookups'
import {
  Inspection, InspectionIntervalUnit, InspectionLog, InspectionResult,
  INSPECTION_RESULT_LABELS, Vendor,
} from '@/lib/types'
import {
  addInterval, daysUntil, formatDate, formatInterval, inspectionStatus,
  InspectionStatus, todayDateOnly, DUE_SOON_DAYS,
} from '@/lib/inspections'
import {
  Plus, Edit2, Trash2, Loader2, ClipboardCheck, X, CheckCircle2, History,
  AlertTriangle, Clock, CalendarCheck, Search,
} from 'lucide-react'

const OTHER = '__other__'
const INTERVAL_UNITS: InspectionIntervalUnit[] = ['days', 'weeks', 'months', 'years']

const inputClass = 'w-full px-4 py-3 rounded-xl border border-[#e2e8e4] focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all font-medium bg-white'
const labelClass = 'block font-bold text-[#1a2e25] mb-2 uppercase tracking-widest text-[10px]'

const STATUS_STYLES: Record<InspectionStatus, { label: string; className: string }> = {
  overdue: { label: 'Overdue', className: 'bg-red-50 text-red-700 border-red-200' },
  due_soon: { label: 'Due soon', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  ok: { label: 'Current', className: 'bg-[#f0fdf4] text-[#157354] border-[#bbf7d0]' },
  no_due_date: { label: 'No due date', className: 'bg-slate-50 text-slate-500 border-slate-200' },
}

const RESULT_STYLES: Record<InspectionResult, string> = {
  passed: 'text-[#157354]',
  passed_with_conditions: 'text-amber-700',
  failed: 'text-red-600',
}

type Filter = 'all' | 'overdue' | 'due_soon' | 'ok'

type InspectionForm = {
  type_choice: string
  type_other: string
  title: string
  interval_value: string
  interval_unit: InspectionIntervalUnit
  last_inspection_date: string
  next_due_date: string
  due_overridden: boolean
  vendor_id: string
  notes: string
}

const EMPTY_FORM: InspectionForm = {
  type_choice: '', type_other: '', title: '', interval_value: '1', interval_unit: 'years',
  last_inspection_date: '', next_due_date: '', due_overridden: false, vendor_id: '', notes: '',
}

type RecordForm = {
  performed_on: string
  result: InspectionResult | ''
  vendor_id: string
  inspector_name: string
  notes: string
  next_due_date: string
  due_overridden: boolean
}

function computeDue(last: string, value: string, unit: InspectionIntervalUnit): string {
  const n = parseInt(value)
  if (!last || !n || n < 1) return ''
  return addInterval(last, n, unit)
}

export default function InspectionsPage() {
  const supabase = createClient()
  const { data: typeLookups } = useLookups('Inspection Type')
  const [loading, setLoading] = useState(true)
  const [centerId, setCenterId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  // Add / edit modal
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Inspection | null>(null)
  const [form, setForm] = useState<InspectionForm>(EMPTY_FORM)

  // Record-inspection modal
  const [recording, setRecording] = useState<Inspection | null>(null)
  const [recordForm, setRecordForm] = useState<RecordForm | null>(null)

  // History drawer
  const [historyFor, setHistoryFor] = useState<Inspection | null>(null)
  const [history, setHistory] = useState<InspectionLog[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id)
      .single()

    if (admin) {
      setCenterId(admin.center_id)
      const [{ data: rows }, { data: vendorRows }] = await Promise.all([
        supabase
          .from('center_inspections')
          .select('*, vendor:center_vendors(id, name)')
          .eq('center_id', admin.center_id)
          .eq('is_active', true)
          .order('next_due_date', { ascending: true, nullsFirst: false }),
        supabase
          .from('center_vendors')
          .select('*')
          .eq('center_id', admin.center_id)
          .order('name'),
      ])
      setInspections((rows as Inspection[]) || [])
      setVendors(vendorRows || [])
    }
    setLoading(false)
  }

  const typeOptions = useMemo(() => {
    const seen = new Set<string>()
    return (typeLookups || [])
      .filter((l: any) => l.is_active !== false)
      .map((l: any) => l.label as string)
      .filter(label => (seen.has(label) ? false : (seen.add(label), true)))
  }, [typeLookups])

  const activeVendors = vendors.filter(v => v.is_active)

  const counts = useMemo(() => {
    const c = { overdue: 0, due_soon: 0, ok: 0 }
    for (const i of inspections) {
      const s = inspectionStatus(i.next_due_date)
      if (s in c) c[s as keyof typeof c]++
    }
    return c
  }, [inspections])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return inspections.filter(i => {
      if (filter !== 'all' && inspectionStatus(i.next_due_date) !== filter) return false
      if (!q) return true
      return [i.inspection_type, i.title, i.vendor?.name].some(f => f?.toLowerCase().includes(q))
    })
  }, [inspections, filter, search])

  // ── Add / edit ───────────────────────────────

  function openEdit(inspection: Inspection | null = null) {
    setError(null)
    setEditing(inspection)
    if (inspection) {
      const known = typeOptions.includes(inspection.inspection_type)
      const autoDue = inspection.last_inspection_date && inspection.interval_value && inspection.interval_unit
        ? addInterval(inspection.last_inspection_date, inspection.interval_value, inspection.interval_unit)
        : ''
      setForm({
        type_choice: known ? inspection.inspection_type : OTHER,
        type_other: known ? '' : inspection.inspection_type,
        title: inspection.title || '',
        interval_value: inspection.interval_value?.toString() || '',
        interval_unit: inspection.interval_unit || 'years',
        last_inspection_date: inspection.last_inspection_date || '',
        next_due_date: inspection.next_due_date || '',
        due_overridden: !!inspection.next_due_date && inspection.next_due_date !== autoDue,
        vendor_id: inspection.vendor_id || '',
        notes: inspection.notes || '',
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setEditOpen(true)
  }

  function updateForm(patch: Partial<InspectionForm>) {
    setForm(prev => {
      const next = { ...prev, ...patch }
      if (!next.due_overridden) {
        next.next_due_date = computeDue(next.last_inspection_date, next.interval_value, next.interval_unit)
      }
      return next
    })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!centerId) return
    const inspectionType = (form.type_choice === OTHER ? form.type_other : form.type_choice).trim()
    if (!inspectionType) { setError('Choose an inspection type.'); return }

    const intervalValue = form.interval_value ? parseInt(form.interval_value) : null
    if (intervalValue !== null && (isNaN(intervalValue) || intervalValue < 1)) {
      setError('Interval must be a whole number of 1 or more.'); return
    }
    if (form.last_inspection_date && form.last_inspection_date > todayDateOnly()) {
      setError('Last inspection date can’t be in the future.'); return
    }

    setSaving(true)
    setError(null)
    const payload = {
      center_id: centerId,
      inspection_type: inspectionType,
      title: form.title.trim() || null,
      interval_value: intervalValue,
      interval_unit: intervalValue ? form.interval_unit : null,
      last_inspection_date: form.last_inspection_date || null,
      next_due_date: form.next_due_date || null,
      vendor_id: form.vendor_id || null,
      notes: form.notes.trim() || null,
    }

    if (editing) {
      const { error: err } = await supabase.from('center_inspections').update(payload).eq('id', editing.id)
      if (err) { setSaving(false); setError(err.message); return }
    } else {
      const { data: created, error: err } = await supabase
        .from('center_inspections').insert(payload).select('id').single()
      if (err || !created) { setSaving(false); setError(err?.message || 'Failed to save'); return }
      // Seed history with the initial "last inspection" so it appears in the log
      if (payload.last_inspection_date) {
        await supabase.from('center_inspection_logs').insert({
          inspection_id: created.id,
          center_id: centerId,
          performed_on: payload.last_inspection_date,
          vendor_id: payload.vendor_id,
          created_by: userId,
          notes: 'Recorded when inspection was added',
        })
      }
    }

    setSaving(false)
    setEditOpen(false)
    loadData()
  }

  async function handleDelete(inspection: Inspection) {
    if (!confirm(`Delete "${inspection.inspection_type}"${inspection.title ? ` (${inspection.title})` : ''} and its history? This can't be undone.`)) return
    const { error: err } = await supabase.from('center_inspections').delete().eq('id', inspection.id)
    if (err) alert('Failed to delete inspection: ' + err.message)
    else loadData()
  }

  // ── Record performed inspection ─────────────

  function openRecord(inspection: Inspection) {
    setError(null)
    const today = todayDateOnly()
    setRecording(inspection)
    setRecordForm({
      performed_on: today,
      result: 'passed',
      vendor_id: inspection.vendor_id || '',
      inspector_name: '',
      notes: '',
      next_due_date: inspection.interval_value && inspection.interval_unit
        ? addInterval(today, inspection.interval_value, inspection.interval_unit)
        : '',
      due_overridden: false,
    })
  }

  function updateRecord(patch: Partial<RecordForm>) {
    if (!recording) return
    setRecordForm(prev => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      if (!next.due_overridden && recording.interval_value && recording.interval_unit && next.performed_on) {
        next.next_due_date = addInterval(next.performed_on, recording.interval_value, recording.interval_unit)
      }
      return next
    })
  }

  async function handleRecord(e: React.FormEvent) {
    e.preventDefault()
    if (!centerId || !recording || !recordForm) return
    if (!recordForm.performed_on) { setError('Enter the date performed.'); return }
    if (recordForm.performed_on > todayDateOnly()) { setError('Date performed can’t be in the future.'); return }

    setSaving(true)
    setError(null)

    const { error: logErr } = await supabase.from('center_inspection_logs').insert({
      inspection_id: recording.id,
      center_id: centerId,
      performed_on: recordForm.performed_on,
      result: recordForm.result || null,
      vendor_id: recordForm.vendor_id || null,
      inspector_name: recordForm.inspector_name.trim() || null,
      notes: recordForm.notes.trim() || null,
      created_by: userId,
    })
    if (logErr) { setSaving(false); setError(logErr.message); return }

    // Only advance the inspection if this is the most recent one (back-filling older history shouldn't move the due date)
    const isLatest = !recording.last_inspection_date || recordForm.performed_on >= recording.last_inspection_date
    if (isLatest) {
      const { error: updErr } = await supabase.from('center_inspections').update({
        last_inspection_date: recordForm.performed_on,
        last_result: recordForm.result || null,
        next_due_date: recordForm.next_due_date || null,
        vendor_id: recordForm.vendor_id || recording.vendor_id || null,
      }).eq('id', recording.id)
      if (updErr) { setSaving(false); setError('Saved to history, but failed to update due date: ' + updErr.message); return }
    }

    setSaving(false)
    setRecording(null)
    setRecordForm(null)
    loadData()
    if (historyFor?.id === recording.id) openHistory(recording)
  }

  // ── History ──────────────────────────────────

  async function openHistory(inspection: Inspection) {
    setHistoryFor(inspection)
    setHistoryLoading(true)
    const { data } = await supabase
      .from('center_inspection_logs')
      .select('*, vendor:center_vendors(id, name)')
      .eq('inspection_id', inspection.id)
      .order('performed_on', { ascending: false })
      .order('created_at', { ascending: false })
    setHistory((data as InspectionLog[]) || [])
    setHistoryLoading(false)
  }

  async function deleteLog(log: InspectionLog) {
    if (!confirm(`Remove the ${formatDate(log.performed_on)} entry from history? The inspection's due date won't change.`)) return
    const { error: err } = await supabase.from('center_inspection_logs').delete().eq('id', log.id)
    if (err) alert('Failed to remove entry: ' + err.message)
    else if (historyFor) openHistory(historyFor)
  }

  // ── Render ───────────────────────────────────

  if (loading) {
    return <div className="animate-pulse space-y-6 pt-10 px-8">
      <div className="h-10 w-48 bg-slate-200 rounded-lg mb-8"></div>
      <div className="grid grid-cols-3 gap-4">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-2xl border border-slate-100"></div>)}</div>
      <div className="h-64 bg-white rounded-3xl border border-slate-100 shadow-sm"></div>
    </div>
  }

  const vendorSelect = (value: string, onChange: (v: string) => void) => (
    <>
      <select value={value} onChange={e => onChange(e.target.value)} className={inputClass}>
        <option value="">— No vendor —</option>
        {activeVendors.map(v => (
          <option key={v.id} value={v.id}>{v.name}{v.service_type ? ` · ${v.service_type}` : ''}</option>
        ))}
        {/* keep an inactive vendor that's already assigned selectable */}
        {value && !activeVendors.some(v => v.id === value) && vendors.find(v => v.id === value) && (
          <option value={value}>{vendors.find(v => v.id === value)!.name} (inactive)</option>
        )}
      </select>
      {activeVendors.length === 0 && (
        <p className="text-xs text-[#6b7a73] mt-2">No vendors yet. <Link href="/center/vendors" className="text-[#157354] font-bold hover:underline">Add vendors →</Link></p>
      )}
    </>
  )

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Inspections</h1>
          <p className="text-[#6b7a73]">Track every inspection, how often it’s required, and when it’s due next.</p>
        </div>
        <button
          onClick={() => openEdit()}
          className="inline-flex items-center justify-center gap-2 bg-[#fbbf24] text-[#0b3828] font-bold px-6 py-3 rounded-xl hover:bg-[#f59e0b] shadow-sm transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" /> Add Inspection
        </button>
      </div>

      {/* Summary tiles double as filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {([
          { key: 'overdue', label: 'Overdue', icon: AlertTriangle, tone: 'text-red-600 bg-red-50' },
          { key: 'due_soon', label: `Due in ${DUE_SOON_DAYS} days`, icon: Clock, tone: 'text-amber-600 bg-amber-50' },
          { key: 'ok', label: 'Current', icon: CalendarCheck, tone: 'text-[#157354] bg-[#edf7f3]' },
        ] as const).map(tile => (
          <button
            key={tile.key}
            onClick={() => setFilter(f => (f === tile.key ? 'all' : tile.key))}
            className={`text-left bg-white border rounded-2xl p-5 flex items-center gap-4 transition-all hover:shadow-md ${filter === tile.key ? 'border-[#157354] ring-4 ring-[#157354]/10' : 'border-[#e2e8e4]'}`}
          >
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${tile.tone}`}>
              <tile.icon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-black text-[#0b3828]">{counts[tile.key]}</div>
              <div className="text-xs font-bold uppercase tracking-widest text-[#6b7a73]">{tile.label}</div>
            </div>
          </button>
        ))}
      </div>

      {inspections.length === 0 ? (
        <div className="py-20 bg-white border border-dashed border-[#a9dac9] rounded-[2.5rem] text-center">
          <ClipboardCheck className="w-16 h-16 text-[#e2e8e4] mx-auto mb-4" />
          <h3 className="text-xl font-bold text-[#0b3828] mb-2">No inspections tracked yet</h3>
          <p className="text-[#6b7a73] max-w-sm mx-auto mb-6">Add fire, health, licensing, and maintenance inspections to see what’s due and what’s overdue.</p>
          <button onClick={() => openEdit()} className="text-[#157354] font-bold hover:underline">Add your first inspection →</button>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center mb-4">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#a8b5ae] absolute left-4 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by type, title, or vendor…" className={`${inputClass} pl-10`} />
            </div>
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')} className="text-sm font-bold text-[#157354] hover:underline">Clear filter</button>
            )}
          </div>

          <div className="bg-white border border-[#e2e8e4] rounded-[1.5rem] overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#f8faf9] text-[10px] uppercase tracking-widest text-[#6b7a73]">
                  <tr>
                    <th className="text-left font-bold px-5 py-3">Inspection</th>
                    <th className="text-left font-bold px-5 py-3">Interval</th>
                    <th className="text-left font-bold px-5 py-3">Last Inspection</th>
                    <th className="text-left font-bold px-5 py-3">Due Date</th>
                    <th className="text-left font-bold px-5 py-3">Vendor</th>
                    <th className="text-right font-bold px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f4f2]">
                  {visible.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-10 text-center text-[#6b7a73]">No inspections match.</td></tr>
                  ) : visible.map(i => {
                    const status = inspectionStatus(i.next_due_date)
                    const days = i.next_due_date ? daysUntil(i.next_due_date) : null
                    return (
                      <tr key={i.id} className="hover:bg-[#fafcfb]">
                        <td className="px-5 py-4">
                          <div className="font-bold text-[#0b3828]">{i.inspection_type}</div>
                          {i.title && <div className="text-xs text-[#6b7a73]">{i.title}</div>}
                        </td>
                        <td className="px-5 py-4 text-[#4a5a52] whitespace-nowrap">{formatInterval(i.interval_value, i.interval_unit)}</td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="text-[#1a2e25]">{formatDate(i.last_inspection_date)}</div>
                          {i.last_result && <div className={`text-xs font-bold ${RESULT_STYLES[i.last_result]}`}>{INSPECTION_RESULT_LABELS[i.last_result]}</div>}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="text-[#1a2e25]">{formatDate(i.next_due_date)}</div>
                          <span className={`inline-block mt-1 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-widest ${STATUS_STYLES[status].className}`}>
                            {status === 'overdue' && days !== null ? `${Math.abs(days)}d overdue`
                              : status === 'due_soon' && days !== null ? (days === 0 ? 'Due today' : `In ${days}d`)
                              : STATUS_STYLES[status].label}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-[#4a5a52]">{i.vendor?.name || <span className="text-[#a8b5ae]">—</span>}</td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openRecord(i)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#157354] text-white text-xs font-bold hover:bg-[#0f4a36] whitespace-nowrap">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Record
                            </button>
                            <button onClick={() => openHistory(i)} aria-label="History" title="History" className="p-2 text-[#6b7a73] hover:text-[#157354] hover:bg-[#edf7f3] rounded-lg"><History className="w-4 h-4" /></button>
                            <button onClick={() => openEdit(i)} aria-label="Edit" title="Edit" className="p-2 text-[#6b7a73] hover:text-[#157354] hover:bg-[#edf7f3] rounded-lg"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(i)} aria-label="Delete" title="Delete" className="p-2 text-[#6b7a73] hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Add / edit modal ── */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b3828]/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-[#e2e8e4] flex items-center justify-between bg-[#f8faf9]">
              <h2 className="text-2xl font-black text-[#0b3828] tracking-tight">{editing ? 'Edit Inspection' : 'New Inspection'}</h2>
              <button onClick={() => setEditOpen(false)} aria-label="Close" className="p-2 hover:bg-[#e2e8e4] rounded-full"><X className="w-5 h-5 text-[#6b7a73]" /></button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className={labelClass}>Inspection Type *</label>
                <select required value={form.type_choice} onChange={e => updateForm({ type_choice: e.target.value })} className={inputClass}>
                  <option value="" disabled>Select a type…</option>
                  {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  <option value={OTHER}>Other…</option>
                </select>
                {form.type_choice === OTHER && (
                  <input autoFocus required value={form.type_other} onChange={e => updateForm({ type_other: e.target.value })} placeholder="Inspection type" className={`${inputClass} mt-2`} />
                )}
                <p className="text-xs text-[#6b7a73] mt-2">Manage the type list in <Link href="/center/settings/data" className="text-[#157354] font-bold hover:underline">Manage Data</Link>.</p>
              </div>

              <div>
                <label className={labelClass}>Title / Location (optional)</label>
                <input value={form.title} onChange={e => updateForm({ title: e.target.value })} placeholder="e.g. Kitchen extinguishers, Building B" className={inputClass} />
              </div>

              <div>
                <label className={labelClass}>Interval</label>
                <div className="flex gap-2">
                  <input type="number" min={1} value={form.interval_value} onChange={e => updateForm({ interval_value: e.target.value })} placeholder="—" className={`${inputClass} w-24`} />
                  <select value={form.interval_unit} onChange={e => updateForm({ interval_unit: e.target.value as InspectionIntervalUnit })} className={inputClass}>
                    {INTERVAL_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <p className="text-xs text-[#6b7a73] mt-2">Leave blank for one-time or as-needed inspections.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Last Inspection</label>
                  <input type="date" max={todayDateOnly()} value={form.last_inspection_date} onChange={e => updateForm({ last_inspection_date: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Next Due Date</label>
                  <input
                    type="date"
                    value={form.next_due_date}
                    onChange={e => setForm(f => ({ ...f, next_due_date: e.target.value, due_overridden: true }))}
                    className={inputClass}
                  />
                  {form.due_overridden ? (
                    <button type="button" onClick={() => updateForm({ due_overridden: false })} className="text-xs text-[#157354] font-bold hover:underline mt-2">Reset to calculated</button>
                  ) : (
                    <p className="text-xs text-[#6b7a73] mt-2">Calculated from last + interval</p>
                  )}
                </div>
              </div>

              <div>
                <label className={labelClass}>Vendor</label>
                {vendorSelect(form.vendor_id, v => updateForm({ vendor_id: v }))}
              </div>

              <div>
                <label className={labelClass}>Notes</label>
                <textarea rows={3} value={form.notes} onChange={e => updateForm({ notes: e.target.value })} className={inputClass} />
              </div>

              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>}

              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setEditOpen(false)} className="flex-1 py-3 px-6 rounded-xl border border-[#e2e8e4] font-bold text-[#6b7a73] hover:bg-[#f8faf9]">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-[#157354] text-white font-bold py-3 px-6 rounded-xl hover:bg-[#0f4a36] shadow-lg shadow-[#157354]/20 flex items-center justify-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Inspection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Record modal ── */}
      {recording && recordForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b3828]/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-[#e2e8e4] flex items-start justify-between bg-[#f8faf9]">
              <div>
                <h2 className="text-2xl font-black text-[#0b3828] tracking-tight">Record Inspection</h2>
                <p className="text-sm text-[#6b7a73]">{recording.inspection_type}{recording.title ? ` · ${recording.title}` : ''}</p>
              </div>
              <button onClick={() => { setRecording(null); setRecordForm(null) }} aria-label="Close" className="p-2 hover:bg-[#e2e8e4] rounded-full"><X className="w-5 h-5 text-[#6b7a73]" /></button>
            </div>

            <form onSubmit={handleRecord} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Date Performed *</label>
                  <input type="date" required max={todayDateOnly()} value={recordForm.performed_on} onChange={e => updateRecord({ performed_on: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Result</label>
                  <select value={recordForm.result} onChange={e => updateRecord({ result: e.target.value as InspectionResult | '' })} className={inputClass}>
                    <option value="">—</option>
                    {(Object.keys(INSPECTION_RESULT_LABELS) as InspectionResult[]).map(r => <option key={r} value={r}>{INSPECTION_RESULT_LABELS[r]}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>Vendor</label>
                {vendorSelect(recordForm.vendor_id, v => updateRecord({ vendor_id: v }))}
              </div>

              <div>
                <label className={labelClass}>Inspector Name</label>
                <input value={recordForm.inspector_name} onChange={e => updateRecord({ inspector_name: e.target.value })} className={inputClass} />
              </div>

              <div>
                <label className={labelClass}>Next Due Date</label>
                <input
                  type="date"
                  value={recordForm.next_due_date}
                  onChange={e => setRecordForm(f => f && ({ ...f, next_due_date: e.target.value, due_overridden: true }))}
                  className={inputClass}
                />
                {recording.last_inspection_date && recordForm.performed_on < recording.last_inspection_date && (
                  <p className="text-xs text-amber-700 mt-2">This date is before the last recorded inspection ({formatDate(recording.last_inspection_date)}), so it’ll be added to history without changing the due date.</p>
                )}
              </div>

              <div>
                <label className={labelClass}>Notes / Findings</label>
                <textarea rows={3} value={recordForm.notes} onChange={e => updateRecord({ notes: e.target.value })} className={inputClass} />
              </div>

              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>}

              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => { setRecording(null); setRecordForm(null) }} className="flex-1 py-3 px-6 rounded-xl border border-[#e2e8e4] font-bold text-[#6b7a73] hover:bg-[#f8faf9]">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-[#157354] text-white font-bold py-3 px-6 rounded-xl hover:bg-[#0f4a36] shadow-lg shadow-[#157354]/20 flex items-center justify-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── History drawer ── */}
      {historyFor && (
        <div className="fixed inset-0 z-40 flex justify-end bg-[#0b3828]/30 backdrop-blur-sm" onClick={() => setHistoryFor(null)}>
          <div className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-[#e2e8e4] flex items-start justify-between bg-[#f8faf9]">
              <div>
                <h2 className="text-xl font-black text-[#0b3828]">Inspection History</h2>
                <p className="text-sm text-[#6b7a73]">{historyFor.inspection_type}{historyFor.title ? ` · ${historyFor.title}` : ''}</p>
              </div>
              <button onClick={() => setHistoryFor(null)} aria-label="Close" className="p-2 hover:bg-[#e2e8e4] rounded-full"><X className="w-5 h-5 text-[#6b7a73]" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {historyLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-[#157354]" /></div>
              ) : history.length === 0 ? (
                <div className="text-center text-[#6b7a73] py-10">No inspections recorded yet.</div>
              ) : (
                <ol className="space-y-4">
                  {history.map(log => (
                    <li key={log.id} className="border border-[#e2e8e4] rounded-2xl p-4 group">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-[#0b3828]">{formatDate(log.performed_on)}</div>
                          {log.result && <div className={`text-xs font-bold ${RESULT_STYLES[log.result]}`}>{INSPECTION_RESULT_LABELS[log.result]}</div>}
                        </div>
                        <button onClick={() => deleteLog(log)} aria-label="Remove entry" className="p-1.5 text-[#a8b5ae] hover:text-red-500 hover:bg-red-50 rounded-lg sm:opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4" /></button>
                      </div>
                      {(log.vendor?.name || log.inspector_name) && (
                        <div className="text-sm text-[#4a5a52] mt-2">
                          {log.vendor?.name}{log.vendor?.name && log.inspector_name ? ' · ' : ''}{log.inspector_name}
                        </div>
                      )}
                      {log.notes && <p className="text-sm text-[#6b7a73] mt-2 whitespace-pre-wrap">{log.notes}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="p-4 border-t border-[#e2e8e4]">
              <button onClick={() => openRecord(historyFor)} className="w-full inline-flex items-center justify-center gap-2 bg-[#157354] text-white font-bold py-3 rounded-xl hover:bg-[#0f4a36]">
                <CheckCircle2 className="w-4 h-4" /> Record Inspection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

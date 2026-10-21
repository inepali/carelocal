'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useLookups } from '@/hooks/use-lookups'
import {
  Inspection, InspectionFile, InspectionIntervalUnit, InspectionLog, InspectionResult,
  INSPECTION_RESULT_LABELS, Vendor,
} from '@/lib/types'
import { deleteInspectionFile } from '@/app/actions/storage.actions'
import { openStoredFile, storeUpload, DOCUMENT_ACCEPT, type UploadSource } from '@/lib/files'
import { PhoneUploadButton } from '@/components/center/PhoneUploadDialog'
import {
  addInterval, daysUntil, formatDate, formatInterval, inspectionStatus,
  InspectionStatus, todayDateOnly, DUE_SOON_DAYS,
} from '@/lib/inspections'
import {
  Plus, Edit2, Trash2, Loader2, ClipboardCheck, X, CheckCircle2, History,
  AlertTriangle, Clock, CalendarCheck, Search, Paperclip, FileText, Upload,
} from 'lucide-react'
import { showAlert, showConfirm } from '@/lib/dialog'

const OTHER = '__other__'
const INTERVAL_UNITS: InspectionIntervalUnit[] = ['days', 'weeks', 'months', 'years']

const inputClass = 'w-full px-4 py-3 rounded-xl border border-border focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-medium bg-white'
const labelClass = 'block font-bold text-text-main mb-2 uppercase tracking-widest text-[10px]'

const STATUS_STYLES: Record<InspectionStatus, { label: string; className: string }> = {
  overdue: { label: 'Overdue', className: 'bg-red-50 text-red-700 border-red-200' },
  due_soon: { label: 'Due soon', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  ok: { label: 'Current', className: 'bg-brand-50 text-brand-600 border-[#bbf7d0]' },
  no_due_date: { label: 'No due date', className: 'bg-slate-50 text-slate-500 border-slate-200' },
}

const RESULT_STYLES: Record<InspectionResult, string> = {
  passed: 'text-brand-600',
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

  // Deep link from the dashboard tiles, e.g. /center/inspections?filter=overdue
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('filter')
    if (requested === 'overdue' || requested === 'due_soon' || requested === 'ok') setFilter(requested)
  }, [])
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
  const [historyFiles, setHistoryFiles] = useState<InspectionFile[]>([])
  const [uploadingFor, setUploadingFor] = useState<string | null>(null) // log id, or 'other'

  // Reports attached while recording, and report counts per inspection for the list
  const [recordFiles, setRecordFiles] = useState<UploadSource[]>([])
  // New / edit inspection: files to attach on save, and reports already attached (edit)
  const [editFiles, setEditFiles] = useState<UploadSource[]>([])
  const [editExisting, setEditExisting] = useState<InspectionFile[]>([])
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({})
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
      const [{ data: rows }, { data: vendorRows }, { data: fileRows }] = await Promise.all([
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
        supabase
          .from('center_inspection_files')
          .select('inspection_id')
          .eq('center_id', admin.center_id),
      ])
      setInspections((rows as Inspection[]) || [])
      setVendors(vendorRows || [])
      setFileCounts((fileRows || []).reduce<Record<string, number>>((acc, f) => {
        acc[f.inspection_id] = (acc[f.inspection_id] ?? 0) + 1
        return acc
      }, {}))
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

  async function loadEditReports(inspectionId: string) {
    const { data } = await supabase
      .from('center_inspection_files')
      .select('id, center_id, inspection_id, log_id, file_name, content_type, size_bytes, uploaded_at')
      .eq('inspection_id', inspectionId)
      .order('uploaded_at', { ascending: false })
    setEditExisting((data as InspectionFile[]) || [])
  }

  function openEdit(inspection: Inspection | null = null) {
    setError(null)
    setEditing(inspection)
    setEditFiles([])
    setEditExisting([])
    if (inspection) loadEditReports(inspection.id)
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

    // Where new reports go: the inspection, and the history entry they document (if any)
    let inspectionId: string
    let logId: string | null = null

    if (editing) {
      const { error: err } = await supabase.from('center_inspections').update(payload).eq('id', editing.id)
      if (err) { setSaving(false); setError(err.message); return }
      inspectionId = editing.id
      if (editFiles.length > 0) {
        // Attach to the most recent visit; without history they go under "Other reports"
        const { data: latest } = await supabase
          .from('center_inspection_logs')
          .select('id')
          .eq('inspection_id', editing.id)
          .order('performed_on', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        logId = latest?.id ?? null
      }
    } else {
      const { data: created, error: err } = await supabase
        .from('center_inspections').insert(payload).select('id').single()
      if (err || !created) { setSaving(false); setError(err?.message || 'Failed to save'); return }
      inspectionId = created.id
      // Seed history with the initial "last inspection" so it appears in the log
      if (payload.last_inspection_date) {
        const { data: seeded } = await supabase.from('center_inspection_logs').insert({
          inspection_id: created.id,
          center_id: centerId,
          performed_on: payload.last_inspection_date,
          vendor_id: payload.vendor_id,
          created_by: userId,
          notes: 'Recorded when inspection was added',
        }).select('id').single()
        logId = seeded?.id ?? null
      }
    }

    if (editFiles.length > 0) {
      const failures = await attachReports(inspectionId, logId, editFiles)
      if (failures.length) showAlert('The inspection was saved, but some reports could not be attached:\n' + failures.join('\n') + '\n\nYou can attach them from History.')
    }

    setSaving(false)
    setEditOpen(false)
    setEditFiles([])
    loadData()
  }

  async function handleDelete(inspection: Inspection) {
    if (!await showConfirm(`Delete "${inspection.inspection_type}"${inspection.title ? ` (${inspection.title})` : ''} and its history? This can't be undone.`)) return
    const { error: err } = await supabase.from('center_inspections').delete().eq('id', inspection.id)
    if (err) {
      // Reports are kept as records: the database refuses to delete an inspection that has them
      showAlert(err.code === '23503'
        ? 'This inspection has attached reports, which are kept as records. Delete the reports in History first, or keep the inspection.'
        : 'Failed to delete inspection: ' + err.message)
    } else loadData()
  }

  // ── Reports (paper records) ──────────────────

  /** Uploads files to secure storage and attaches them to an inspection (and history entry) */
  async function attachReports(inspectionId: string, logId: string | null, files: UploadSource[]) {
    if (!centerId) return []
    const failures: string[] = []
    for (const file of files) {
      try {
        const stored = await storeUpload('inspection', file)
        const { error: insErr } = await supabase.from('center_inspection_files').insert({
          center_id: centerId,
          inspection_id: inspectionId,
          log_id: logId,
          file_name: stored.name,
          file_key: stored.fileKey,
          bucket_name: stored.bucketName,
          content_type: stored.type || null,
          size_bytes: stored.size,
          uploaded_by: userId,
        })
        if (insErr) throw insErr
      } catch (err) {
        const reason = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'upload failed'
        failures.push(`${file.name}: ${reason}`)
      }
    }
    return failures
  }

  async function uploadToHistory(logId: string | null, files: FileList | UploadSource[] | null) {
    if (!historyFor || !files || files.length === 0) return
    setUploadingFor(logId ?? 'other')
    const failures = await attachReports(historyFor.id, logId, Array.from(files))
    setUploadingFor(null)
    if (failures.length) showAlert('Some files could not be attached:\n' + failures.join('\n'))
    openHistory(historyFor)
    loadData()
  }

  async function removeReport(file: InspectionFile) {
    if (!await showConfirm(`Delete "${file.file_name}"? The file will be permanently removed.`)) return
    const res = await deleteInspectionFile(file.id)
    if (!res.success) { showAlert(res.error); return }
    if (historyFor) openHistory(historyFor)
    loadData()
  }

  // ── Record performed inspection ─────────────

  function openRecord(inspection: Inspection) {
    setError(null)
    setRecordFiles([])
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

    const { data: log, error: logErr } = await supabase.from('center_inspection_logs').insert({
      inspection_id: recording.id,
      center_id: centerId,
      performed_on: recordForm.performed_on,
      result: recordForm.result || null,
      vendor_id: recordForm.vendor_id || null,
      inspector_name: recordForm.inspector_name.trim() || null,
      notes: recordForm.notes.trim() || null,
      created_by: userId,
    }).select('id').single()
    if (logErr || !log) { setSaving(false); setError(logErr?.message ?? 'Failed to save the record'); return }

    // Attach the inspection report(s) to this history entry
    if (recordFiles.length > 0) {
      const failures = await attachReports(recording.id, log.id, recordFiles)
      if (failures.length) showAlert('The inspection was recorded, but some reports could not be attached:\n' + failures.join('\n') + '\n\nYou can attach them from History.')
    }

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
    setRecordFiles([])
    loadData()
    if (historyFor?.id === recording.id) openHistory(recording)
  }

  // ── History ──────────────────────────────────

  async function openHistory(inspection: Inspection) {
    setHistoryFor(inspection)
    setHistoryLoading(true)
    const [{ data }, { data: files }] = await Promise.all([
      supabase
        .from('center_inspection_logs')
        .select('*, vendor:center_vendors(id, name)')
        .eq('inspection_id', inspection.id)
        .order('performed_on', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('center_inspection_files')
        .select('id, center_id, inspection_id, log_id, file_name, content_type, size_bytes, uploaded_at')
        .eq('inspection_id', inspection.id)
        .order('uploaded_at', { ascending: true }),
    ])
    setHistory((data as InspectionLog[]) || [])
    setHistoryFiles((files as InspectionFile[]) || [])
    setHistoryLoading(false)
  }

  async function deleteLog(log: InspectionLog) {
    const attached = historyFiles.filter(f => f.log_id === log.id).length
    if (!await showConfirm(`Remove the ${formatDate(log.performed_on)} entry from history? The inspection's due date won't change.${attached ? ` Its ${attached} attached report${attached === 1 ? '' : 's'} will be kept under "Other reports".` : ''}`)) return
    const { error: err } = await supabase.from('center_inspection_logs').delete().eq('id', log.id)
    if (err) showAlert('Failed to remove entry: ' + err.message)
    else if (historyFor) openHistory(historyFor)
  }

  /** Drop zone + list of files waiting to be attached when the form is saved */
  function renderPicker(files: UploadSource[], setFiles: React.Dispatch<React.SetStateAction<UploadSource[]>>, phoneLabel = 'Inspection report') {
    return (
      <>
        <label className="flex items-center gap-3 w-full p-4 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-brand-600 hover:bg-surface transition-all">
          <Upload className="w-5 h-5 text-subtle" />
          <span className="text-sm text-muted">Attach the report, certificate or invoice (PDF, photo or Word, up to 15 MB each)</span>
          <input
            type="file"
            multiple
            accept={DOCUMENT_ACCEPT}
            className="sr-only"
            onChange={e => {
              const picked = Array.from(e.target.files ?? [])
              e.target.value = ''
              setFiles(prev => [...prev, ...picked])
            }}
          />
        </label>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          <span>Paper copy in hand?</span>
          <PhoneUploadButton kind="inspection" label={phoneLabel} text="Take a photo with your phone" onReceived={upload => { setFiles(prev => [...prev, upload]) }} />
        </div>
        {files.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-text-main"><FileText className="w-4 h-4 shrink-0 text-brand-600" /><span className="truncate">{f.name}</span><span className="shrink-0 text-xs text-muted">· attaches on save</span></span>
                <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="p-1 text-subtle hover:text-red-500"><X className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  /** Attached reports for a history entry (logId) or not tied to one (null) */
  function renderReports(files: InspectionFile[], logId: string | null) {
    const key = logId ?? 'other'
    return (
      <div className="mt-3 space-y-1.5">
        {files.map(file => (
          <div key={file.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
            <button onClick={() => openStoredFile('inspection', file.id)} className="flex min-w-0 items-center gap-2 text-sm text-brand-600 hover:underline" title={`Uploaded ${new Date(file.uploaded_at).toLocaleDateString()}`}>
              <FileText className="w-4 h-4 shrink-0" /><span className="truncate">{file.file_name}</span>
            </button>
            <button onClick={() => removeReport(file)} aria-label={`Delete ${file.file_name}`} className="p-1 text-subtle hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold text-brand-600 hover:underline">
          {uploadingFor === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
          {uploadingFor === key ? 'Uploading…' : 'Attach report'}
          <input
            type="file"
            multiple
            accept={DOCUMENT_ACCEPT}
            className="sr-only"
            disabled={uploadingFor !== null}
            onChange={e => { const picked = e.target.files; uploadToHistory(logId, picked); e.target.value = '' }}
          />
        </label>
        <PhoneUploadButton
          kind="inspection"
          label="Inspection report"
          disabled={uploadingFor !== null}
          text="From phone"
          className="ml-4 inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:underline disabled:opacity-50"
          onReceived={upload => uploadToHistory(logId, [upload])}
        />
      </div>
    )
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
        <p className="text-xs text-muted mt-2">No vendors yet. <Link href="/center/vendors" className="text-brand-600 font-bold hover:underline">Add vendors →</Link></p>
      )}
    </>
  )

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-heading mb-1">Inspections</h1>
          <p className="text-muted">Track every inspection, how often it’s required, and when it’s due next.</p>
        </div>
        <button
          onClick={() => openEdit()}
          className="inline-flex items-center justify-center gap-2 bg-amber-400 text-heading font-bold px-6 py-3 rounded-xl hover:bg-amber-500 shadow-sm transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" /> Add Inspection
        </button>
      </div>

      {/* Summary tiles double as filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {([
          { key: 'overdue', label: 'Overdue', icon: AlertTriangle, tone: 'text-red-600 bg-red-50' },
          { key: 'due_soon', label: `Due in ${DUE_SOON_DAYS} days`, icon: Clock, tone: 'text-amber-600 bg-amber-50' },
          { key: 'ok', label: 'Current', icon: CalendarCheck, tone: 'text-brand-600 bg-brand-50' },
        ] as const).map(tile => (
          <button
            key={tile.key}
            onClick={() => setFilter(f => (f === tile.key ? 'all' : tile.key))}
            className={`text-left bg-white border rounded-2xl p-5 flex items-center gap-4 transition-all hover:shadow-md ${filter === tile.key ? 'border-brand-600 ring-4 ring-brand-600/10' : 'border-border'}`}
          >
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${tile.tone}`}>
              <tile.icon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-black text-heading">{counts[tile.key]}</div>
              <div className="text-xs font-bold uppercase tracking-widest text-muted">{tile.label}</div>
            </div>
          </button>
        ))}
      </div>

      {inspections.length === 0 ? (
        <div className="py-20 bg-white border border-dashed border-brand-200 rounded-[2.5rem] text-center">
          <ClipboardCheck className="w-16 h-16 text-border mx-auto mb-4" />
          <h3 className="text-xl font-bold text-heading mb-2">No inspections tracked yet</h3>
          <p className="text-muted max-w-sm mx-auto mb-6">Add fire, health, licensing, and maintenance inspections to see what’s due and what’s overdue.</p>
          <button onClick={() => openEdit()} className="text-brand-600 font-bold hover:underline">Add your first inspection →</button>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center mb-4">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-subtle absolute left-4 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by type, title, or vendor…" className={`${inputClass} pl-10`} />
            </div>
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')} className="text-sm font-bold text-brand-600 hover:underline">Clear filter</button>
            )}
          </div>

          <div className="bg-white border border-border rounded-[1.5rem] overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface text-[10px] uppercase tracking-widest text-muted">
                  <tr>
                    <th className="text-left font-bold px-5 py-3">Inspection</th>
                    <th className="text-left font-bold px-5 py-3">Interval</th>
                    <th className="text-left font-bold px-5 py-3">Last Inspection</th>
                    <th className="text-left font-bold px-5 py-3">Due Date</th>
                    <th className="text-left font-bold px-5 py-3">Vendor</th>
                    <th className="text-right font-bold px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-10 text-center text-muted">No inspections match.</td></tr>
                  ) : visible.map(i => {
                    const status = inspectionStatus(i.next_due_date)
                    const days = i.next_due_date ? daysUntil(i.next_due_date) : null
                    return (
                      <tr key={i.id} className="hover:bg-[#fafcfb]">
                        <td className="px-5 py-4">
                          <div className="font-bold text-heading">{i.inspection_type}</div>
                          {i.title && <div className="text-xs text-muted">{i.title}</div>}
                        </td>
                        <td className="px-5 py-4 text-text-muted whitespace-nowrap">{formatInterval(i.interval_value, i.interval_unit)}</td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="text-text-main">{formatDate(i.last_inspection_date)}</div>
                          {i.last_result && <div className={`text-xs font-bold ${RESULT_STYLES[i.last_result]}`}>{INSPECTION_RESULT_LABELS[i.last_result]}</div>}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="text-text-main">{formatDate(i.next_due_date)}</div>
                          <span className={`inline-block mt-1 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-widest ${STATUS_STYLES[status].className}`}>
                            {status === 'overdue' && days !== null ? `${Math.abs(days)}d overdue`
                              : status === 'due_soon' && days !== null ? (days === 0 ? 'Due today' : `In ${days}d`)
                              : STATUS_STYLES[status].label}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-text-muted">{i.vendor?.name || <span className="text-subtle">—</span>}</td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openRecord(i)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-800 whitespace-nowrap">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Record
                            </button>
                            <button onClick={() => openHistory(i)} aria-label="History and reports" title="History and reports" className="inline-flex items-center gap-1 p-2 text-muted hover:text-brand-600 hover:bg-brand-50 rounded-lg">
                              <History className="w-4 h-4" />
                              {fileCounts[i.id] > 0 && <span className="inline-flex items-center gap-0.5 text-xs font-bold text-brand-600"><Paperclip className="w-3.5 h-3.5" />{fileCounts[i.id]}</span>}
                            </button>
                            <button onClick={() => openEdit(i)} aria-label="Edit" title="Edit" className="p-2 text-muted hover:text-brand-600 hover:bg-brand-50 rounded-lg"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(i)} aria-label="Delete" title="Delete" className="p-2 text-muted hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-900/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-border flex items-center justify-between bg-surface">
              <h2 className="text-2xl font-black text-heading tracking-tight">{editing ? 'Edit Inspection' : 'New Inspection'}</h2>
              <button onClick={() => setEditOpen(false)} aria-label="Close" className="p-2 hover:bg-border rounded-full"><X className="w-5 h-5 text-muted" /></button>
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
                <p className="text-xs text-muted mt-2">Manage the type list in <Link href="/center/about#data" className="text-brand-600 font-bold hover:underline">Manage Data</Link>.</p>
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
                <p className="text-xs text-muted mt-2">Leave blank for one-time or as-needed inspections.</p>
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
                    <button type="button" onClick={() => updateForm({ due_overridden: false })} className="text-xs text-brand-600 font-bold hover:underline mt-2">Reset to calculated</button>
                  ) : (
                    <p className="text-xs text-muted mt-2">Calculated from last + interval</p>
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

              <div>
                <label className={labelClass}>Inspection Report &amp; Paperwork</label>
                {editExisting.length > 0 && (
                  <ul className="mb-2 space-y-1.5">
                    {editExisting.map(file => (
                      <li key={file.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
                        <button type="button" onClick={() => openStoredFile('inspection', file.id)} className="flex min-w-0 items-center gap-2 text-brand-600 hover:underline">
                          <FileText className="w-4 h-4 shrink-0" /><span className="truncate">{file.file_name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => { await removeReport(file); if (editing) loadEditReports(editing.id) }}
                          aria-label={`Delete ${file.file_name}`}
                          className="p-1 text-subtle hover:text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {renderPicker(editFiles, setEditFiles)}
                <p className="text-xs text-subtle mt-2">
                  {editing
                    ? 'New files are added to the most recent visit in History.'
                    : form.last_inspection_date ? 'Files are saved with the last inspection date above.' : 'Files are saved under "Other reports" in History.'}
                </p>
              </div>

              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>}

              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setEditOpen(false)} className="flex-1 py-3 px-6 rounded-xl border border-border font-bold text-muted hover:bg-surface">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-brand-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-brand-800 shadow-lg shadow-brand-600/20 flex items-center justify-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Inspection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Record modal ── */}
      {recording && recordForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-900/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-border flex items-start justify-between bg-surface">
              <div>
                <h2 className="text-2xl font-black text-heading tracking-tight">Record Inspection</h2>
                <p className="text-sm text-muted">{recording.inspection_type}{recording.title ? ` · ${recording.title}` : ''}</p>
              </div>
              <button onClick={() => { setRecording(null); setRecordForm(null) }} aria-label="Close" className="p-2 hover:bg-border rounded-full"><X className="w-5 h-5 text-muted" /></button>
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

              <div>
                <label className={labelClass}>Inspection Report &amp; Paperwork</label>
                {renderPicker(recordFiles, setRecordFiles, `${recording.inspection_type} report`)}
              </div>

              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>}

              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => { setRecording(null); setRecordForm(null) }} className="flex-1 py-3 px-6 rounded-xl border border-border font-bold text-muted hover:bg-surface">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-brand-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-brand-800 shadow-lg shadow-brand-600/20 flex items-center justify-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── History drawer ── */}
      {historyFor && (
        <div className="fixed inset-0 z-40 flex justify-end bg-brand-900/30 backdrop-blur-sm" onClick={() => setHistoryFor(null)}>
          <div className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-border flex items-start justify-between bg-surface">
              <div>
                <h2 className="text-xl font-black text-heading">Inspection History</h2>
                <p className="text-sm text-muted">{historyFor.inspection_type}{historyFor.title ? ` · ${historyFor.title}` : ''}</p>
              </div>
              <button onClick={() => setHistoryFor(null)} aria-label="Close" className="p-2 hover:bg-border rounded-full"><X className="w-5 h-5 text-muted" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {historyLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>
              ) : history.length === 0 ? (
                <div className="text-center text-muted py-10">No inspections recorded yet.</div>
              ) : (
                <ol className="space-y-4">
                  {history.map(log => (
                    <li key={log.id} className="border border-border rounded-2xl p-4 group">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-heading">{formatDate(log.performed_on)}</div>
                          {log.result && <div className={`text-xs font-bold ${RESULT_STYLES[log.result]}`}>{INSPECTION_RESULT_LABELS[log.result]}</div>}
                        </div>
                        <button onClick={() => deleteLog(log)} aria-label="Remove entry" className="p-1.5 text-subtle hover:text-red-500 hover:bg-red-50 rounded-lg sm:opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4" /></button>
                      </div>
                      {(log.vendor?.name || log.inspector_name) && (
                        <div className="text-sm text-text-muted mt-2">
                          {log.vendor?.name}{log.vendor?.name && log.inspector_name ? ' · ' : ''}{log.inspector_name}
                        </div>
                      )}
                      {log.notes && <p className="text-sm text-muted mt-2 whitespace-pre-wrap">{log.notes}</p>}
                      {renderReports(historyFiles.filter(f => f.log_id === log.id), log.id)}
                    </li>
                  ))}
                </ol>
              )}

              {!historyLoading && (historyFiles.some(f => !f.log_id) || history.length === 0) && (
                <div className="mt-6 border border-dashed border-border rounded-2xl p-4">
                  <div className="font-bold text-heading text-sm">Other reports</div>
                  <p className="text-xs text-muted">Paperwork not tied to a specific visit (e.g. a service contract or certificate).</p>
                  {renderReports(historyFiles.filter(f => !f.log_id), null)}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-border">
              <button onClick={() => openRecord(historyFor)} className="w-full inline-flex items-center justify-center gap-2 bg-brand-600 text-white font-bold py-3 rounded-xl hover:bg-brand-800">
                <CheckCircle2 className="w-4 h-4" /> Record Inspection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

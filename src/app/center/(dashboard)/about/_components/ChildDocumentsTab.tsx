'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CenterDocumentRequirement, DocumentCategory, RenewalType } from '@/lib/types'
import {
  FileText, Plus, Trash2, Settings2, CheckCircle2, Loader2, AlertCircle, Upload, X, Download,
  Lock, ChevronUp, ChevronDown, ClipboardList, ShieldCheck, HeartPulse, FileSignature, ListChecks,
} from 'lucide-react'
import { removeRequirementTemplate } from '@/app/actions/storage.actions'
import { openStoredFile, storeUpload, DOCUMENT_ACCEPT, type UploadSource } from '@/lib/files'
import { PhoneUploadButton } from '@/components/center/PhoneUploadDialog'
import { useLookups } from '@/hooks/use-lookups'
import { RENEWAL_TYPES, describeDue, describeRenewal } from '@/lib/compliance'
import { CHILD_SECTIONS, isChildSection, seedNcChildRequirements } from '@/lib/child-template'
import { useCenterContext } from '../../context'
import { showAlert, showConfirm } from '@/lib/dialog'

const NEW_SECTION = '__new__'
const CUSTOM_CHILD_PREFIX = 'child_custom_'

const SECTION_ICONS: Record<string, React.ElementType> = {
  child_enrollment: FileSignature,
  child_health: HeartPulse,
  child_policies: ClipboardList,
}

const LBL = 'block text-sm font-medium text-text-main mb-1.5'
const FLD = 'w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600'

// Child deadlines count from the child's first day of attendance
const CHILD_DUE_PRESETS: { days: number | null; label: string }[] = [
  { days: null, label: 'No deadline' },
  { days: 0, label: 'By the first day' },
  { days: 14, label: 'Within 2 weeks' },
  { days: 30, label: 'Within 30 days' },
  { days: 60, label: 'Within 2 months' },
  { days: 90, label: 'Within 90 days' },
  { days: 365, label: 'Within 1 year' },
]

// Renewing "when the policy changes" is a staff acknowledgment concept
const CHILD_RENEWALS = RENEWAL_TYPES.filter(r => r.id === 'none' || r.id === 'interval' || r.id === 'document_expiry')

type SectionDef = { id: string; label: string; description: string; custom?: boolean }

type FormState = {
  name: string
  notes: string
  category: DocumentCategory | ''
  section: string
  newSectionName: string
  isRequired: boolean
  isConfidential: boolean
  isConditional: boolean
  dueDays: string
  renewalType: RenewalType
  renewalMonths: string
}

const EMPTY_FORM: FormState = {
  name: '', notes: '', category: '', section: 'child_enrollment', newSectionName: '',
  isRequired: true, isConfidential: true, isConditional: false, dueDays: '', renewalType: 'none', renewalMonths: '12',
}

function customChildSectionId(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `${CUSTOM_CHILD_PREFIX}${slug || 'section'}`
}

function childSectionsFor(requirements: Pick<CenterDocumentRequirement, 'section' | 'section_label'>[]): SectionDef[] {
  const known = new Set(CHILD_SECTIONS.map(s => s.id))
  const custom = new Map<string, SectionDef>()
  for (const r of requirements) {
    if (known.has(r.section) || custom.has(r.section)) continue
    custom.set(r.section, { id: r.section, label: r.section_label || r.section.replace(CUSTOM_CHILD_PREFIX, '').replace(/-/g, ' '), description: 'Custom section', custom: true })
  }
  return [...CHILD_SECTIONS, ...custom.values()]
}

/** The child record checklist: what each child's file needs, when it is due and when it renews. */
export default function ChildDocumentsTab() {
  const supabase = createClient()
  const { centerId } = useCenterContext()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [requirements, setRequirements] = useState<CenterDocumentRequirement[]>([])

  const { data: lookupDocTypes } = useLookups('Document Type')
  const activeDocTypes = lookupDocTypes.filter(l => l.is_active)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const [templateFile, setTemplateFile] = useState<UploadSource | null>(null)
  const [existingTemplate, setExistingTemplate] = useState<{ key: string, bucket: string, name: string } | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState(false)

  async function loadRequirements() {
    if (!centerId) return
    const { data } = await supabase
      .from('center_document_requirements')
      .select('*')
      .eq('center_id', centerId)
      .eq('audience', 'child')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    setRequirements(data || [])
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRequirements()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId])

  const sectionList = useMemo(() => childSectionsFor(requirements), [requirements])

  const bySection = useMemo(() => {
    const map = new Map<string, CenterDocumentRequirement[]>()
    sectionList.forEach(s => map.set(s.id, []))
    requirements.forEach(r => map.get(r.section)?.push(r))
    return map
  }, [requirements, sectionList])

  function openNew(section?: string) {
    cancelEdit()
    setForm({ ...EMPTY_FORM, section: section ?? 'child_enrollment' })
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startEdit(req: CenterDocumentRequirement) {
    setEditingId(req.id)
    setForm({
      name: req.document_name,
      notes: req.notes || '',
      category: req.document_category,
      section: req.section,
      newSectionName: '',
      isRequired: req.is_required,
      isConfidential: req.is_confidential,
      isConditional: req.is_conditional,
      dueDays: req.due_within_days == null ? '' : String(req.due_within_days),
      renewalType: req.renewal_type,
      renewalMonths: String(req.renewal_months ?? 12),
    })
    setExistingTemplate(req.template_file_key && req.template_bucket_name
      ? { key: req.template_file_key, bucket: req.template_bucket_name, name: req.template_file_name || 'Attached Form' }
      : null)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setTemplateFile(null)
    setExistingTemplate(null)
    setShowForm(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!centerId) return

    const creatingSection = form.section === NEW_SECTION
    const newName = form.newSectionName.trim()
    if (creatingSection && !newName) return
    const sectionId = creatingSection ? customChildSectionId(newName) : form.section
    if (!isChildSection(sectionId)) return
    const sectionMeta = sectionList.find(s => s.id === sectionId)
    const sectionLabel = creatingSection ? newName : sectionMeta?.custom ? sectionMeta.label : null
    setSaving(true)

    let templateData: Record<string, string | null | undefined> = editingId ? {
      template_file_key: existingTemplate?.key,
      template_bucket_name: existingTemplate?.bucket,
      template_file_name: existingTemplate?.name,
    } : {}

    if (templateFile) {
      try {
        const uploaded = await storeUpload('template', templateFile)
        if (editingId && existingTemplate?.key) await removeRequirementTemplate(editingId)
        templateData = {
          template_file_key: uploaded.fileKey,
          template_bucket_name: uploaded.bucketName,
          template_file_name: uploaded.name,
        }
      } catch (err) {
        showAlert(err instanceof Error ? err.message : 'Failed to upload the blank form')
        setSaving(false)
        return
      }
    }

    const payload = {
      center_id: centerId,
      audience: 'child',
      document_name: form.name.trim(),
      notes: form.notes.trim() || null,
      document_category: form.category,
      section: sectionId,
      section_label: sectionLabel,
      // The parent's signed form or a medical record: supplied by the subject, never a center-only record
      evidence_type: 'staff_document',
      is_internal: false,
      is_required: form.isRequired,
      is_confidential: form.isConfidential,
      is_conditional: form.isConditional,
      due_within_days: form.dueDays === '' ? null : Math.max(0, parseInt(form.dueDays, 10) || 0),
      renewal_type: form.renewalType,
      renewal_months: form.renewalType === 'interval' ? Math.max(1, parseInt(form.renewalMonths, 10) || 12) : null,
      applies_to: null,
      applies_to_class: null,
      ...templateData,
    }

    const { error } = editingId
      ? await supabase.from('center_document_requirements').update(payload).eq('id', editingId)
      : await supabase.from('center_document_requirements').insert({ ...payload, sort_order: (bySection.get(sectionId)?.length ?? 0) })

    setSaving(false)
    if (error) {
      showAlert(`Failed to ${editingId ? 'update' : 'create'} the requirement: ${error.message}`)
      return
    }
    cancelEdit()
    loadRequirements()
  }

  async function handleRemoveTemplate() {
    if (!editingId || !existingTemplate) {
      setExistingTemplate(null)
      return
    }
    if (!await showConfirm('Are you sure you want to remove the blank form from this requirement?')) return
    setDeletingTemplate(true)
    const res = await removeRequirementTemplate(editingId)
    if (res.success) {
      setExistingTemplate(null)
      loadRequirements()
    } else {
      showAlert(res.error)
    }
    setDeletingTemplate(false)
  }

  async function deleteRequirement(req: CenterDocumentRequirement) {
    // Deleting a rule removes every child's status for it. Say how many are affected before asking.
    const [{ count: records }, { count: files }] = await Promise.all([
      supabase.from('child_documents').select('id', { count: 'exact', head: true }).eq('requirement_id', req.id).neq('status', 'missing'),
      supabase.from('child_files').select('id', { count: 'exact', head: true }).eq('requirement_id', req.id),
    ])
    const affected = records ?? 0
    const filed = files ?? 0
    const warning = affected === 0 && filed === 0
      ? `Delete "${req.document_name}"? It will be removed from every child's checklist.`
      : `Delete "${req.document_name}"? ${affected} child record${affected === 1 ? ' has' : 's have'} a status, review or date for it and ${filed} uploaded file${filed === 1 ? '' : 's'} ${filed === 1 ? 'is' : 'are'} filed under it. `
        + 'The statuses, dates and comments will be deleted. The uploaded files are kept on each child but become unfiled. '
        + 'To stop requiring it without losing anything, edit it and untick Mandatory instead.'
    if (!await showConfirm(warning)) return

    if (req.template_file_key) {
      const res = await removeRequirementTemplate(req.id)
      if (!res.success) {
        showAlert(res.error)
        return
      }
    }

    const { error } = await supabase.from('center_document_requirements').delete().eq('id', req.id)
    if (error) {
      showAlert('Failed to delete the requirement: ' + error.message)
      return
    }
    if (editingId === req.id) cancelEdit()
    setRequirements(prev => prev.filter(r => r.id !== req.id))
  }

  async function move(section: string, index: number, delta: -1 | 1) {
    const list = [...(bySection.get(section) ?? [])]
    const target = index + delta
    if (target < 0 || target >= list.length) return
    ;[list[index], list[target]] = [list[target], list[index]]

    const changed = list
      .map((r, i) => ({ id: r.id, sort_order: i, before: r.sort_order }))
      .filter(r => r.sort_order !== r.before)

    setRequirements(prev => prev.map(r => {
      const c = changed.find(x => x.id === r.id)
      return c ? { ...r, sort_order: c.sort_order } : r
    }).sort((a, b) => a.sort_order - b.sort_order))

    const results = await Promise.all(changed.map(c =>
      supabase.from('center_document_requirements').update({ sort_order: c.sort_order }).eq('id', c.id)
    ))
    if (results.some(r => r.error)) {
      showAlert('Failed to save the new order')
      loadRequirements()
    }
  }

  async function restoreNcChecklist() {
    if (!centerId) return
    if (!await showConfirm('Add the North Carolina child record checklist? Items you already have are skipped, and everything can be edited afterwards.')) return
    setSeeding(true)
    const res = await seedNcChildRequirements(supabase, centerId)
    setSeeding(false)
    if (!res.success) {
      showAlert('Failed to add the checklist: ' + res.error)
      return
    }
    showAlert(res.added === 0 ? 'The checklist was already complete.' : `Added ${res.added} requirement${res.added === 1 ? '' : 's'}.`)
    loadRequirements()
  }

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-64 bg-white rounded-2xl border border-border"></div>
    </div>
  }

  const presetMatch = CHILD_DUE_PRESETS.some(p => String(p.days ?? '') === form.dueDays)

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-extrabold text-heading mb-1">Child Record Requirements</h2>
          <p className="text-muted">The checklist every child&apos;s file is tracked against: what is needed, when it is due (counted from the first day of attendance) and when it renews.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={restoreNcChecklist}
            disabled={seeding}
            className="inline-flex items-center gap-2 font-semibold px-5 py-3 rounded-xl border border-border bg-white text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-50"
          >
            {seeding ? <Loader2 className="w-5 h-5 animate-spin" /> : <ListChecks className="w-5 h-5" />} NC checklist
          </button>
          <button
            onClick={() => openNew(NEW_SECTION)}
            className="inline-flex items-center gap-2 font-semibold px-5 py-3 rounded-xl border border-border bg-white text-brand-600 hover:bg-brand-50 transition-colors"
          >
            <Plus className="w-5 h-5" /> New Section
          </button>
          <button
            onClick={showForm ? cancelEdit : () => openNew()}
            className={`inline-flex items-center justify-center gap-2 font-semibold px-5 py-3 rounded-xl shadow-sm transition-colors ${showForm ? 'bg-white text-muted border border-border hover:bg-gray-50' : 'bg-brand-600 text-white hover:bg-brand-800'}`}
          >
            {showForm ? 'Cancel' : <><Plus className="w-5 h-5" /> Add Requirement</>}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-8 bg-white border-2 border-brand-600 rounded-2xl p-6 shadow-lg">
          <h2 className="text-lg font-bold text-text-main mb-5">{editingId ? 'Edit Requirement' : 'New Requirement'}</h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className={LBL}>Requirement Name *</label>
                <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Field Trip Permission" className={FLD} />
              </div>
              <div>
                <label className={LBL}>Document Type *</label>
                <select required value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className={FLD}>
                  <option value="" disabled>Select…</option>
                  {activeDocTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className={LBL}>Section</label>
              <select value={form.section} onChange={e => setForm({ ...form, section: e.target.value })} className={`${FLD} md:max-w-sm`}>
                {sectionList.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                <option value={NEW_SECTION}>+ New section…</option>
              </select>
              {form.section === NEW_SECTION && (
                <input
                  required
                  autoFocus
                  value={form.newSectionName}
                  onChange={e => setForm({ ...form, newSectionName: e.target.value })}
                  placeholder="Section name, e.g. Enrichment Permissions"
                  className={`${FLD} mt-2 md:max-w-sm`}
                />
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={LBL}>Due</label>
                <select
                  value={presetMatch ? form.dueDays : 'custom'}
                  onChange={e => setForm({ ...form, dueDays: e.target.value === 'custom' ? (form.dueDays || '45') : e.target.value })}
                  className={FLD}
                >
                  {CHILD_DUE_PRESETS.map(p => <option key={p.label} value={p.days ?? ''}>{p.label}</option>)}
                  <option value="custom">Custom number of days…</option>
                </select>
                {!presetMatch && (
                  <input type="number" min={0} value={form.dueDays} onChange={e => setForm({ ...form, dueDays: e.target.value })} className={`${FLD} mt-2`} placeholder="Days after the first day of attendance" />
                )}
                <p className="text-[11px] text-subtle mt-1.5">Counted from the child&apos;s first day of attendance (or enrollment date if not set).</p>
              </div>
              <div>
                <label className={LBL}>Renewal</label>
                <select value={form.renewalType} onChange={e => setForm({ ...form, renewalType: e.target.value as RenewalType })} className={FLD}>
                  {CHILD_RENEWALS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                {form.renewalType === 'interval' && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm text-muted">Every</span>
                    <input type="number" min={1} value={form.renewalMonths} onChange={e => setForm({ ...form, renewalMonths: e.target.value })} className={`${FLD} w-24`} />
                    <span className="text-sm text-muted">months</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className={LBL}>Instructions (optional)</label>
              <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={`${FLD} resize-none`} placeholder="What qualifies, who signs it, special rules…" />
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <label className="flex items-center gap-2 text-sm text-text-main">
                <input type="checkbox" checked={form.isRequired} onChange={e => setForm({ ...form, isRequired: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                Mandatory
              </label>
              <label className="flex items-center gap-2 text-sm text-text-main">
                <input type="checkbox" checked={form.isConditional} onChange={e => setForm({ ...form, isConditional: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                If applicable (can be marked N/A per child)
              </label>
              <label className="flex items-center gap-2 text-sm text-text-main">
                <input type="checkbox" checked={form.isConfidential} onChange={e => setForm({ ...form, isConfidential: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                <Lock className="w-3.5 h-3.5 text-amber-600" /> Confidential — only Owner/Admin roles can open files
              </label>
            </div>

            <div className="border-t border-border pt-5">
              <label className={LBL}>Blank form or instructions (optional)</label>
              {existingTemplate && !templateFile ? (
                <div className="flex items-center justify-between p-3 bg-surface rounded-xl border border-border">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-brand-600" />
                    <div>
                      <p className="text-xs font-bold text-text-main">{existingTemplate.name}</p>
                      <button type="button" onClick={() => editingId && openStoredFile('template', editingId)} className="text-[11px] text-brand-600 hover:underline font-bold">
                        View attached file
                      </button>
                    </div>
                  </div>
                  <button type="button" disabled={deletingTemplate} onClick={handleRemoveTemplate} className="p-1.5 text-muted hover:text-red-500 transition-colors" title="Remove file">
                    {deletingTemplate ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input type="file" id="child_template_upload" className="hidden" accept={DOCUMENT_ACCEPT} onChange={e => setTemplateFile(e.target.files?.[0] || null)} />
                  <div className="flex max-w-xl items-stretch gap-2">
                    <label htmlFor="child_template_upload" className="flex min-w-0 flex-1 items-center gap-3 p-3 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-brand-600 hover:bg-surface transition-all">
                      {templateFile ? (
                        <>
                          <CheckCircle2 className="w-5 h-5 shrink-0 text-brand-600" />
                          <span className="min-w-0 flex-1 truncate text-sm font-bold text-text-main">{templateFile.name}</span>
                          <button type="button" onClick={e => { e.preventDefault(); setTemplateFile(null) }} className="text-xs text-red-500 font-bold hover:underline">Remove</button>
                        </>
                      ) : (
                        <>
                          <Upload className="w-5 h-5 shrink-0 text-subtle" />
                          <span className="text-sm text-muted">Upload a blank form <span className="text-subtle">(PDF, Word or image, up to 15 MB)</span></span>
                        </>
                      )}
                    </label>
                    {!templateFile && (
                      <PhoneUploadButton kind="template" variant="qr" label={form.name.trim() || 'Blank form'} onReceived={upload => { setTemplateFile(upload) }} />
                    )}
                  </div>
                  {existingTemplate && templateFile && (
                    <p className="text-[11px] text-amber-600 font-bold flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> This will replace the current file when you save.
                    </p>
                  )}
                </div>
              )}
              <p className="text-[11px] text-subtle mt-2">Blank forms are not child records. Do not upload a completed form here.</p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={cancelEdit} className="px-5 py-2.5 rounded-xl border border-border text-sm font-medium text-muted hover:bg-surface">Cancel</button>
              <button type="submit" disabled={saving || !form.name.trim() || !form.category || (form.section === NEW_SECTION && !form.newSectionName.trim())} className="inline-flex items-center gap-2 bg-brand-600 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-brand-800 disabled:opacity-50">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} {editingId ? 'Update Requirement' : 'Create Requirement'}
              </button>
            </div>
          </form>
        </div>
      )}

      {requirements.length === 0 && !showForm && (
        <div className="mb-8 bg-brand-50 border border-dashed border-brand-200 rounded-2xl p-8 text-center">
          <Settings2 className="w-10 h-10 text-brand-600 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-heading mb-2">No child requirements yet</h2>
          <p className="text-text-muted max-w-md mx-auto">Add the North Carolina checklist in one click, or add requirements one by one.</p>
        </div>
      )}

      <div className="space-y-8">
        {sectionList.map(section => {
          const items = bySection.get(section.id) ?? []
          if (requirements.length === 0 || (items.length === 0 && section.custom)) return null
          const Icon = SECTION_ICONS[section.id] ?? ClipboardList
          return (
            <section key={section.id} className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-border bg-surface px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon className="h-5 w-5" /></span>
                  <div>
                    <h2 className="text-lg font-bold text-text-main">{section.label}</h2>
                    <p className="text-xs text-muted">{items.length} item{items.length === 1 ? '' : 's'} · {section.description}</p>
                  </div>
                </div>
                <button type="button" onClick={() => openNew(section.id)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-800">
                  <Plus className="h-4 w-4" /> Add New
                </button>
              </div>

              {items.length === 0 ? (
                <p className="px-6 py-5 text-sm text-muted">Nothing here yet. Use Add New to add the first item.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left">
                    <thead>
                      <tr className="border-b border-border text-[15px] font-bold text-text-main">
                        <th scope="col" className="px-6 py-4">Requirement</th>
                        <th scope="col" className="px-4 py-4">Due</th>
                        <th scope="col" className="px-4 py-4">Renewal</th>
                        <th scope="col" className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-sm font-normal text-text-muted">
                      {items.map((req, index) => (
                        <tr key={req.id} className="align-top hover:bg-surface transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap items-center gap-1.5 text-text-main">
                              {req.document_name}
                              {req.is_confidential && <Lock className="h-3.5 w-3.5 text-amber-600" aria-label="Confidential" />}
                              {req.is_conditional && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">If applicable</span>}
                              {!req.is_required && !req.is_conditional && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">Optional</span>}
                              {req.template_file_key && <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] text-brand-600"><Download className="h-3 w-3" /> Form</span>}
                            </div>
                            {req.notes && <div className="mt-0.5 max-w-md text-xs text-muted line-clamp-2">{req.notes}</div>}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">{describeDue(req.due_within_days)}</td>
                          <td className="px-4 py-4 whitespace-nowrap">{describeRenewal(req) || '—'}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => move(section.id, index, -1)} disabled={index === 0} className="rounded-lg p-1.5 text-muted hover:bg-brand-50 disabled:opacity-30" title="Move up"><ChevronUp className="h-4 w-4" /></button>
                              <button onClick={() => move(section.id, index, 1)} disabled={index === items.length - 1} className="rounded-lg p-1.5 text-muted hover:bg-brand-50 disabled:opacity-30" title="Move down"><ChevronDown className="h-4 w-4" /></button>
                              <button onClick={() => startEdit(req)} className="rounded-lg p-1.5 text-brand-600 hover:bg-brand-50" title="Edit"><Settings2 className="h-4 w-4" /></button>
                              <button onClick={() => deleteRequirement(req)} className="rounded-lg p-1.5 text-subtle hover:bg-red-50 hover:text-red-500" title="Delete"><Trash2 className="h-4 w-4" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        })}
      </div>

      <p className="mt-6 text-xs text-subtle flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5" /> You are responsible for verifying that child records meet your state&apos;s licensing requirements.
      </p>
    </div>
  )
}

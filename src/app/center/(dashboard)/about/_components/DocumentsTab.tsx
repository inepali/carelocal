'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  CenterDocumentRequirement, DocumentCategory, EMPLOYMENT_CLASS_LABELS, EmploymentClass,
  EvidenceType, RenewalType, RequirementSection,
} from '@/lib/types'
import { useStaffRoles } from '@/lib/hooks/useStaffRoles'
import {
  FileText, Plus, Trash2, Settings2, CheckCircle2, Loader2, AlertCircle, Upload, X, Download,
  Lock, ChevronUp, ChevronDown, LayoutTemplate, ShieldCheck, GraduationCap, ClipboardList, UserSquare2, HeartPulse,
} from 'lucide-react'
import { removeRequirementTemplate } from '@/app/actions/storage.actions'
import { openStoredFile, storeUpload, DOCUMENT_ACCEPT, type UploadSource } from '@/lib/files'
import { PhoneUploadButton } from '@/components/center/PhoneUploadDialog'
import { useLookups } from '@/hooks/use-lookups'
import { lookupLabel } from '@/lib/lookups'
import {
  sectionsFor, customSectionId, EVIDENCE_TYPES, RENEWAL_TYPES, DUE_PRESETS, describeDue, describeRenewal, evidenceLabel,
} from '@/lib/compliance'
import { templateItemKey, type RequirementTemplate } from '@/lib/requirement-templates'
import { useCenterContext } from '../../context'
import { showAlert, showConfirm } from '@/lib/dialog'

const NEW_SECTION = '__new__'

const SECTION_ICONS: Record<string, React.ElementType> = {
  personnel: UserSquare2,
  health: HeartPulse,
  training: GraduationCap,
  health_safety: ShieldCheck,
  policies: ClipboardList,
  evaluations: FileText,
}

const LBL = 'block text-sm font-medium text-text-main mb-1.5'
const FLD = 'w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600'
const CHIP = (on: boolean) => `px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${on
  ? 'bg-brand-600 text-white border-brand-600'
  : 'bg-white text-muted border-border hover:bg-gray-50'}`

type FormState = {
  name: string
  notes: string
  category: DocumentCategory | ''
  section: RequirementSection   // a section id, or NEW_SECTION while naming a new one
  newSectionName: string
  evidenceType: EvidenceType
  isRequired: boolean
  isConfidential: boolean
  isConditional: boolean
  dueDays: string            // '' = no deadline
  renewalType: RenewalType
  renewalMonths: string
  roles: string[]
  classes: EmploymentClass[]
}

const EMPTY_FORM: FormState = {
  name: '', notes: '', category: '', section: 'personnel', newSectionName: '', evidenceType: 'staff_document',
  isRequired: true, isConfidential: false, isConditional: false, dueDays: '', renewalType: 'none',
  renewalMonths: '12', roles: [], classes: [],
}

export default function DocumentsTab() {
  const supabase = createClient()
  const { domainKey } = useCenterContext()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [requirements, setRequirements] = useState<CenterDocumentRequirement[]>([])
  const [centerId, setCenterId] = useState<string | null>(null)
  const { roles: staffRoles } = useStaffRoles(centerId)

  const { data: lookupDocTypes } = useLookups('Document Type')
  const activeDocTypes = lookupDocTypes.filter(l => l.is_active)

  // Form
  const [showForm, setShowForm] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [applyingTemplate, setApplyingTemplate] = useState<string | null>(null)

  // Blank form / template file
  const [templateFile, setTemplateFile] = useState<UploadSource | null>(null)
  const [existingTemplate, setExistingTemplate] = useState<{ key: string, bucket: string, name: string } | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState(false)

  const [templates, setTemplates] = useState<RequirementTemplate[]>([])

  useEffect(() => {
    loadRequirements()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function getAdminCenterId() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data: admin } = await supabase.from('center_admins').select('center_id').eq('user_id', user.id).single()
    return admin?.center_id as string | null
  }

  async function loadRequirements() {
    const id = centerId ?? await getAdminCenterId()
    if (id) {
      setCenterId(id)
      const { data } = await supabase
        .from('center_document_requirements')
        .select('*')
        .eq('center_id', id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      setRequirements(data || [])

      const { data: saved } = await supabase
        .from('requirement_templates')
        .select('id, name, description, domain_key, items, created_at')
        .eq('domain_key', domainKey)
        .order('created_at', { ascending: false })
      setTemplates((saved as RequirementTemplate[] | null) ?? [])
    }
    setLoading(false)
  }

  const sectionList = useMemo(() => sectionsFor(requirements), [requirements])

  const bySection = useMemo(() => {
    const map = new Map<RequirementSection, CenterDocumentRequirement[]>()
    sectionList.forEach(s => map.set(s.id, []))
    requirements.forEach(r => map.get(r.section)?.push(r))
    return map
  }, [requirements, sectionList])

  // ── Form ──

  function openNew(section?: RequirementSection) {
    cancelEdit()
    setForm({
      ...EMPTY_FORM,
      section: section ?? 'personnel',
      isConfidential: section === 'health',
    })
    setShowForm(true)
    setShowTemplates(false)
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
      evidenceType: req.evidence_type,
      isRequired: req.is_required,
      isConfidential: req.is_confidential,
      isConditional: req.is_conditional,
      dueDays: req.due_within_days == null ? '' : String(req.due_within_days),
      renewalType: req.renewal_type,
      renewalMonths: String(req.renewal_months ?? 12),
      roles: req.applies_to || [],
      classes: req.applies_to_class || [],
    })
    setExistingTemplate(req.template_file_key && req.template_bucket_name
      ? { key: req.template_file_key, bucket: req.template_bucket_name, name: req.template_file_name || 'Attached Form' }
      : null)
    setShowForm(true)
    setShowTemplates(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setTemplateFile(null)
    setExistingTemplate(null)
    setShowForm(false)
  }

  function toggle<T>(list: T[], value: T) {
    return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!centerId) return

    const creatingSection = form.section === NEW_SECTION
    const newName = form.newSectionName.trim()
    if (creatingSection && !newName) return
    const sectionId = creatingSection ? customSectionId(newName) : form.section
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
        // Replacing an existing template: remove the old file (clears the row's template columns first)
        if (editingId && existingTemplate?.key) await removeRequirementTemplate(editingId)
        templateData = {
          template_file_key: uploaded.fileKey,
          template_bucket_name: uploaded.bucketName,
          template_file_name: uploaded.name,
        }
      } catch (err) {
        showAlert(err instanceof Error ? err.message : 'Failed to upload template file')
        setSaving(false)
        return
      }
    }

    const payload = {
      center_id: centerId,
      document_name: form.name.trim(),
      notes: form.notes.trim() || null,
      document_category: form.category,
      section: sectionId,
      section_label: sectionLabel,
      evidence_type: form.evidenceType,
      is_internal: form.evidenceType === 'center_record', // center records are hidden from staff
      is_required: form.isRequired,
      is_confidential: form.isConfidential,
      is_conditional: form.isConditional,
      due_within_days: form.dueDays === '' ? null : Math.max(0, parseInt(form.dueDays, 10) || 0),
      renewal_type: form.renewalType,
      renewal_months: form.renewalType === 'interval' ? Math.max(1, parseInt(form.renewalMonths, 10) || 12) : null,
      applies_to: form.roles.length > 0 ? form.roles : null,
      applies_to_class: form.classes.length > 0 ? form.classes : null,
      ...templateData,
    }

    const { error } = editingId
      ? await supabase.from('center_document_requirements').update(payload).eq('id', editingId)
      : await supabase.from('center_document_requirements').insert({
          ...payload,
          sort_order: (bySection.get(sectionId)?.length ?? 0),
        })

    setSaving(false)
    if (error) {
      showAlert(`Failed to ${editingId ? 'update' : 'create'} requirement: ${error.message}`)
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
    if (!await showConfirm('Are you sure you want to remove the template from this requirement?')) return

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
    if (!await showConfirm(`Delete "${req.document_name}"? It will be removed from every staff member's checklist.`)) return

    // Remove the template file while the row (used for the permission check) still exists
    if (req.template_file_key) {
      const res = await removeRequirementTemplate(req.id)
      if (!res.success) {
        showAlert(res.error)
        return
      }
    }

    const { error } = await supabase.from('center_document_requirements').delete().eq('id', req.id)
    if (error) {
      showAlert('Failed to delete requirement: ' + error.message)
      return
    }
    if (editingId === req.id) cancelEdit()
    setRequirements(prev => prev.filter(r => r.id !== req.id))
  }

  async function publishPolicyUpdate(req: CenterDocumentRequirement) {
    if (!await showConfirm(`Mark "${req.document_name}" as updated? Every employee it applies to will need to acknowledge the new version (currently version ${req.policy_version}). Attach the updated document first if it changed.`)) return
    const { error } = await supabase.rpc('publish_policy_update', { p_requirement_id: req.id })
    if (error) showAlert('Failed to publish update: ' + error.message)
    else loadRequirements()
  }

  // ── Reorder within a section ──

  async function move(section: RequirementSection, index: number, delta: -1 | 1) {
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

  // ── Templates ──

  function newItems(template: RequirementTemplate) {
    const existing = new Set(requirements.map(r => r.template_key).filter(Boolean))
    return template.items.filter(i => !existing.has(templateItemKey(template.id, i)))
  }

  async function applyTemplate(template: RequirementTemplate) {
    if (!centerId) return
    const items = newItems(template)
    if (items.length === 0) return
    if (!await showConfirm(`Add ${items.length} requirement${items.length === 1 ? '' : 's'} from "${template.name}"? You can edit or remove them afterwards.`)) return

    setApplyingTemplate(template.id)
    const nextSort: Partial<Record<RequirementSection, number>> = {}
    sectionList.forEach(s => { nextSort[s.id] = bySection.get(s.id)?.length ?? 0 })

    const rows = items.map(item => ({
      center_id: centerId,
      template_key: templateItemKey(template.id, item),
      document_name: item.document_name,
      notes: item.notes,
      document_category: item.document_category,
      section: item.section,
      section_label: item.section_label,
      evidence_type: item.evidence_type,
      is_internal: item.evidence_type === 'center_record',
      is_required: !item.is_conditional,
      is_confidential: item.is_confidential,
      is_conditional: item.is_conditional,
      due_within_days: item.due_within_days,
      renewal_type: item.renewal_type,
      renewal_months: item.renewal_type === 'interval' ? item.renewal_months ?? 12 : null,
      group_label: null,
      applies_to: null,
      applies_to_class: item.applies_to_class,
      sort_order: nextSort[item.section] = (nextSort[item.section] ?? 0) + 1,
    }))

    const { error } = await supabase.from('center_document_requirements').insert(rows)
    setApplyingTemplate(null)
    if (error) {
      showAlert('Failed to import template: ' + error.message)
      return
    }
    setShowTemplates(false)
    loadRequirements()
  }

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-64 bg-white rounded-2xl border border-border"></div>
    </div>
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-extrabold text-heading mb-1">Document Requirements</h2>
          <p className="text-muted">The personnel file checklist for your staff — what is needed, when it is due and when it renews.</p>
        </div>
        <div className="flex gap-2">
          {templates.length > 0 && (
            <button
              onClick={() => { setShowTemplates(v => !v); setShowForm(false) }}
              className="inline-flex items-center gap-2 font-semibold px-5 py-3 rounded-xl border border-border bg-white text-brand-600 hover:bg-brand-50 transition-colors"
            >
              <LayoutTemplate className="w-5 h-5" /> Import Template
            </button>
          )}
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

      {/* ── Templates ── */}
      {showTemplates && (
        <div className="mb-8 grid gap-4 md:grid-cols-2">
          {templates.map(t => {
            const count = newItems(t).length
            return (
              <div key={t.id} className="rounded-2xl border border-border bg-white p-6 shadow-sm flex flex-col">
                <div className="flex items-start gap-3 mb-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><LayoutTemplate className="h-5 w-5" /></span>
                  <div>
                    <h3 className="font-bold text-text-main">{t.name}</h3>
                    <p className="text-sm text-muted mt-0.5">{t.description || 'Shared checklist'}</p>
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between pt-3">
                  <span className="text-xs text-muted">{t.items.length} items · {count === 0 ? 'all added' : `${count} new`}</span>
                  <button
                    onClick={() => applyTemplate(t)}
                    disabled={count === 0 || applyingTemplate !== null}
                    className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-800 disabled:opacity-50"
                  >
                    {applyingTemplate === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {count === 0 ? 'Imported' : 'Import'}
                  </button>
                </div>
              </div>
            )
          })}
          <p className="md:col-span-2 text-xs text-subtle">
            Verify imported items against your state&apos;s current rules; every item can be edited after it is added.
          </p>
        </div>
      )}

      {/* ── Add / edit form ── */}
      {showForm && (
        <div className="mb-8 bg-white border-2 border-brand-600 rounded-2xl p-6 shadow-lg">
          <h2 className="text-lg font-bold text-text-main mb-5">{editingId ? 'Edit Requirement' : 'New Requirement'}</h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className={LBL}>Requirement Name *</label>
                <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. TB Screening or Test Results" className={FLD} />
              </div>
              <div>
                <label className={LBL}>Document Type *</label>
                <select required value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className={FLD}>
                  <option value="" disabled>Select…</option>
                  {activeDocTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className={LBL}>Section</label>
                <select
                  value={form.section}
                  onChange={e => {
                    const section = e.target.value as RequirementSection
                    setForm({ ...form, section, isConfidential: section === 'health' ? true : form.isConfidential })
                  }}
                  className={FLD}
                >
                  {sectionList.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  <option value={NEW_SECTION}>+ New section…</option>
                </select>
                {form.section === NEW_SECTION && (
                  <input
                    required
                    autoFocus
                    value={form.newSectionName}
                    onChange={e => setForm({ ...form, newSectionName: e.target.value })}
                    placeholder="Section name, e.g. Licensing & Clearances"
                    className={`${FLD} mt-2`}
                  />
                )}
              </div>
              <div className="md:col-span-2">
                <label className={LBL}>How it is fulfilled</label>
                <select value={form.evidenceType} onChange={e => setForm({ ...form, evidenceType: e.target.value as EvidenceType })} className={FLD}>
                  {EVIDENCE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label} — {t.hint}</option>)}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={LBL}>Due</label>
                <select
                  value={DUE_PRESETS.some(p => String(p.days ?? '') === form.dueDays) ? form.dueDays : 'custom'}
                  onChange={e => setForm({ ...form, dueDays: e.target.value === 'custom' ? (form.dueDays || '45') : e.target.value })}
                  className={FLD}
                >
                  {DUE_PRESETS.map(p => <option key={p.label} value={p.days ?? ''}>{p.label}</option>)}
                  <option value="custom">Custom number of days…</option>
                </select>
                {!DUE_PRESETS.some(p => String(p.days ?? '') === form.dueDays) && (
                  <input type="number" min={0} value={form.dueDays} onChange={e => setForm({ ...form, dueDays: e.target.value })} className={`${FLD} mt-2`} placeholder="Days after employment start" />
                )}
                <p className="text-[11px] text-subtle mt-1.5">Counted from each employee&apos;s employment start date.</p>
              </div>
              <div>
                <label className={LBL}>Renewal</label>
                <select value={form.renewalType} onChange={e => setForm({ ...form, renewalType: e.target.value as RenewalType })} className={FLD}>
                  {RENEWAL_TYPES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
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
              <label className={LBL}>Instructions for staff (optional)</label>
              <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={`${FLD} resize-none`} placeholder="What qualifies, where to get it, special rules…" />
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <label className="flex items-center gap-2 text-sm text-text-main">
                <input type="checkbox" checked={form.isRequired} onChange={e => setForm({ ...form, isRequired: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                Mandatory
              </label>
              <label className="flex items-center gap-2 text-sm text-text-main">
                <input type="checkbox" checked={form.isConditional} onChange={e => setForm({ ...form, isConditional: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                If applicable (can be marked N/A per employee)
              </label>
              <label className="flex items-center gap-2 text-sm text-text-main">
                <input type="checkbox" checked={form.isConfidential} onChange={e => setForm({ ...form, isConfidential: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                <Lock className="w-3.5 h-3.5 text-amber-600" /> Confidential — only Owner/Admin roles can open files
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={LBL}>Applies to roles</label>
                <div className="flex flex-wrap gap-2">
                  {staffRoles.map(role => (
                    <button key={role.value} type="button" onClick={() => setForm({ ...form, roles: toggle(form.roles, role.value) })} className={CHIP(form.roles.includes(role.value))}>
                      {role.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-subtle mt-1.5">None selected = all roles.</p>
              </div>
              <div>
                <label className={LBL}>Applies to employee class</label>
                <div className="flex flex-wrap gap-2">
                  {(Object.entries(EMPLOYMENT_CLASS_LABELS) as [EmploymentClass, string][]).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setForm({ ...form, classes: toggle(form.classes, value) })} className={CHIP(form.classes.includes(value))}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-subtle mt-1.5">None selected = regular and substitute staff.</p>
              </div>
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
                  <input type="file" id="template_upload" className="hidden" accept={DOCUMENT_ACCEPT} onChange={e => setTemplateFile(e.target.files?.[0] || null)} />
                  <div className="flex max-w-xl items-stretch gap-2">
                    <label htmlFor="template_upload" className="flex min-w-0 flex-1 items-center gap-3 p-3 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-brand-600 hover:bg-surface transition-all">
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

      {/* ── Sections ── */}
      {requirements.length === 0 && !showForm && (
        <div className="mb-8 bg-brand-50 border border-dashed border-brand-200 rounded-2xl p-8 text-center">
          <Settings2 className="w-10 h-10 text-brand-600 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-heading mb-2">No requirements yet</h2>
          <p className="text-text-muted max-w-md mx-auto">
            {templates.length > 0 ? 'Start from a template to add the state checklist in one click, or add requirements one by one.' : 'Add the documents and trainings your staff need.'}
          </p>
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
                    <h2 className="text-lg font-bold text-text-main flex items-center gap-2">
                      {section.label}
                      {section.id === 'health' && <Lock className="h-4 w-4 text-amber-600" />}
                    </h2>
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
                <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="border-b border-border text-[15px] font-bold text-text-main">
                      <th scope="col" className="px-6 py-4">Requirement</th>
                      <th scope="col" className="px-4 py-4">Applies to</th>
                      <th scope="col" className="px-4 py-4">Due</th>
                      <th scope="col" className="px-4 py-4">Renewal</th>
                      <th scope="col" className="px-4 py-4">Fulfilled by</th>
                      <th scope="col" className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-sm font-normal text-text-muted">
                    {items.map((req, index) => {
                      const showGroup = req.group_label && req.group_label !== items[index - 1]?.group_label
                      return (
                        <RequirementRow
                          key={req.id}
                          req={req}
                          groupHeading={showGroup ? req.group_label! : null}
                          roleLabel={(v: string) => lookupLabel(staffRoles, v)}
                          isFirst={index === 0}
                          isLast={index === items.length - 1}
                          onUp={() => move(section.id, index, -1)}
                          onDown={() => move(section.id, index, 1)}
                          onEdit={() => startEdit(req)}
                          onDelete={() => deleteRequirement(req)}
                          onPublish={req.evidence_type === 'acknowledgement' ? () => publishPolicyUpdate(req) : undefined}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </div>
              )}
            </section>
          )
        })}
      </div>

      <p className="mt-6 text-xs text-subtle flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5" /> You are responsible for verifying that documents meet your state&apos;s requirements.
      </p>
    </div>
  )
}

function RequirementRow({ req, groupHeading, roleLabel, isFirst, isLast, onUp, onDown, onEdit, onDelete, onPublish }: {
  req: CenterDocumentRequirement
  groupHeading: string | null
  roleLabel: (value: string) => string
  isFirst: boolean
  isLast: boolean
  onUp: () => void
  onDown: () => void
  onEdit: () => void
  onDelete: () => void
  onPublish?: () => void
}) {
  const renewal = describeRenewal(req)
  const appliesTo = [
    req.applies_to_class?.length ? req.applies_to_class.map(c => EMPLOYMENT_CLASS_LABELS[c]).join(' / ') : 'All staff',
    req.applies_to?.length ? req.applies_to.map(roleLabel).join(', ') : null,
  ].filter(Boolean).join(' · ')

  return (
    <>
      {groupHeading && (
        <tr className="bg-surface">
          <td colSpan={6} className="px-6 py-2 text-xs font-bold uppercase tracking-wider text-brand-600">{groupHeading}</td>
        </tr>
      )}
      <tr className="align-top hover:bg-surface transition-colors">
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
        <td className="px-4 py-4 text-xs">{appliesTo}</td>
        <td className="px-4 py-4 whitespace-nowrap">{describeDue(req.due_within_days)}</td>
        <td className="px-4 py-4 whitespace-nowrap">{renewal || '—'}{req.evidence_type === 'acknowledgement' && req.policy_version > 1 && <div className="text-xs text-muted">Version {req.policy_version}</div>}</td>
        <td className="px-4 py-4 text-xs">{evidenceLabel(req.evidence_type)}</td>
        <td className="px-6 py-4">
          <div className="flex items-center justify-end gap-1">
            {onPublish && (
              <button onClick={onPublish} className="rounded-lg px-2 py-1 text-[11px] font-bold text-brand-600 hover:bg-brand-50" title="Policy changed: ask everyone to acknowledge again">Policy updated</button>
            )}
            <button onClick={onUp} disabled={isFirst} className="rounded-lg p-1.5 text-muted hover:bg-brand-50 disabled:opacity-30" title="Move up"><ChevronUp className="h-4 w-4" /></button>
            <button onClick={onDown} disabled={isLast} className="rounded-lg p-1.5 text-muted hover:bg-brand-50 disabled:opacity-30" title="Move down"><ChevronDown className="h-4 w-4" /></button>
            <button onClick={onEdit} className="rounded-lg p-1.5 text-brand-600 hover:bg-brand-50" title="Edit"><Settings2 className="h-4 w-4" /></button>
            <button onClick={onDelete} className="rounded-lg p-1.5 text-subtle hover:bg-red-50 hover:text-red-500" title="Delete"><Trash2 className="h-4 w-4" /></button>
          </div>
        </td>
      </tr>
    </>
  )
}

'use client'

import { Fragment, useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink, Eye, FileText, Loader2, Plus, Save, Trash2, X, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { COMPLIANCE_STATE_STYLE, computeCompliance, describeDue, describeRenewal, formatDate } from '@/lib/compliance'
import { childRows, childStartDate, engineRecord, summarizeChild, type ChildRow } from '@/lib/child-compliance'
import { CHILD_SECTIONS } from '@/lib/child-template'
import { saveChildRecord, type ChildRequirement, type RecordChanges } from '@/lib/children'
import { openChildFile, uploadChildFile } from '@/lib/child-files'
import { deleteChildFile, registerChildFile } from '@/app/actions/child-files.actions'
import { PhoneUploadButton } from '@/components/center/PhoneUploadDialog'
import type { PhoneUpload } from '@/lib/files'
import type { Child, ChildDocumentStatus, ChildFile } from '@/lib/child-types'
import { showAlert, showConfirm } from '@/lib/dialog'
import { BTN, FLD, LBL, Pill } from './ui'

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*'

interface Draft { completedOn: string; dueOn: string; dueEdited: boolean; calculatedDue: string; notes: string; naReason: string }
const EMPTY_DRAFT: Draft = { completedOn: '', dueOn: '', dueEdited: false, calculatedDue: '', notes: '', naReason: '' }

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * One child's records, grouped by section: each item's due date, completion, status and proof, with the same
 * Review panel as the staff files (due date, completed date, comments, accept, reject, not applicable).
 */
export function ChildRecords({ child, requirements, records, files, userId, onChanged }: {
  child: Child
  requirements: ChildRequirement[]
  records: ChildDocumentStatus[]
  files: ChildFile[]
  userId: string | null
  onChanged: () => void
}) {
  const supabase = createClient()
  const rows = useMemo(() => childRows(child, requirements, records), [child, requirements, records])
  const summary = useMemo(() => summarizeChild(rows), [rows])
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)

  function open(row: ChildRow) {
    if (openId === row.requirement.id) { setOpenId(null); return }
    const calculated = computeCompliance(row.requirement, row.record ? engineRecord({ ...row.record, due_on: null }) : null, childStartDate(child), null).dueDate
    setOpenId(row.requirement.id)
    setDraft({
      completedOn: row.record?.completed_on ?? isoDate(new Date()),
      dueOn: row.result.dueDate ? isoDate(row.result.dueDate) : '',
      dueEdited: false,
      calculatedDue: calculated ? isoDate(calculated) : '',
      notes: row.record?.review_notes ?? '',
      naReason: row.record?.not_applicable_reason ?? '',
    })
  }

  /** What to store as the center's due date: what was typed (empty or the calculated date means "calculate it") */
  function dueToSave(record: ChildDocumentStatus | null, completing: boolean) {
    if (draft.dueEdited) return draft.dueOn && draft.dueOn !== draft.calculatedDue ? draft.dueOn : null
    return completing ? null : record?.due_on ?? null
  }

  async function save(row: ChildRow, changes: RecordChanges) {
    setSaving(true)
    const res = await saveChildRecord(supabase, child.center_id, child.id, row.requirement.id,
      { review_notes: draft.notes.trim() || null, ...changes }, userId)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    setOpenId(null)
    onChanged()
  }

  function saveOnly(row: ChildRow) {
    const done = row.record?.status === 'accepted'
    if (done && !draft.completedOn) { showAlert('Enter the completion date'); return }
    save(row, { status: row.record?.status ?? 'missing', due_on: dueToSave(row.record, false), ...(done ? { completed_on: draft.completedOn } : {}) })
  }
  function accept(row: ChildRow) {
    if (!draft.completedOn) { showAlert('Enter the completion date'); return }
    save(row, { status: 'accepted', completed_on: draft.completedOn, expires_on: null, due_on: dueToSave(row.record, true), not_applicable: false, not_applicable_reason: null })
  }
  function reject(row: ChildRow) {
    if (!draft.notes.trim()) { showAlert('Add a comment so it is clear what needs to be fixed'); return }
    save(row, { status: 'rejected', due_on: dueToSave(row.record, false) })
  }
  function setNotApplicable(row: ChildRow, value: boolean) {
    if (value && !draft.naReason.trim()) { showAlert('Add a reason, for example "Religious objection on file"'); return }
    save(row, { not_applicable: value, not_applicable_reason: value ? draft.naReason.trim() : null, status: row.record?.status ?? 'missing' })
  }

  function pickFile(requirementId: string | null) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = ACCEPT
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setUploadingId(requirementId ?? 'other')
      try {
        await uploadChildFile(child.id, file, requirementId)
        onChanged()
      } catch (err) {
        showAlert(err instanceof Error ? err.message : 'Upload failed')
      } finally {
        setUploadingId(null)
      }
    }
    input.click()
  }

  /** A photo sent from the phone is already in storage: just record it against the item */
  async function recordFromPhone(requirementId: string | null, upload: PhoneUpload) {
    const res = await registerChildFile(child.id, { fileKey: upload.fileKey, fileName: upload.name, contentType: upload.type, requirementId })
    if (!res.success) return res.error
    onChanged()
  }

  async function removeFile(file: ChildFile) {
    if (!await showConfirm(`Delete ${file.file_name}? This cannot be undone.`, { title: 'Delete file', confirmLabel: 'Delete' })) return
    const res = await deleteChildFile(file.id)
    if (!res.success) showAlert(res.error)
    onChanged()
  }

  const known = new Set(CHILD_SECTIONS.map(s => s.id))
  const sections = [
    ...CHILD_SECTIONS.map(s => ({ ...s, rows: rows.filter(r => r.requirement.section === s.id) })),
    { id: 'other', label: 'Other', description: '', rows: rows.filter(r => !known.has(r.requirement.section)) },
  ].filter(s => s.rows.length > 0)
  const otherFiles = files.filter(f => !f.requirement_id)

  if (requirements.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">
        No child record requirements are set up yet. Go back to the Children list and add the NC checklist.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-white px-5 py-4 shadow-sm">
        <span className="mr-2 text-sm font-semibold text-text-main">{summary.complete} of {summary.applicable} complete</span>
        {(['overdue', 'due_soon', 'pending_review', 'rejected', 'missing'] as const).filter(s => summary.counts[s] > 0).map(s => (
          <Pill key={s} className={COMPLIANCE_STATE_STYLE[s].className}>{COMPLIANCE_STATE_STYLE[s].label}: {summary.counts[s]}</Pill>
        ))}
        {!child.first_attended_on && <span className="text-xs text-amber-700">Set the first day of attendance to start the 30-day windows.</span>}
      </div>

      {sections.map(section => (
        <section key={section.id} className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className="border-b border-border bg-surface px-6 py-4">
            <h2 className="text-lg font-bold text-text-main">{section.label}</h2>
            {section.description && <p className="text-xs text-muted">{section.description}</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-border text-[15px] font-bold text-text-main">
                  <th scope="col" className="px-6 py-4">Item</th>
                  <th scope="col" className="px-4 py-4">Due</th>
                  <th scope="col" className="px-4 py-4">Completed</th>
                  <th scope="col" className="px-4 py-4">Status</th>
                  <th scope="col" className="px-4 py-4">Proof</th>
                  <th scope="col" className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm text-text-muted">
                {section.rows.map(row => {
                  const { requirement: req, record, result } = row
                  const style = COMPLIANCE_STATE_STYLE[result.state]
                  const isOpen = openId === req.id
                  const mine = files.filter(f => f.requirement_id === req.id)
                  const renewal = describeRenewal(req)
                  return (
                    <Fragment key={req.id}>
                      <tr className={`align-top ${isOpen ? 'bg-surface' : 'hover:bg-surface'}`}>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap items-center gap-1.5 text-text-main">
                            {req.document_name}
                            {req.is_conditional && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">If applicable</span>}
                          </div>
                          <div className="text-xs text-subtle">{describeDue(req.due_within_days)}{renewal ? ` · ${renewal}` : ''}</div>
                          {record?.not_applicable && record.not_applicable_reason && <div className="mt-0.5 text-xs text-muted">N/A: {record.not_applicable_reason}</div>}
                          {record?.review_notes && <div className={`mt-0.5 text-xs ${record.status === 'rejected' ? 'text-red-600' : 'text-muted'}`}>{record.review_notes}</div>}
                        </td>
                        <td className={`whitespace-nowrap px-4 py-4 ${result.state === 'overdue' ? 'text-red-600' : ''}`}>
                          {formatDate(result.dueDate)}
                          {record?.due_on && <div className="text-xs text-subtle" title="Due date set by the center">Set by center</div>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">{formatDate(result.completedOn)}</td>
                        <td className="px-4 py-4"><Pill className={style.className}>{style.label}</Pill></td>
                        <td className="px-4 py-4 text-xs">
                          <div className="space-y-1">
                            {mine.map(f => (
                              <div key={f.id} className="flex items-center gap-1.5">
                                <button onClick={() => openChildFile(f.id)} className="flex min-w-0 items-center gap-1 text-brand-600 hover:underline" title="Open (this view is logged)">
                                  <FileText className="h-3 w-3 shrink-0" /> <span className="truncate">{f.file_name}</span>
                                </button>
                                <button onClick={() => removeFile(f)} title="Delete" className="shrink-0 text-subtle hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
                              </div>
                            ))}
                            {mine.length === 0 && <span className="text-subtle">—</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5 whitespace-nowrap">
                            <button type="button" disabled={uploadingId === req.id} onClick={() => pickFile(req.id)} className={BTN}>
                              {uploadingId === req.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                            </button>
                            <PhoneUploadButton kind="child_record" childId={child.id} label={req.document_name} text="Phone" onReceived={upload => recordFromPhone(req.id, upload)} />
                            <button onClick={() => open(row)} className={BTN}>
                              {isOpen ? <X className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {isOpen ? 'Close' : 'Review'}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-surface">
                          <td colSpan={6} className="px-6 pb-6">
                            <div className="space-y-4 rounded-xl border border-border bg-white p-5">
                              {req.notes && <p className="text-xs leading-relaxed text-muted">{req.notes}</p>}
                              <div className="grid gap-3 sm:grid-cols-3">
                                <div>
                                  <label className={LBL}>Due date</label>
                                  <input type="date" value={draft.dueOn} onChange={e => setDraft({ ...draft, dueOn: e.target.value, dueEdited: true })} className={FLD} />
                                  <div className="mt-1 text-[11px] text-subtle">
                                    {draft.dueOn && draft.dueOn !== draft.calculatedDue ? (
                                      <>Set by hand{draft.calculatedDue ? ` (calculated: ${formatDate(draft.calculatedDue)})` : ''} · <button type="button" onClick={() => setDraft({ ...draft, dueOn: draft.calculatedDue, dueEdited: true })} className="font-semibold text-brand-600 hover:underline">Use calculated</button></>
                                    ) : draft.calculatedDue ? 'Calculated from the first day of attendance' : 'No due date'}
                                  </div>
                                </div>
                                <div>
                                  <label className={LBL}>Completed on</label>
                                  <input type="date" value={draft.completedOn} onChange={e => setDraft({ ...draft, completedOn: e.target.value })} className={FLD} />
                                </div>
                                <div className="sm:col-span-3">
                                  <label className={LBL}>Comments</label>
                                  <textarea rows={2} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} maxLength={1000} className={`${FLD} resize-none`} placeholder="For your records. For example: physician certified a longer immunization series" />
                                </div>
                              </div>
                              {req.is_conditional && !record?.not_applicable && (
                                <div className="max-w-md">
                                  <label className={LBL}>Not applicable? Reason</label>
                                  <input value={draft.naReason} onChange={e => setDraft({ ...draft, naReason: e.target.value })} className={FLD} placeholder='e.g. "Written religious objection on file"' />
                                </div>
                              )}
                              <div className="flex flex-wrap justify-end gap-2">
                                <button onClick={() => setOpenId(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:bg-surface"><X className="h-3.5 w-3.5" /> Cancel</button>
                                {req.is_conditional && (record?.not_applicable ? (
                                  <button disabled={saving} onClick={() => setNotApplicable(row, false)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-muted hover:bg-surface">Undo N/A</button>
                                ) : (
                                  <button disabled={saving} onClick={() => setNotApplicable(row, true)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-muted hover:bg-surface">Mark N/A</button>
                                ))}
                                {record && record.status !== 'rejected' && record.status !== 'missing' && (
                                  <button disabled={saving} onClick={() => reject(row)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-100 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"><XCircle className="h-3.5 w-3.5" /> Reject</button>
                                )}
                                <button disabled={saving} onClick={() => saveOnly(row)} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-600 px-3 py-2 text-xs font-bold text-brand-600 hover:bg-brand-50"><Save className="h-3.5 w-3.5" /> Save</button>
                                <button disabled={saving} onClick={() => accept(row)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-800 disabled:opacity-50">
                                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {record?.status === 'accepted' ? 'Save as complete' : 'Mark complete'}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-text-main">Other documents</h2>
            <p className="text-xs text-muted">Anything that does not belong to a listed item, such as a custody order.</p>
          </div>
          <button type="button" disabled={uploadingId === 'other'} onClick={() => pickFile(null)} className={BTN}>
            {uploadingId === 'other' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
          </button>
          <PhoneUploadButton kind="child_record" childId={child.id} label="Other document" text="Phone" onReceived={upload => recordFromPhone(null, upload)} />
        </div>
        <div className="divide-y divide-border text-sm">
          {otherFiles.length === 0 ? <div className="px-6 py-5 text-muted">None.</div> : otherFiles.map(f => (
            <div key={f.id} className="flex items-center gap-3 px-6 py-3">
              <button onClick={() => openChildFile(f.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-brand-600 hover:underline"><ExternalLink className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{f.file_name}</span></button>
              <span className="text-xs text-subtle">{new Date(f.created_at).toLocaleDateString()}</span>
              <button onClick={() => removeFile(f)} title="Delete" className="text-subtle hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

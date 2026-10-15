'use client'

import { Fragment, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type {
  CenterDocumentRequirement, CenterStaffDocumentStatus, DocumentRequest, RequirementSection, StaffDocument,
} from '@/lib/types'
import {
  SECTIONS, COMPLIANCE_STATE_STYLE, computeCompliance, describeDue, describeRenewal, formatDate,
  type ComplianceState,
} from '@/lib/compliance'
import { deleteInternalDocument } from '@/app/actions/storage.actions'
import { openStoredFile, uploadStoredFile, DOCUMENT_ACCEPT } from '@/lib/files'
import {
  CheckCircle2, ExternalLink, FileText, Loader2, Lock, PenLine, Send, ShieldAlert, Trash2, Upload, X, XCircle,
  UserSquare2, HeartPulse, GraduationCap, ClipboardList,
} from 'lucide-react'

export interface CenterFile {
  id: string
  requirement_id: string | null
  document_name: string
  uploaded_at: string
  future_review_date?: string | null
}

const SECTION_ICONS: Record<RequirementSection, React.ElementType> = {
  personnel: UserSquare2, health: HeartPulse, training: GraduationCap, policies: ClipboardList, evaluations: FileText,
}

const STATE_ORDER: ComplianceState[] = ['overdue', 'due_soon', 'pending_review', 'rejected', 'missing', 'current', 'not_applicable']

const FLD = 'w-full px-3 py-2 rounded-lg border border-[#e2e8e4] bg-white text-sm text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354]'
const LBL = 'block text-xs font-semibold text-[#3d5a4f] mb-1'

type Draft = { completedOn: string; hours: string; expiresOn: string; notes: string; naReason: string }

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * One employee's compliance record at this center: every applicable requirement with
 * its due date, completion, status and proof. Admins record completion dates / hours,
 * accept or reject submissions, mark items N/A and upload center records.
 */
export function ComplianceRecord({
  centerId, staffId, requirements, statuses, uploads, centerFiles, startDate,
  canViewConfidential, isSelf, onChanged, openRequests = [], onRequest,
}: {
  centerId: string
  staffId: string
  requirements: CenterDocumentRequirement[]
  statuses: CenterStaffDocumentStatus[]
  uploads: StaffDocument[]
  centerFiles: CenterFile[]
  startDate: string | null
  canViewConfidential: boolean
  isSelf: boolean
  onChanged: () => void
  /** Open / submitted requests for this employee */
  openRequests?: Pick<DocumentRequest, 'id' | 'requirement_id' | 'status' | 'due_date'>[]
  /** Opens the request dialog (optionally for one checklist item) */
  onRequest?: (requirementId?: string) => void
}) {
  const supabase = createClient()
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ completedOn: '', hours: '', expiresOn: '', notes: '', naReason: '' })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showMedical, setShowMedical] = useState(false)

  const rows = useMemo(() => requirements.map(req => {
    const record = statuses.find(s => s.requirement_id === req.id) ?? null
    const doc = record?.matched_document_id ? uploads.find(u => u.id === record.matched_document_id) ?? null : null
    const files = centerFiles.filter(f => f.requirement_id === req.id)
    const result = computeCompliance(req, record, startDate, doc?.expiry_date)
    return { req, record, doc, files, result }
  }), [requirements, statuses, uploads, centerFiles, startDate])

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATE_ORDER.map(s => [s, 0])) as Record<ComplianceState, number>
    rows.forEach(r => { c[r.result.state]++ })
    return c
  }, [rows])
  const applicable = rows.length - counts.not_applicable
  // Done and not expired (an accepted item can be "due soon" when its renewal is near)
  const complete = rows.filter(r => r.record?.status === 'accepted' && (r.result.state === 'current' || r.result.state === 'due_soon')).length

  function open(row: typeof rows[number]) {
    if (openId === row.req.id) { setOpenId(null); return }
    setOpenId(row.req.id)
    setDraft({
      completedOn: row.record?.completed_on ?? todayISO(),
      hours: row.record?.hours != null ? String(row.record.hours) : '',
      expiresOn: row.record?.expires_on ?? row.doc?.expiry_date ?? '',
      notes: row.record?.review_notes ?? '',
      naReason: row.record?.not_applicable_reason ?? '',
    })
  }

  async function save(req: CenterDocumentRequirement, record: CenterStaffDocumentStatus | null, changes: Partial<CenterStaffDocumentStatus>) {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('center_staff_document_status').upsert({
      center_id: centerId,
      staff_id: staffId,
      requirement_id: req.id,
      matched_document_id: record?.matched_document_id ?? null,
      status: record?.status ?? 'pending_review',
      center_reviewed: true,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
      review_notes: draft.notes.trim() || null,
      ...changes,
    }, { onConflict: 'center_id,staff_id,requirement_id' })
    setSaving(false)
    if (error) {
      alert('Failed to save: ' + error.message)
      return
    }
    setOpenId(null)
    onChanged()
  }

  function markComplete(req: CenterDocumentRequirement, record: CenterStaffDocumentStatus | null) {
    if (!draft.completedOn) { alert('Enter the completion date'); return }
    save(req, record, {
      status: 'accepted',
      completed_on: draft.completedOn,
      hours: draft.hours === '' ? null : Number(draft.hours),
      expires_on: draft.expiresOn || null,
      not_applicable: false,
      not_applicable_reason: null,
    })
  }

  function reject(req: CenterDocumentRequirement, record: CenterStaffDocumentStatus | null) {
    if (!draft.notes.trim()) { alert('Add a note so the employee knows what to fix'); return }
    save(req, record, { status: 'rejected' })
  }

  function setNotApplicable(req: CenterDocumentRequirement, record: CenterStaffDocumentStatus | null, value: boolean) {
    if (value && !draft.naReason.trim()) { alert('Add a reason, e.g. "Does not drive"'); return }
    save(req, record, { not_applicable: value, not_applicable_reason: value ? draft.naReason.trim() : null })
  }

  async function uploadCenterFile(req: CenterDocumentRequirement, file: File) {
    setUploading(true)
    try {
      const { fileKey, bucketName } = await uploadStoredFile('internal', file)
      const { error } = await supabase.from('center_internal_documents').insert({
        center_id: centerId,
        staff_id: staffId,
        requirement_id: req.id,
        document_name: file.name,
        file_url: 'r2_private_access',
        file_key: fileKey,
        bucket_name: bucketName,
      })
      if (error) throw error
      onChanged()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function removeCenterFile(id: string) {
    if (!confirm('Delete this center file?')) return
    const res = await deleteInternalDocument(id)
    if (!res.success) alert(res.error)
    onChanged()
  }

  if (requirements.length === 0) {
    return (
      <div className="bg-white border border-[#e2e8e4] rounded-2xl p-12 text-center text-[#6b7a73]">
        No document requirements apply to this employee yet. Add them in Documents.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#e2e8e4] bg-white px-5 py-4 shadow-sm">
        <span className="mr-2 text-sm font-semibold text-[#1a2e25]">{complete} of {applicable} complete</span>
        {STATE_ORDER.filter(s => counts[s] > 0).map(s => (
          <span key={s} className={`rounded-full border px-2.5 py-1 text-xs ${COMPLIANCE_STATE_STYLE[s].className}`}>
            {COMPLIANCE_STATE_STYLE[s].label}: {counts[s]}
          </span>
        ))}
        {!startDate && <span className="text-xs text-amber-700">Set the employment start date to calculate due dates.</span>}
        {onRequest && !isSelf && (
          <button onClick={() => onRequest()} className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-[#157354] px-4 py-2 text-xs font-bold text-white hover:bg-[#0f4a36]">
            <Send className="h-3.5 w-3.5" /> Request document
          </button>
        )}
      </div>

      {isSelf && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          This is your own record. Another admin or the owner reviews it — upload your documents from your staff portal.
        </div>
      )}

      {SECTIONS.map(section => {
        const sectionRows = rows.filter(r => r.req.section === section.id)
        if (sectionRows.length === 0) return null
        const Icon = SECTION_ICONS[section.id]
        const isMedical = section.id === 'health'
        const restricted = isMedical && !canViewConfidential
        const collapsed = isMedical && !showMedical

        return (
          <section key={section.id} className="overflow-hidden rounded-2xl border border-[#e2e8e4] bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[#e2e8e4] bg-[#f8faf9] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf7f3] text-[#157354]"><Icon className="h-5 w-5" /></span>
                <div>
                  <h2 className="text-lg font-bold text-[#1a2e25] flex items-center gap-2">
                    {section.label} {isMedical && <Lock className="h-4 w-4 text-amber-600" />}
                  </h2>
                  <p className="text-xs text-[#6b7a73]">{sectionRows.length} item{sectionRows.length === 1 ? '' : 's'}</p>
                </div>
              </div>
              {isMedical && !restricted && (
                <button
                  onClick={() => setShowMedical(v => !v)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
                >
                  <Lock className="h-3.5 w-3.5" /> {collapsed ? 'Open medical file' : 'Close medical file'}
                </button>
              )}
            </div>

            {restricted ? (
              <div className="px-6 py-6 text-sm text-[#6b7a73]">Confidential medical file — only the Owner and Admins can view it.</div>
            ) : collapsed ? (
              <div className="px-6 py-6 text-sm text-[#6b7a73]">
                Confidential. Opening this file and its documents is recorded in the access log.
                {sectionRows.some(r => ['overdue', 'pending_review'].includes(r.result.state)) && (
                  <span className="ml-2 font-semibold text-amber-700">Items need attention.</span>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left">
                  <thead>
                    <tr className="border-b border-[#e2e8e4] text-[15px] font-bold text-[#1a2e25]">
                      <th scope="col" className="px-6 py-4">Item</th>
                      <th scope="col" className="px-4 py-4">Due</th>
                      <th scope="col" className="px-4 py-4">Completed</th>
                      <th scope="col" className="px-4 py-4">Status</th>
                      <th scope="col" className="px-4 py-4">Proof</th>
                      <th scope="col" className="px-6 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2e8e4] text-sm font-normal text-[#3d5a4f]">
                    {sectionRows.map((row, index) => {
                      const { req, record, doc, files, result } = row
                      const style = COMPLIANCE_STATE_STYLE[result.state]
                      const showGroup = req.group_label && req.group_label !== sectionRows[index - 1]?.req.group_label
                      const isOpen = openId === req.id
                      const renewal = describeRenewal(req)
                      return (
                        <Fragment key={req.id}>
                          {showGroup && (
                            <tr className="bg-[#fbfcfb]">
                              <td colSpan={6} className="px-6 py-2 text-xs font-bold uppercase tracking-wider text-[#157354]">{req.group_label}</td>
                            </tr>
                          )}
                          <tr className={`align-top ${isOpen ? 'bg-[#f8faf9]' : 'hover:bg-[#fbfcfb]'}`}>
                            <td className="px-6 py-4">
                              <div className="flex flex-wrap items-center gap-1.5 text-[#1a2e25]">
                                {req.document_name}
                                {req.is_conditional && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">If applicable</span>}
                              </div>
                              <div className="text-xs text-[#a8b5ae]">{describeDue(req.due_within_days)}{renewal ? ` · ${renewal}` : ''}</div>
                              {record?.not_applicable && record.not_applicable_reason && (
                                <div className="mt-0.5 text-xs text-[#6b7a73]">N/A: {record.not_applicable_reason}</div>
                              )}
                              {record?.status === 'rejected' && record.review_notes && (
                                <div className="mt-0.5 text-xs text-red-600">{record.review_notes}</div>
                              )}
                            </td>
                            <td className={`px-4 py-4 whitespace-nowrap ${result.state === 'overdue' ? 'text-red-600' : ''}`}>{formatDate(result.dueDate)}</td>
                            <td className="px-4 py-4 whitespace-nowrap">
                              {formatDate(result.completedOn)}
                              {record?.hours != null && <div className="text-xs text-[#6b7a73]">{record.hours} hrs</div>}
                            </td>
                            <td className="px-4 py-4">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${style.className}`}>{style.label}</span>
                            </td>
                            <td className="px-4 py-4 text-xs">
                              <div className="space-y-1">
                                {doc && (
                                  <button onClick={() => openStoredFile('vault', doc.id)} className="flex items-center gap-1 text-[#157354] hover:underline">
                                    <ExternalLink className="h-3 w-3" /> {doc.document_name}
                                  </button>
                                )}
                                {files.map(f => (
                                  <button key={f.id} onClick={() => openStoredFile('internal', f.id)} className="flex items-center gap-1 text-[#157354] hover:underline">
                                    <FileText className="h-3 w-3" /> {f.document_name}
                                  </button>
                                ))}
                                {record?.acknowledged_at && (
                                  <div className="flex items-center gap-1 text-[#6b7a73]" title={`Signed "${record.acknowledged_signature}" · version ${record.acknowledged_version}`}>
                                    <PenLine className="h-3 w-3" /> Signed {formatDate(record.acknowledged_at)}
                                  </div>
                                )}
                                {!doc && files.length === 0 && !record?.acknowledged_at && <span className="text-[#a8b5ae]">—</span>}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              {!isSelf && (
                                <div className="flex flex-col items-end gap-1.5">
                                  <button
                                    onClick={() => open(row)}
                                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                                      result.state === 'pending_review'
                                        ? 'bg-[#157354] text-white hover:bg-[#0f4a36]'
                                        : 'border border-[#e2e8e4] text-[#157354] hover:bg-[#edf7f3]'
                                    }`}
                                  >
                                    {isOpen ? 'Close' : result.state === 'pending_review' ? 'Review' : 'Record'}
                                  </button>
                                  {(() => {
                                    const request = openRequests.find(r => r.requirement_id === req.id)
                                    if (request) {
                                      return (
                                        <span className="text-[11px] text-[#6b7a73]">
                                          {request.status === 'submitted' ? 'Sent by employee' : `Requested${request.due_date ? ` · due ${formatDate(request.due_date)}` : ''}`}
                                        </span>
                                      )
                                    }
                                    const canRequest = onRequest && req.evidence_type !== 'center_record'
                                      && ['missing', 'overdue', 'due_soon', 'rejected'].includes(result.state)
                                    return canRequest ? (
                                      <button onClick={() => onRequest(req.id)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#157354] hover:underline">
                                        <Send className="h-3 w-3" /> Request
                                      </button>
                                    ) : null
                                  })()}
                                </div>
                              )}
                            </td>
                          </tr>

                          {isOpen && (
                            <tr className="bg-[#f8faf9]">
                              <td colSpan={6} className="px-6 pb-6">
                                <div className="rounded-xl border border-[#e2e8e4] bg-white p-5 space-y-4">
                                  {record?.status === 'pending_review' && doc && (
                                    <div className="flex flex-wrap items-center gap-2 text-sm text-[#3d5a4f]">
                                      Submitted by the employee:
                                      <button onClick={() => openStoredFile('vault', doc.id)} className="inline-flex items-center gap-1 font-semibold text-[#157354] hover:underline">
                                        <ExternalLink className="h-3.5 w-3.5" /> {doc.document_name}
                                      </button>
                                      {doc.expiry_date && <span className="text-xs text-[#6b7a73]">(expires {formatDate(doc.expiry_date)})</span>}
                                    </div>
                                  )}

                                  <div className="grid gap-3 sm:grid-cols-4">
                                    <div>
                                      <label className={LBL}>Completed on</label>
                                      <input type="date" value={draft.completedOn} onChange={e => setDraft({ ...draft, completedOn: e.target.value })} className={FLD} />
                                    </div>
                                    {(req.evidence_type === 'training' || req.section === 'training') && (
                                      <div>
                                        <label className={LBL}>Training hours</label>
                                        <input type="number" min={0} step={0.5} value={draft.hours} onChange={e => setDraft({ ...draft, hours: e.target.value })} className={FLD} placeholder="e.g. 3" />
                                      </div>
                                    )}
                                    {req.renewal_type === 'document_expiry' && (
                                      <div>
                                        <label className={LBL}>Expires on</label>
                                        <input type="date" value={draft.expiresOn} onChange={e => setDraft({ ...draft, expiresOn: e.target.value })} className={FLD} />
                                      </div>
                                    )}
                                    <div className="sm:col-span-2">
                                      <label className={LBL}>Notes</label>
                                      <input value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} className={FLD} placeholder="Shown to the employee if rejected" />
                                    </div>
                                  </div>

                                  {(req.evidence_type === 'center_record' || req.evidence_type === 'training') && (
                                    <div className="flex flex-wrap items-center gap-3">
                                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[#a9dac9] px-3 py-2 text-xs font-semibold text-[#157354] hover:bg-[#edf7f3]">
                                        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                                        Upload center record
                                        <input type="file" accept={DOCUMENT_ACCEPT} className="sr-only" disabled={uploading}
                                          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadCenterFile(req, f) }} />
                                      </label>
                                      {files.map(f => (
                                        <span key={f.id} className="inline-flex items-center gap-1 rounded-lg bg-[#f8faf9] px-2 py-1 text-xs">
                                          {f.document_name}
                                          <button onClick={() => removeCenterFile(f.id)} title="Delete" className="text-[#a8b5ae] hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
                                        </span>
                                      ))}
                                    </div>
                                  )}

                                  {req.is_conditional && !record?.not_applicable && (
                                    <div className="max-w-md">
                                      <label className={LBL}>Not applicable? Reason</label>
                                      <input value={draft.naReason} onChange={e => setDraft({ ...draft, naReason: e.target.value })} className={FLD} placeholder='e.g. "Does not work in the infant room"' />
                                    </div>
                                  )}

                                  <div className="flex flex-wrap justify-end gap-2">
                                    <button onClick={() => setOpenId(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e8e4] px-3 py-2 text-xs font-semibold text-[#6b7a73] hover:bg-[#f8faf9]">
                                      <X className="h-3.5 w-3.5" /> Cancel
                                    </button>
                                    {req.is_conditional && (record?.not_applicable ? (
                                      <button disabled={saving} onClick={() => setNotApplicable(req, record, false)} className="rounded-lg border border-[#e2e8e4] px-3 py-2 text-xs font-semibold text-[#3d5a4f] hover:bg-[#f8faf9]">
                                        Undo N/A
                                      </button>
                                    ) : (
                                      <button disabled={saving} onClick={() => setNotApplicable(req, record, true)} className="rounded-lg border border-[#e2e8e4] px-3 py-2 text-xs font-semibold text-[#3d5a4f] hover:bg-[#f8faf9]">
                                        Mark N/A
                                      </button>
                                    ))}
                                    {record && record.status !== 'rejected' && (
                                      <button disabled={saving} onClick={() => reject(req, record)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-100 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">
                                        <XCircle className="h-3.5 w-3.5" /> Reject
                                      </button>
                                    )}
                                    <button disabled={saving} onClick={() => markComplete(req, record)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#157354] px-4 py-2 text-xs font-bold text-white hover:bg-[#0f4a36] disabled:opacity-50">
                                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Mark complete
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
            )}
          </section>
        )
      })}
    </div>
  )
}

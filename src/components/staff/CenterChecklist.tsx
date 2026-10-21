'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChevronRight, Download, ExternalLink, FileText, Loader2, Lock, PenLine } from 'lucide-react'
import { openStoredFile } from '@/lib/files'
import {
   CenterDocumentRequirement,
   CenterStaffDocumentStatus,
   EmploymentClass,
   StaffDocument,
   appliesToEmploymentClass
} from '@/lib/types'
import {
   sectionsFor, COMPLIANCE_STATE_STYLE, computeCompliance, describeDue, describeRenewal, formatDate,
} from '@/lib/compliance'
import { showAlert } from '@/lib/dialog'

/**
 * A staff member's checklist for one center: what applies to them, when it is due,
 * its status, and the action they can take (link a document, sign a policy).
 * Center-held records are not shown; completion details are recorded by the center.
 */
export function CenterChecklist({
   centerId,
   staffId,
   employmentClass,
   description = 'Link documents from your library and sign policies. Your center reviews each item.',
}: {
   centerId: string
   staffId: string
   employmentClass?: EmploymentClass | null
   description?: string
}) {
   const [requirements, setRequirements] = useState<CenterDocumentRequirement[]>([])
   const [records, setRecords] = useState<CenterStaffDocumentStatus[]>([])
   const [vaultDocs, setVaultDocs] = useState<StaffDocument[]>([])
   const [startDate, setStartDate] = useState<string | null>(null)
   const [linkingReq, setLinkingReq] = useState<CenterDocumentRequirement | null>(null)
   const [signingReq, setSigningReq] = useState<string | null>(null)
   const [signature, setSignature] = useState('')
   const [confirmed, setConfirmed] = useState(false)
   const [busy, setBusy] = useState(false)

   const loadChecklist = useCallback(async () => {
      const supabase = createClient()

      const [{ data: allReqs }, { data: statusData }, { data: docs }, { data: membership }] = await Promise.all([
         supabase.from('center_document_requirements').select('*').eq('center_id', centerId)
            .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
         supabase.from('center_staff_document_status').select('*').eq('center_id', centerId).eq('staff_id', staffId),
         supabase.from('staff_documents').select('*').eq('staff_id', staffId).order('uploaded_at', { ascending: false }),
         supabase.from('center_staff').select('employment_start_date').eq('center_id', centerId).eq('staff_id', staffId).maybeSingle(),
      ])

      // Center-held records are hidden from staff
      setRequirements((allReqs || []).filter(r => !r.is_internal && appliesToEmploymentClass(r, employmentClass)))
      setRecords(statusData || [])
      setVaultDocs(docs || [])
      setStartDate(membership?.employment_start_date ?? null)
   }, [centerId, staffId, employmentClass])

   useEffect(() => {
      loadChecklist()
   }, [loadChecklist])

   const rows = useMemo(() => requirements.map(req => {
      const record = records.find(r => r.requirement_id === req.id) ?? null
      const doc = record?.matched_document_id ? vaultDocs.find(d => d.id === record.matched_document_id) ?? null : null
      return { req, record, doc, result: computeCompliance(req, record, startDate, doc?.expiry_date) }
   }), [requirements, records, vaultDocs, startDate])

   const applicable = rows.filter(r => r.result.state !== 'not_applicable')
   const done = applicable.filter(r => r.record?.status === 'accepted' && (r.result.state === 'current' || r.result.state === 'due_soon')).length

   async function handleAssign(reqId: string, docId: string) {
      setBusy(true)
      const { error } = await createClient()
         .from('center_staff_document_status')
         .upsert({
            center_id: centerId,
            staff_id: staffId,
            requirement_id: reqId,
            matched_document_id: docId,
            status: 'pending_review',
            center_reviewed: false
         }, { onConflict: 'center_id,staff_id,requirement_id' })
      setBusy(false)

      if (error) {
         showAlert('Linking failed: ' + error.message)
         return
      }
      setLinkingReq(null)
      loadChecklist()
   }

   async function handleUnlink(statusId: string) {
      const { error } = await createClient().from('center_staff_document_status').delete().eq('id', statusId)
      if (error) {
         showAlert(error.message)
         return
      }
      loadChecklist()
   }

   async function handleSign(req: CenterDocumentRequirement) {
      if (!confirmed || !signature.trim()) return
      setBusy(true)
      const { error } = await createClient().rpc('acknowledge_requirement', { p_requirement_id: req.id, p_signature: signature.trim() })
      setBusy(false)
      if (error) {
         showAlert(error.message)
         return
      }
      setSigningReq(null)
      setSignature('')
      setConfirmed(false)
      loadChecklist()
   }

   return (
      <>
         <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
            <div className="flex-1">
               <h4 className="text-lg font-bold text-heading mb-1">Requirements Checklist</h4>
               <p className="text-sm text-muted">{description}</p>
            </div>
            <div className="rounded-xl border border-border bg-white px-4 py-2 text-sm">
               <span className="font-bold text-brand-600">{done}</span>
               <span className="text-muted"> of {applicable.length} complete</span>
            </div>
         </div>

         {rows.length === 0 ? (
            <div className="text-center py-10 bg-white rounded-2xl border-2 border-dashed border-border text-sm font-bold text-muted">
               No documents are required from you right now.
            </div>
         ) : (
            <div className="space-y-6">
               {sectionsFor(requirements).map(section => {
                  const sectionRows = rows.filter(r => r.req.section === section.id)
                  if (sectionRows.length === 0) return null
                  return (
                     <section key={section.id} className="overflow-hidden rounded-2xl border border-border bg-white">
                        <div className="border-b border-border bg-surface px-5 py-3">
                           <h5 className="flex items-center gap-2 text-base font-bold text-text-main">
                              {section.label} {section.id === 'health' && <Lock className="h-3.5 w-3.5 text-amber-600" />}
                           </h5>
                        </div>
                        <div className="overflow-x-auto">
                           <table className="w-full min-w-[640px] text-left">
                              <thead>
                                 <tr className="border-b border-border text-[15px] font-bold text-text-main">
                                    <th scope="col" className="px-5 py-3">Item</th>
                                    <th scope="col" className="px-4 py-3">Due</th>
                                    <th scope="col" className="px-4 py-3">Status</th>
                                    <th scope="col" className="px-5 py-3 text-right">Action</th>
                                 </tr>
                              </thead>
                              <tbody className="divide-y divide-border text-sm font-normal text-text-muted">
                                 {sectionRows.map(({ req, record, doc, result }, index) => {
                                    const style = COMPLIANCE_STATE_STYLE[result.state]
                                    const renewal = describeRenewal(req)
                                    const showGroup = req.group_label && req.group_label !== sectionRows[index - 1]?.req.group_label
                                    const isAck = req.evidence_type === 'acknowledgement'
                                    const needsSignature = isAck && result.state !== 'not_applicable'
                                       && !(record?.status === 'accepted' && (result.state === 'current' || result.state === 'due_soon') && record.acknowledged_version === req.policy_version)
                                    const isSigning = signingReq === req.id
                                    return (
                                       <Fragment key={req.id}>
                                          {showGroup && (
                                             <tr className="bg-surface">
                                                <td colSpan={4} className="px-5 py-2 text-xs font-bold uppercase tracking-wider text-brand-600">{req.group_label}</td>
                                             </tr>
                                          )}
                                          <tr className="align-top">
                                             <td className="px-5 py-3">
                                                <div className="text-text-main">{req.document_name}</div>
                                                <div className="text-xs text-subtle">{describeDue(req.due_within_days)}{renewal ? ` · ${renewal}` : ''}</div>
                                                {req.notes && <div className="mt-0.5 max-w-md text-xs text-muted">{req.notes}</div>}
                                                {req.template_file_key && (
                                                   <button onClick={() => openStoredFile('template', req.id)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                                                      <Download className="h-3 w-3" /> {isAck ? 'Read the policy' : 'Download form'}
                                                   </button>
                                                )}
                                                {record?.status === 'rejected' && record.review_notes && (
                                                   <div className="mt-1 text-xs text-red-600">Center note: {record.review_notes}</div>
                                                )}
                                                {record?.not_applicable && <div className="mt-1 text-xs text-muted">Not applicable{record.not_applicable_reason ? `: ${record.not_applicable_reason}` : ''}</div>}
                                             </td>
                                             <td className={`px-4 py-3 whitespace-nowrap ${result.state === 'overdue' ? 'text-red-600' : ''}`}>{formatDate(result.dueDate)}</td>
                                             <td className="px-4 py-3">
                                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${style.className}`}>{style.label}</span>
                                             </td>
                                             <td className="px-5 py-3">
                                                <div className="flex flex-col items-end gap-1.5 text-xs">
                                                   {doc && (
                                                      <button onClick={() => openStoredFile('vault', doc.id)} className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                                                         <ExternalLink className="h-3 w-3" /> {doc.document_name}
                                                      </button>
                                                   )}
                                                   {record?.acknowledged_at && !needsSignature && (
                                                      <span className="inline-flex items-center gap-1 text-muted"><PenLine className="h-3 w-3" /> Signed {formatDate(record.acknowledged_at)}</span>
                                                   )}

                                                   {result.state === 'not_applicable' ? null : isAck ? (
                                                      needsSignature && (
                                                         <button onClick={() => { setSigningReq(isSigning ? null : req.id); setSignature(''); setConfirmed(false) }}
                                                            className="rounded-lg bg-brand-600 px-3 py-1.5 font-bold text-white hover:bg-brand-800">
                                                            {isSigning ? 'Cancel' : record?.acknowledged_at ? 'Sign updated policy' : 'Acknowledge'}
                                                         </button>
                                                      )
                                                   ) : (
                                                      <div className="flex items-center gap-2">
                                                         {record?.status === 'pending_review' && (
                                                            <button onClick={() => handleUnlink(record.id)} className="font-semibold text-red-600 hover:underline">Unlink</button>
                                                         )}
                                                         {(record?.status !== 'accepted' || result.state === 'overdue' || result.state === 'due_soon') && (
                                                            <button onClick={() => setLinkingReq(req)} className="rounded-lg bg-brand-600 px-3 py-1.5 font-bold text-white hover:bg-brand-800">
                                                               {doc ? 'Replace' : req.evidence_type === 'training' ? 'Link certificate' : 'Link document'}
                                                            </button>
                                                         )}
                                                      </div>
                                                   )}
                                                   {req.evidence_type === 'training' && record?.status !== 'accepted' && result.state !== 'not_applicable' && (
                                                      <span className="text-[11px] text-subtle">Your center records the completion date</span>
                                                   )}
                                                </div>
                                             </td>
                                          </tr>
                                          {isSigning && (
                                             <tr className="bg-surface">
                                                <td colSpan={4} className="px-5 pb-4">
                                                   <div className="rounded-xl border border-border bg-white p-4 space-y-3">
                                                      {req.template_file_key && (
                                                         <button onClick={() => openStoredFile('template', req.id)} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
                                                            <FileText className="h-4 w-4" /> Open {req.document_name.replace(/^Receipt of /, '')}
                                                         </button>
                                                      )}
                                                      <label className="flex items-start gap-2 text-sm text-text-main">
                                                         <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                                                         I confirm I have received and read this{req.policy_version > 1 ? ` (version ${req.policy_version})` : ''}.
                                                      </label>
                                                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                                         <input value={signature} onChange={e => setSignature(e.target.value)} placeholder="Type your full name to sign"
                                                            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/30" />
                                                         <button disabled={busy || !confirmed || !signature.trim()} onClick={() => handleSign(req)}
                                                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
                                                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Sign
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
                  )
               })}
            </div>
         )}

         {/* Link Modal */}
         {linkingReq && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-900/60 backdrop-blur-sm">
               <div className="bg-white rounded-[2rem] w-full max-w-lg overflow-hidden shadow-2xl">
                  <div className="p-8 bg-surface border-b border-border">
                     <h3 className="text-xl font-black text-heading">Link Document</h3>
                     <p className="text-muted text-sm font-medium">Choose a document from your library for {linkingReq.document_name}. Only this document is shared with the center.</p>
                  </div>
                  <div className="p-6 space-y-3 max-h-[50vh] overflow-y-auto">
                     {vaultDocs.length === 0 && (
                        <p className="text-sm text-muted">Your library is empty. Upload the document in My Documents first.</p>
                     )}
                     {[...vaultDocs]
                        .sort((a, b) => Number(b.document_category === linkingReq.document_category) - Number(a.document_category === linkingReq.document_category))
                        .map(doc => (
                           <button
                              key={doc.id}
                              disabled={busy}
                              onClick={() => handleAssign(linkingReq.id, doc.id)}
                              className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-border hover:border-brand-600 transition-all text-left disabled:opacity-50"
                           >
                              <span>
                                 <span className="block font-bold text-sm text-heading">{doc.document_name}</span>
                                 <span className="block text-xs text-muted">
                                    Uploaded {formatDate(doc.uploaded_at)}{doc.expiry_date ? ` · expires ${formatDate(doc.expiry_date)}` : ''}
                                 </span>
                              </span>
                              <ChevronRight className="w-4 h-4 text-subtle" />
                           </button>
                        ))}
                  </div>
                  <div className="px-6 pb-6">
                     <button onClick={() => setLinkingReq(null)} className="w-full py-3 text-muted font-black text-xs uppercase tracking-widest">
                        Cancel
                     </button>
                  </div>
               </div>
            </div>
         )}
      </>
   )
}

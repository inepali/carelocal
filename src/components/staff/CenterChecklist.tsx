'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, ChevronRight, Download, FileText, Loader2, ShieldCheck } from 'lucide-react'
import { getPresignedViewUrl } from '@/app/actions/storage.actions'
import {
   CenterDocumentRequirement,
   CenterStaffDocumentStatus,
   DOCUMENT_CATEGORY_LABELS,
   EmploymentClass,
   StaffDocument,
   appliesToEmploymentClass
} from '@/lib/types'

/**
 * A staff member's document checklist for one center: the requirements that
 * apply to their employment class, linked vault documents and review status.
 */
export function CenterChecklist({
   centerId,
   staffId,
   employmentClass,
   description = 'Please link the following documents from your vault to be approved.',
}: {
   centerId: string
   staffId: string
   employmentClass?: EmploymentClass | null
   description?: string
}) {
   const [requirements, setRequirements] = useState<CenterDocumentRequirement[]>([])
   const [centerDocStatuses, setCenterDocStatuses] = useState<CenterStaffDocumentStatus[]>([])
   const [matchingStatus, setMatchingStatus] = useState<Record<string, boolean>>({})
   const [vaultDocs, setVaultDocs] = useState<StaffDocument[]>([])
   const [linkingReq, setLinkingReq] = useState<CenterDocumentRequirement | null>(null)

   const loadChecklist = useCallback(async () => {
      const supabase = createClient()

      // Requirements that apply to my class
      const { data: allReqs } = await supabase
         .from('center_document_requirements')
         .select('*')
         .eq('center_id', centerId)
         .order('sort_order', { ascending: true })

      const reqs = (allReqs || []).filter(r => appliesToEmploymentClass(r, employmentClass))
      setRequirements(reqs)

      // Statuses
      const { data: statusData } = await supabase
         .from('center_staff_document_status')
         .select('*, matched_document:staff_documents(*)')
         .eq('center_id', centerId)
         .eq('staff_id', staffId)

      setCenterDocStatuses(statusData || [])

      const statusMap: Record<string, boolean> = {}
      reqs.forEach(req => {
         const assignment = (statusData || []).find(s => s.requirement_id === req.id)
         statusMap[req.id] = (assignment?.status === 'accepted' || assignment?.status === 'pending_review')
      })
      setMatchingStatus(statusMap)

      // Vault docs (for linking)
      const { data: docs } = await supabase
         .from('staff_documents')
         .select('*')
         .eq('staff_id', staffId)

      setVaultDocs(docs || [])
   }, [centerId, staffId, employmentClass])

   useEffect(() => {
      loadChecklist()
   }, [loadChecklist])

   async function handleAssign(reqId: string, docId: string) {
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

      if (!error) {
         setLinkingReq(null)
         loadChecklist()
      }
   }

   async function handleUnlink(statusId: string) {
      const { error } = await createClient()
         .from('center_staff_document_status')
         .delete()
         .eq('id', statusId)

      if (error) {
         alert(error.message)
         return
      }

      loadChecklist()
   }

   async function handleDownloadTemplate(req: CenterDocumentRequirement) {
      if (!req.template_file_key || !req.template_bucket_name) return
      const res = await getPresignedViewUrl(req.template_file_key, req.template_bucket_name)
      if (res.success && res.url) window.open(res.url, '_blank')
   }

   return (
      <>
         <div className="flex flex-col md:flex-row items-center gap-6 mb-8">
            <div className="flex-1">
               <h4 className="text-xl font-black text-[#0b3828] mb-1 italic">Requirements Checklist</h4>
               <p className="text-sm text-[#6b7a73] font-medium">{description}</p>
            </div>
            <div className="flex items-center gap-4 bg-white px-5 py-3 rounded-2xl border-2 border-[#157354]/10 shadow-sm">
               <div className="text-right">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#a8b5ae]">Progress</div>
                  <div className="text-lg font-black text-[#157354] leading-none mt-0.5">
                     {Object.values(matchingStatus).filter(Boolean).length} / {requirements.length}
                  </div>
               </div>
               <Loader2 className={`w-8 h-8 text-[#157354] ${Object.values(matchingStatus).every(Boolean) ? '' : 'animate-spin'}`} />
            </div>
         </div>

         <div className="grid gap-3">
            {requirements.length === 0 && (
               <div className="text-center py-10 bg-white rounded-2xl border-2 border-dashed border-[#e2e8e4] text-sm font-bold text-[#6b7a73]">
                  No documents are required from you right now.
               </div>
            )}
            {requirements.map(req => {
               const assignment = centerDocStatuses.find(s => s.requirement_id === req.id)
               const isMet = assignment?.status === 'accepted'
               const isPending = assignment?.status === 'pending_review'
               const matchedDocument = assignment?.matched_document
               const isExpired = !!matchedDocument?.expiry_date && new Date(matchedDocument.expiry_date) < new Date()

               return (
                  <div key={req.id} className={`flex items-center justify-between p-5 rounded-2xl border-2 transition-all ${((isMet && !isExpired) || isPending) ? 'bg-[#f0fdf4] border-[#dcfce7]' : 'bg-white border-[#f0f4f2]'}`}>
                     <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${((isMet && !isExpired) || isPending) ? 'bg-[#157354] text-white' : 'bg-[#f8faf9] text-[#a8b5ae]'}`}>
                           {((isMet && !isExpired) || isPending) ? <CheckCircle2 className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                        </div>
                        <div>
                           <div className={`font-black text-sm ${((isMet && !isExpired) || isPending) ? 'text-[#157354]' : 'text-[#3d5a4f]'}`}>{req.document_name}</div>
                           <div className="text-[10px] font-bold text-[#6b7a73] uppercase tracking-widest flex items-center gap-3">
                              {DOCUMENT_CATEGORY_LABELS[req.document_category]}
                              {assignment && assignment.status === 'rejected' && <span className="text-red-500">• Rejected</span>}
                           </div>
                           {req.template_file_key && (
                              <button
                                 onClick={() => handleDownloadTemplate(req)}
                                 className="mt-1 flex items-center gap-1 text-[10px] font-black text-[#157354] hover:underline"
                              >
                                 <Download className="w-3 h-3" /> Download Form
                              </button>
                           )}
                        </div>
                     </div>
                     {isMet && !isExpired ? (
                        <div className="flex items-center gap-1.5 px-3 py-1 bg-[#dcfce7] rounded-lg text-[9px] font-black text-[#157354] uppercase tracking-wider">
                           <ShieldCheck className="w-3 h-3" /> Approved
                        </div>
                     ) : isExpired ? (
                        <button
                           onClick={() => setLinkingReq(req)}
                           className="bg-[#fbbf24] text-[#0b3828] text-[9px] font-black px-4 py-2 rounded-lg hover:bg-[#f59e0b] uppercase tracking-widest transition-all"
                        >
                           Relink Doc
                        </button>
                     ) : isPending ? (
                        <div className="flex items-center gap-2">
                           <div className="text-[9px] font-black text-yellow-600 uppercase">Pending Review</div>
                           {assignment && (
                              <button
                                 type="button"
                                 onClick={() => handleUnlink(assignment.id)}
                                 className="text-[9px] font-black uppercase tracking-wider text-red-600 hover:underline"
                              >
                                 Unlink Doc
                              </button>
                           )}
                        </div>
                     ) : assignment ? (
                        <div className="flex items-center gap-2">
                           <button
                              onClick={() => setLinkingReq(req)}
                              className="bg-[#0b3828] text-white text-[9px] font-black px-4 py-2 rounded-lg hover:bg-black uppercase tracking-widest transition-all"
                           >
                              Relink Doc
                           </button>
                           <button
                              type="button"
                              onClick={() => handleUnlink(assignment.id)}
                              className="text-[9px] font-black uppercase tracking-wider text-red-600 hover:underline"
                           >
                              Unlink Doc
                           </button>
                        </div>
                     ) : (
                        <button
                           onClick={() => setLinkingReq(req)}
                           className="bg-[#0b3828] text-white text-[9px] font-black px-4 py-2 rounded-lg hover:bg-black uppercase tracking-widest transition-all"
                        >
                           Link Doc
                        </button>
                     )}
                  </div>
               )
            })}
         </div>

         {/* Link Modal (Simplified) */}
         {linkingReq && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b3828]/60 backdrop-blur-sm">
               <div className="bg-white rounded-[2rem] w-full max-w-lg overflow-hidden shadow-2xl">
                  <div className="p-8 bg-[#f8faf9] border-b border-[#f0f4f2]">
                     <h3 className="text-xl font-black text-[#0b3828]">Link Document</h3>
                     <p className="text-[#6b7a73] text-sm font-medium">Select a vault document for {linkingReq.document_name}</p>
                  </div>
                  <div className="p-6 space-y-3">
                     {vaultDocs
                        .filter(d => d.document_category === linkingReq.document_category || d.document_category === 'other')
                        .map(doc => (
                           <button
                              key={doc.id}
                              onClick={() => handleAssign(linkingReq.id, doc.id)}
                              className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-[#f0f4f2] hover:border-[#157354] transition-all text-left"
                           >
                              <span className="font-bold text-sm text-[#0b3828]">{doc.document_name}</span>
                              <ChevronRight className="w-4 h-4 text-[#a8b5ae]" />
                           </button>
                        ))}
                     <button
                        onClick={() => setLinkingReq(null)}
                        className="w-full py-3 text-[#6b7a73] font-black text-xs uppercase tracking-widest mt-4"
                     >
                        Cancel
                     </button>
                  </div>
               </div>
            </div>
         )}
      </>
   )
}

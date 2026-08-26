'use client'

import { useEffect, useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
   Building,
   Search,
   Globe,
   CheckCircle2,
   FileText,
   ShieldCheck,
   Loader2,
   AlertCircle,
   ChevronRight,
   Sparkles,
   Download,
   Plus,
   MapPin,
   Clock,
   Phone,
   Mail,
   User,
   X,
   Star
} from 'lucide-react'
import { getPresignedViewUrl } from '@/app/actions/storage.actions'
import {
   Center,
   CenterDocumentRequirement,
   CenterStaffStatus,
   CenterStaffDocumentStatus,
   DOCUMENT_CATEGORY_LABELS,
   StaffDocument
} from '@/lib/types'

export default function MyCentersPage() {
   return (
      <Suspense fallback={<div className="p-10 text-[#6b7a73] font-medium">Loading centers...</div>}>
         <CentersContent />
      </Suspense>
   )
}


function CentersContent() {
   const supabase = createClient()
   const [loading, setLoading] = useState(true)
   const [myCenters, setMyCenters] = useState<any[]>([])
   const [searchQuery, setSearchQuery] = useState('')
   const [searchResults, setSearchResults] = useState<Center[]>([])
   const [searching, setSearching] = useState(false)
   const [staffProfile, setStaffProfile] = useState<any>(null)

   // Checklist State
   const [activeCenterId, setActiveCenterId] = useState<string | null>(null)
   const [requirements, setRequirements] = useState<CenterDocumentRequirement[]>([])
   const [centerDocStatuses, setCenterDocStatuses] = useState<CenterStaffDocumentStatus[]>([])
   const [matchingStatus, setMatchingStatus] = useState<Record<string, boolean>>({})
   const [vaultDocs, setVaultDocs] = useState<StaffDocument[]>([])
   const [linkingReq, setLinkingReq] = useState<CenterDocumentRequirement | null>(null)

   // Center Details Modal State
   const [viewingCenter, setViewingCenter] = useState<any>(null)
   const [centerReviews, setCenterReviews] = useState<Record<string, any[]>>({})
   const [centerRatings, setCenterRatings] = useState<Record<string, { avg: number, count: number }>>({})

   useEffect(() => {
      loadInitialData()
   }, [])

   async function loadInitialData() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 1. Fetch Profile
      const { data: profile } = await supabase
         .from('staff_profiles')
         .select('*')
         .eq('user_id', user.id)
         .single()

      if (profile) {
         setStaffProfile(profile)

         // 2. Fetch My Centers
         const { data: associations } = await supabase
            .from('center_staff')
            .select('*, center:centers(*)')
            .eq('staff_id', profile.id)

         setMyCenters(associations || [])

         // 3. Fetch Vault Docs (for linking)
         const { data: docs } = await supabase
            .from('staff_documents')
            .select('*')
            .eq('staff_id', profile.id)

         setVaultDocs(docs || [])

         // 4. Fetch Reviews for affiliated centers
         if (associations && associations.length > 0) {
            const centerIds = associations.map((a: any) => a.center_id)
            const { data: revs } = await supabase
               .from('shift_reviews')
               .select('*')
               .in('reviewee_id', centerIds)
               .eq('reviewer_type', 'staff')
            
            if (revs && revs.length > 0) {
               // We need staff names for these reviewers
               const sIds = revs.map((r: any) => r.reviewer_id)
               const { data: sData } = await supabase.from('staff_profiles').select('id, first_name, last_name').in('id', sIds)
               const sMap = (sData || []).reduce((acc: any, curr: any) => { acc[curr.id] = `${curr.first_name} ${curr.last_name[0]}.`; return acc; }, {})
               
               const rMap: Record<string, any[]> = {}
               const ratingMap: Record<string, { avg: number, count: number }> = { ...centerRatings }
               
               revs.forEach((r: any) => {
                  if (!rMap[r.reviewee_id]) rMap[r.reviewee_id] = []
                  rMap[r.reviewee_id].push({ ...r, reviewer_name: sMap[r.reviewer_id] || 'Staff Member' })
               })
               
               Object.keys(rMap).forEach(cId => {
                  const count = rMap[cId].length
                  const sum = rMap[cId].reduce((acc, curr) => acc + curr.rating, 0)
                  ratingMap[cId] = { avg: sum / count, count }
               })
               
               setCenterReviews(rMap)
               setCenterRatings(ratingMap)
            }
         }
      }
      setLoading(false)
   }

   async function handleSearch() {
      if (!searchQuery.trim()) return
      setSearching(true)

      const { data } = await supabase
         .from('centers')
         .select('*')
         .or(`name.ilike.%${searchQuery}%,city.ilike.%${searchQuery}%`)
         .limit(10)

      if (data && data.length > 0) {
         const cIds = data.map(c => c.id)
         const { data: revs } = await supabase
            .from('shift_reviews')
            .select('reviewee_id, rating')
            .in('reviewee_id', cIds)
            .eq('reviewer_type', 'staff')
            
         if (revs && revs.length > 0) {
            const newRatings = { ...centerRatings }
            cIds.forEach(cId => {
               const cRevs = revs.filter(r => r.reviewee_id === cId)
               if (cRevs.length > 0) {
                  const sum = cRevs.reduce((acc, curr) => acc + curr.rating, 0)
                  newRatings[cId] = { avg: sum / cRevs.length, count: cRevs.length }
               }
            })
            setCenterRatings(newRatings)
         }
      }

      setSearchResults(data || [])
      setSearching(false)
   }

   async function handleApply(centerId: string) {
      if (!staffProfile) return

      const { error } = await supabase
         .from('center_staff')
         .insert({
            center_id: centerId,
            staff_id: staffProfile.id,
            status: 'applying'
         })

      if (error) {
         alert(error.message)
      } else {
         setSearchQuery('')
         setSearchResults([])
         loadInitialData()
      }
   }

   async function loadChecklist(centerId: string) {
      if (!staffProfile) return
      setActiveCenterId(centerId)

      // Fetch Requirements
      const { data: reqs } = await supabase
         .from('center_document_requirements')
         .select('*')
         .eq('center_id', centerId)
         .order('sort_order', { ascending: true })

      setRequirements(reqs || [])

      // Fetch Statuses
      const { data: statusData } = await supabase
         .from('center_staff_document_status')
         .select('*, matched_document:staff_documents(*)')
         .eq('center_id', centerId)
         .eq('staff_id', staffProfile.id)

      setCenterDocStatuses(statusData || [])

      const statusMap: Record<string, boolean> = {};
      (reqs || []).forEach(req => {
         const assignment = (statusData || []).find(s => s.requirement_id === req.id)
         statusMap[req.id] = (assignment?.status === 'accepted' || assignment?.status === 'pending_review')
      })
      setMatchingStatus(statusMap)
   }

   async function handleAssign(reqId: string, docId: string) {
      if (!activeCenterId || !staffProfile) return

      const { error } = await supabase
         .from('center_staff_document_status')
         .upsert({
            center_id: activeCenterId,
            staff_id: staffProfile.id,
            requirement_id: reqId,
            matched_document_id: docId,
            status: 'pending_review',
            center_reviewed: false
         }, { onConflict: 'center_id,staff_id,requirement_id' })

      if (!error) {
         setLinkingReq(null)
         loadChecklist(activeCenterId)
      }
   }

   async function handleUnlink(statusId: string) {
      const { error } = await supabase
         .from('center_staff_document_status')
         .delete()
         .eq('id', statusId)

      if (error) {
         alert(error.message)
         return
      }

      if (activeCenterId) loadChecklist(activeCenterId)
   }

   async function handleDownloadTemplate(req: CenterDocumentRequirement) {
      if (!req.template_file_key || !req.template_bucket_name) return
      const res = await getPresignedViewUrl(req.template_file_key, req.template_bucket_name)
      if (res.success && res.url) window.open(res.url, '_blank')
   }

   if (loading) return (
      <div className="max-w-4xl animate-pulse">
         <div className="h-40 bg-white rounded-3xl border border-[#e2e8e4] mb-8"></div>
         <div className="h-64 bg-white rounded-3xl border border-[#e2e8e4]"></div>
      </div>
   )

   return (
      <div className="max-w-5xl">
         <div className="mb-10">
            <h1 className="text-4xl font-black text-[#0b3828] mb-2 tracking-tight">My Centers</h1>
            <p className="text-[#6b7a73] text-lg font-medium">Manage your facility applications and credentials.</p>
         </div>

         {/* Center Discovery */}
         <div className="mb-12">
            <div className="bg-white border-2 border-[#157354]/10 rounded-[2rem] p-8 shadow-xl shadow-[#157354]/5">
               <h2 className="text-xl font-black text-[#0b3828] mb-6 flex items-center gap-3">
                  <Search className="w-6 h-6 text-[#157354]" />
                  Find a New Center
               </h2>
               <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 relative">
                     <input
                        type="text"
                        placeholder="Search by Center Name or City..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        className="w-full pl-12 pr-6 py-4 rounded-2xl border-2 border-[#f0f4f2] bg-[#f8faf9] focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all font-medium text-[#0b3828]"
                     />
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#a8b5ae]" />
                  </div>
                  <button
                     onClick={handleSearch}
                     disabled={searching || !searchQuery}
                     className="bg-[#157354] text-white font-black px-8 py-4 rounded-xl hover:bg-[#0f4a36] shadow-lg shadow-[#157354]/20 transition-all disabled:opacity-50"
                  >
                     {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Search'}
                  </button>
               </div>

               {searchResults.length > 0 && (
                  <div className="mt-8 grid gap-4 animate-in fade-in slide-in-from-top-4">
                     {searchResults.map(center => {
                        const isAlreadyMember = myCenters.some(mc => mc.center_id === center.id)
                        return (
                           <div key={center.id} className="flex items-center justify-between p-5 rounded-2xl border-2 border-[#f0f4f2] hover:border-[#157354]/30 transition-all bg-white group">
                              <div className="flex items-center gap-4">
                                 <div className="w-12 h-12 rounded-xl bg-[#edf7f3] flex items-center justify-center shrink-0">
                                    <Building className="w-6 h-6 text-[#157354]" />
                                 </div>
                                 <div>
                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                       <div className="font-black text-[#0b3828] tracking-tight text-lg">{center.name}</div>
                                       {centerRatings[center.id] && (
                                          <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#d97706] bg-[#fffbeb] px-2 py-0.5 rounded-md border border-[#fef3c7]">
                                             <Star className="w-3 h-3 fill-current" />
                                             {centerRatings[center.id].avg.toFixed(1)} ({centerRatings[center.id].count})
                                          </span>
                                       )}
                                    </div>
                                    <div className="text-xs text-[#6b7a73] font-bold uppercase tracking-widest flex items-center gap-2 mt-0.5">
                                       <MapPin className="w-3 h-3" /> {center.city}, {center.state}
                                    </div>
                                 </div>
                              </div>
                              {isAlreadyMember ? (
                                 <span className="text-[10px] font-black uppercase tracking-widest text-[#a8b5ae] px-4 py-2 bg-[#f8faf9] rounded-lg">Already Member</span>
                              ) : (
                                 <button
                                    onClick={() => handleApply(center.id)}
                                    className="flex items-center gap-2 bg-[#edf7f3] text-[#157354] font-black text-xs uppercase tracking-widest px-5 py-3 rounded-xl hover:bg-[#157354] hover:text-white transition-all shadow-sm"
                                 >
                                    <Plus className="w-4 h-4" /> Apply to Join
                                 </button>
                              )}
                           </div>
                        )
                     })}
                  </div>
               )}
            </div>
         </div>

         {/* My Centers List */}
         <div className="space-y-6">
            <h2 className="text-2xl font-black text-[#0b3828] mb-6 px-2">Affiliated Centers</h2>
            {myCenters.length === 0 ? (
               <div className="text-center py-20 bg-white rounded-[2rem] border-2 border-dashed border-[#e2e8e4]">
                  <Globe className="w-12 h-12 text-[#a8b5ae] mx-auto mb-4" />
                  <p className="text-[#6b7a73] font-bold">You aren't associated with any centers yet.</p>
                  <p className="text-sm text-[#a8b5ae] mt-1">Search above to find a facility to join.</p>
               </div>
            ) : (
               myCenters.map(assoc => (
                  <div key={assoc.id} className="bg-white rounded-[2rem] border-2 border-[#f0f4f2] overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                     <div className="p-8 flex flex-col md:flex-row items-center gap-6">
                        <div className="w-16 h-16 rounded-2xl bg-[#157354] flex items-center justify-center shadow-lg shadow-[#157354]/20 shrink-0">
                           <Building className="w-8 h-8 text-white" />
                        </div>
                        <div className="flex-1 text-center md:text-left">
                           <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mb-1">
                              <h3 className="text-2xl font-black text-[#0b3828] leading-tight">{assoc.center.name}</h3>
                              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.1em] border-2 ${assoc.status === 'active' ? 'bg-[#f0fdf4] text-[#157354] border-[#dcfce7]' :
                                    assoc.status === 'applying' ? 'bg-[#fefce8] text-yellow-700 border-yellow-200' :
                                       'bg-[#f8faf9] text-[#6b7a73] border-[#e2e8e4]'
                                 }`}>
                                 {assoc.status}
                              </span>
                              {centerRatings[assoc.center.id] && (
                                 <span className="flex items-center gap-1.5 text-[#d97706] font-black uppercase tracking-[0.1em] text-[10px] bg-[#fffbeb] px-3 py-1 rounded-full border-2 border-[#fef3c7]">
                                    <Star className="w-3.5 h-3.5 fill-current" />
                                    {centerRatings[assoc.center.id].avg.toFixed(1)} ({centerRatings[assoc.center.id].count})
                                 </span>
                              )}
                           </div>
                           <div className="text-[#6b7a73] font-medium flex flex-wrap items-center justify-center md:justify-start gap-4 text-sm mt-2">
                              <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-[#a8b5ae]" /> {assoc.center.city}, {assoc.center.state}</span>
                              <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-[#a8b5ae]" /> Joined {new Date(assoc.added_at).toLocaleDateString()}</span>
                           </div>
                        </div>
                        <div className="flex items-center gap-3">
                           {assoc.status !== 'active' && (
                              <button
                                 onClick={() => activeCenterId === assoc.center_id ? setActiveCenterId(null) : loadChecklist(assoc.center_id)}
                                 className="px-6 py-3 bg-[#157354] text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-[#0f4a36] shadow-lg shadow-[#157354]/20 transition-all"
                              >
                                 {activeCenterId === assoc.center_id ? 'Hide Checklist' : 'Complete Onboarding'}
                              </button>
                           )}
                           {assoc.status === 'active' && (
                              <button
                                 onClick={() => setViewingCenter(assoc.center)}
                                 className="px-6 py-3 border-2 border-[#157354] text-[#157354] font-black text-xs uppercase tracking-widest rounded-xl hover:bg-[#edf7f3] transition-all"
                              >
                                 View Details
                              </button>
                           )}
                        </div>
                     </div>

                     {/* Onboarding Checklist for this center */}
                     {activeCenterId === assoc.center_id && (
                        <div className="p-8 bg-[#f8faf9] border-t-2 border-[#f0f4f2] animate-in slide-in-from-top-4 duration-500">
                           <div className="flex flex-col md:flex-row items-center gap-6 mb-8">
                              <div className="flex-1">
                                 <h4 className="text-xl font-black text-[#0b3828] mb-1 italic">Requirements Checklist</h4>
                                 <p className="text-sm text-[#6b7a73] font-medium">Please link the following documents from your vault to be approved.</p>
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
                        </div>
                     )}
                  </div>
               ))
            )}
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

         {/* Center Details Modal */}
         {viewingCenter && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b3828]/60 backdrop-blur-sm animate-in fade-in duration-200">
               <div className="bg-white rounded-[2rem] w-full max-w-lg overflow-hidden shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between p-6 bg-[#f8faf9] border-b border-[#f0f4f2]">
                     <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-[#157354] flex items-center justify-center shadow-md shadow-[#157354]/20 shrink-0">
                           <Building className="w-6 h-6 text-white" />
                        </div>
                        <div>
                           <h3 className="text-xl font-black text-[#0b3828] leading-none mb-1">{viewingCenter.name}</h3>
                           <span className="text-[10px] font-black uppercase tracking-widest text-[#157354] bg-[#dcfce7] px-2 py-0.5 rounded-md">Approved Staff</span>
                        </div>
                     </div>
                     <button
                        onClick={() => setViewingCenter(null)}
                        className="p-2 text-[#a8b5ae] hover:text-[#0b3828] hover:bg-[#edf7f3] rounded-full transition-colors"
                     >
                        <X className="w-5 h-5" />
                     </button>
                  </div>

                  <div className="p-8 space-y-6">
                     {/* Contact Person */}
                     <div>
                        <div className="flex items-center gap-2 mb-2 text-[#6b7a73]">
                           <User className="w-4 h-4 text-[#a8b5ae]" />
                           <span className="text-xs font-black uppercase tracking-widest">Director / Contact</span>
                        </div>
                        <p className="text-[#0b3828] font-bold text-lg">{viewingCenter.director_name || 'Not provided'}</p>
                     </div>

                     {/* Address */}
                     <div>
                        <div className="flex items-center gap-2 mb-2 text-[#6b7a73]">
                           <MapPin className="w-4 h-4 text-[#a8b5ae]" />
                           <span className="text-xs font-black uppercase tracking-widest">Address</span>
                        </div>
                        <p className="text-[#0b3828] font-bold text-lg leading-tight">
                           {viewingCenter.address && <span className="block">{viewingCenter.address}</span>}
                           {viewingCenter.city}, {viewingCenter.state} {viewingCenter.zip}
                        </p>
                     </div>

                     {/* Phone */}
                     <div>
                        <div className="flex items-center gap-2 mb-2 text-[#6b7a73]">
                           <Phone className="w-4 h-4 text-[#a8b5ae]" />
                           <span className="text-xs font-black uppercase tracking-widest">Phone</span>
                        </div>
                        <p className="text-[#0b3828] font-bold text-lg">
                           {viewingCenter.phone ? (
                              <a href={`tel:${viewingCenter.phone}`} className="hover:text-[#157354] hover:underline transition-colors">{viewingCenter.phone}</a>
                           ) : 'Not provided'}
                        </p>
                     </div>

                     {/* Email */}
                     <div>
                        <div className="flex items-center gap-2 mb-2 text-[#6b7a73]">
                           <Mail className="w-4 h-4 text-[#a8b5ae]" />
                           <span className="text-xs font-black uppercase tracking-widest">Email</span>
                        </div>
                        <p className="text-[#0b3828] font-bold text-lg break-all">
                           {viewingCenter.email ? (
                              <a href={`mailto:${viewingCenter.email}`} className="hover:text-[#157354] hover:underline transition-colors">{viewingCenter.email}</a>
                           ) : 'Not provided'}
                        </p>
                     </div>
                     {/* Reviews Section */}
                     {(centerReviews[viewingCenter.id] || []).length > 0 && (
                        <div className="pt-6 border-t-2 border-[#f0f4f2]">
                           <h4 className="text-lg font-black text-[#0b3828] mb-4 flex items-center gap-2">
                              <Star className="w-5 h-5 text-[#fbbf24] fill-[#fbbf24]" /> Staff Reviews
                           </h4>
                           <div className="grid gap-3">
                              {(centerReviews[viewingCenter.id] || []).map((review: any) => (
                                 <div key={review.id} className="p-4 rounded-2xl bg-[#f8faf9] border border-[#e2e8e4]">
                                    <div className="flex items-center justify-between mb-2">
                                       <div className="font-bold text-[#1a2e25] text-sm">{review.reviewer_name}</div>
                                       <div className="flex gap-1">
                                          {[...Array(5)].map((_, i) => (
                                             <Star key={i} className={`w-3.5 h-3.5 ${i < review.rating ? 'text-[#fbbf24] fill-[#fbbf24]' : 'text-[#e2e8e4] fill-transparent'}`} />
                                          ))}
                                       </div>
                                    </div>
                                    {review.tags && review.tags.length > 0 && (
                                       <div className="flex flex-wrap gap-1.5 mb-2">
                                          {review.tags.map((tag: string) => (
                                             <span key={tag} className="text-[9px] font-black uppercase tracking-widest bg-[#edf7f3] text-[#157354] px-2 py-1 rounded-md border border-[#d4ede4]">
                                                {tag}
                                             </span>
                                          ))}
                                       </div>
                                    )}
                                    {review.public_comment && (
                                       <p className="text-xs text-[#3d5a4f] italic mt-2 bg-white p-3 rounded-xl border border-[#e2e8e4]">"{review.public_comment}"</p>
                                    )}
                                 </div>
                              ))}
                           </div>
                        </div>
                     )}
                  </div>

                  <div className="p-6 bg-[#f8faf9] border-t border-[#f0f4f2]">
                     <button
                        onClick={() => setViewingCenter(null)}
                        className="w-full py-4 text-center bg-[#157354] text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-[#0f4a36] shadow-lg shadow-[#157354]/20 transition-all"
                     >
                        Close Details
                     </button>
                  </div>
               </div>
            </div>
         )}
      </div>
   )
}

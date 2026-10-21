'use client'

import { useEffect, useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
   Building,
   Search,
   Globe,
   Loader2,
   Plus,
   MapPin,
   Clock,
   Phone,
   Mail,
   User,
   X,
   Star
} from 'lucide-react'
import {
   Center,
   EmploymentClass,
   EMPLOYMENT_CLASS_LABELS
} from '@/lib/types'
import { CenterChecklist } from '@/components/staff/CenterChecklist'
import { showAlert, showConfirm } from '@/lib/dialog'
import { leaveCenter } from '@/app/actions/jobs.actions'

export default function MyCentersPage() {
   return (
      <Suspense fallback={<div className="p-10 text-muted font-medium">Loading centers...</div>}>
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
   // Class requested per center when applying (the center confirms it on approval)
   const [applyClass, setApplyClass] = useState<Record<string, EmploymentClass>>({})

   // Checklist State
   const [activeCenterId, setActiveCenterId] = useState<string | null>(null)
   const [leavingId, setLeavingId] = useState<string | null>(null)

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

         // 3. Fetch Reviews for affiliated centers
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

      const requestedClass = applyClass[centerId] ?? staffProfile.requested_employment_class ?? 'substitute'
      // Left earlier (or was declined): the old link is reopened rather than inserted again
      const previous = myCenters.some(mc => mc.center_id === centerId && mc.status === 'removed')
      const { error } = previous
         ? await supabase.rpc('reapply_to_center', { p_center_id: centerId, p_class: requestedClass })
         : await supabase
            .from('center_staff')
            .insert({
               center_id: centerId,
               staff_id: staffProfile.id,
               status: 'applying',
               requested_employment_class: requestedClass
            })

      if (error) {
         showAlert(error.message)
      } else {
         setSearchQuery('')
         setSearchResults([])
         loadInitialData()
      }
   }

   async function handleLeave(assoc: any) {
      const ok = await showConfirm(
         `Leave ${assoc.center.name}? You will no longer see or claim their shifts, and any pending shift requests there are withdrawn. To work there again you would apply to join.`,
         { title: 'Leave center', confirmLabel: 'Leave center' }
      )
      if (!ok) return
      setLeavingId(assoc.center_id)
      const res = await leaveCenter(assoc.center_id)
      setLeavingId(null)
      if (!res.success) { showAlert(res.error); return }
      loadInitialData()
   }

   if (loading) return (
      <div className="max-w-5xl animate-pulse">
         <div className="h-40 bg-white rounded-3xl border border-border mb-8"></div>
         <div className="h-64 bg-white rounded-3xl border border-border"></div>
      </div>
   )

   return (
      <div className="max-w-5xl">
         <div className="mb-10">
            <h1 className="text-4xl font-black text-heading mb-2 tracking-tight">My Centers</h1>
            <p className="text-muted text-lg font-medium">Manage your facility applications and credentials.</p>
         </div>

         {/* Center Discovery */}
         <div className="mb-12">
            <h2 className="text-2xl font-black text-heading mb-6 px-2">Find a New Center</h2>
            <div className="bg-white border-2 border-brand-600/10 rounded-[2rem] p-8 shadow-xl shadow-brand-600/5">
               <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 relative">
                     <input
                        type="text"
                        placeholder="Search by Center Name or City..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        className="w-full pl-12 pr-6 py-4 rounded-2xl border-2 border-border bg-surface focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-medium text-heading"
                     />
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-subtle" />
                  </div>
                  <button
                     onClick={handleSearch}
                     disabled={searching || !searchQuery}
                     className="bg-brand-600 text-white font-black px-8 py-4 rounded-xl hover:bg-brand-800 shadow-lg shadow-brand-600/20 transition-all disabled:opacity-50"
                  >
                     {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Search'}
                  </button>
               </div>

               {searchResults.length > 0 && (
                  <div className="mt-8 grid gap-4 animate-in fade-in slide-in-from-top-4">
                     {searchResults.map(center => {
                        const isAlreadyMember = myCenters.some(mc => mc.center_id === center.id && mc.status !== 'removed')
                        return (
                           <div key={center.id} className="flex items-center justify-between p-5 rounded-2xl border-2 border-border hover:border-brand-600/30 transition-all bg-white group">
                              <div className="flex items-center gap-4">
                                 <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                                    <Building className="w-6 h-6 text-brand-600" />
                                 </div>
                                 <div>
                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                       <div className="font-black text-heading tracking-tight text-lg">{center.name}</div>
                                       {centerRatings[center.id] && (
                                          <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-amber-600 bg-[#fffbeb] px-2 py-0.5 rounded-md border border-[#fef3c7]">
                                             <Star className="w-3 h-3 fill-current" />
                                             {centerRatings[center.id].avg.toFixed(1)} ({centerRatings[center.id].count})
                                          </span>
                                       )}
                                    </div>
                                    <div className="text-xs text-muted font-bold uppercase tracking-widest flex items-center gap-2 mt-0.5">
                                       <MapPin className="w-3 h-3" /> {center.city}, {center.state}
                                    </div>
                                 </div>
                              </div>
                              {isAlreadyMember ? (
                                 <span className="text-[10px] font-black uppercase tracking-widest text-subtle px-4 py-2 bg-surface rounded-lg">Already Member</span>
                              ) : (
                                 <div className="flex items-center gap-3">
                                 <select
                                    value={applyClass[center.id] ?? staffProfile?.requested_employment_class ?? 'substitute'}
                                    onChange={(e) => setApplyClass(prev => ({ ...prev, [center.id]: e.target.value as EmploymentClass }))}
                                    aria-label="Job classification"
                                    className="px-3 py-3 rounded-xl border-2 border-border bg-white text-xs font-black uppercase tracking-widest text-brand-600 focus:outline-none focus:border-brand-600"
                                 >
                                    {(Object.entries(EMPLOYMENT_CLASS_LABELS) as [EmploymentClass, string][]).map(([value, label]) => (
                                       <option key={value} value={value}>{label}</option>
                                    ))}
                                 </select>
                                 <button
                                    onClick={() => handleApply(center.id)}
                                    className="flex items-center gap-2 bg-brand-50 text-brand-600 font-black text-xs uppercase tracking-widest px-5 py-3 rounded-xl hover:bg-brand-600 hover:text-white transition-all shadow-sm"
                                 >
                                    <Plus className="w-4 h-4" /> Apply to Join
                                 </button>
                                 </div>
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
            <h2 className="text-2xl font-black text-heading mb-6 px-2">Affiliated Centers</h2>
            {myCenters.filter(mc => mc.status !== 'removed').length === 0 ? (
               <div className="text-center py-20 bg-white rounded-[2rem] border-2 border-dashed border-border">
                  <Globe className="w-12 h-12 text-subtle mx-auto mb-4" />
                  <p className="text-muted font-bold">You aren't associated with any centers yet.</p>
                  <p className="text-sm text-subtle mt-1">Search above to find a facility to join.</p>
               </div>
            ) : (
               myCenters.filter(mc => mc.status !== 'removed').map(assoc => (
                  <div key={assoc.id} className="bg-white rounded-[2rem] border-2 border-border overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                     <div className="p-8 flex flex-col md:flex-row items-center gap-6">
                        <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center shadow-lg shadow-brand-600/20 shrink-0">
                           <Building className="w-8 h-8 text-white" />
                        </div>
                        <div className="flex-1 text-center md:text-left">
                           <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mb-1">
                              <h3 className="text-2xl font-black text-heading leading-tight">{assoc.center.name}</h3>
                              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.1em] border-2 ${assoc.status === 'active' ? 'bg-brand-50 text-brand-600 border-[#dcfce7]' :
                                    assoc.status === 'applying' ? 'bg-[#fefce8] text-yellow-700 border-yellow-200' :
                                       'bg-surface text-muted border-border'
                                 }`}>
                                 {assoc.status}
                              </span>
                              {(assoc.status === 'active' ? assoc.employment_class : (assoc.requested_employment_class ?? assoc.employment_class)) && (
                                 <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.1em] border-2 bg-brand-50 text-brand-600 border-brand-100">
                                    {EMPLOYMENT_CLASS_LABELS[(assoc.status === 'active' ? assoc.employment_class : (assoc.requested_employment_class ?? assoc.employment_class)) as EmploymentClass]}
                                    {assoc.status !== 'active' && ' (requested)'}
                                 </span>
                              )}
                              {centerRatings[assoc.center.id] && (
                                 <span className="flex items-center gap-1.5 text-amber-600 font-black uppercase tracking-[0.1em] text-[10px] bg-[#fffbeb] px-3 py-1 rounded-full border-2 border-[#fef3c7]">
                                    <Star className="w-3.5 h-3.5 fill-current" />
                                    {centerRatings[assoc.center.id].avg.toFixed(1)} ({centerRatings[assoc.center.id].count})
                                 </span>
                              )}
                           </div>
                           <div className="text-muted font-medium flex flex-wrap items-center justify-center md:justify-start gap-4 text-sm mt-2">
                              <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-subtle" /> {assoc.center.city}, {assoc.center.state}</span>
                              <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-subtle" /> Joined {new Date(assoc.added_at).toLocaleDateString()}</span>
                           </div>
                        </div>
                        <div className="flex items-center gap-3">
                           {assoc.status !== 'active' && (
                              <button
                                 onClick={() => activeCenterId === assoc.center_id ? setActiveCenterId(null) : setActiveCenterId(assoc.center_id)}
                                 className="px-6 py-3 bg-brand-600 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-brand-800 shadow-lg shadow-brand-600/20 transition-all"
                              >
                                 {activeCenterId === assoc.center_id ? 'Hide Checklist' : 'Complete Onboarding'}
                              </button>
                           )}
                           {assoc.status === 'active' && (
                              <button
                                 onClick={() => setViewingCenter(assoc.center)}
                                 className="px-6 py-3 border-2 border-brand-600 text-brand-600 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-brand-50 transition-all"
                              >
                                 View Details
                              </button>
                           )}
                           {(assoc.status === 'active' || assoc.status === 'inactive') && (
                              <button
                                 onClick={() => handleLeave(assoc)}
                                 disabled={leavingId === assoc.center_id}
                                 className="px-6 py-3 border-2 border-red-100 text-red-600 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-red-50 transition-all disabled:opacity-50"
                              >
                                 {leavingId === assoc.center_id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Leave'}
                              </button>
                           )}
                        </div>
                     </div>

                     {/* Onboarding Checklist for this center */}
                     {activeCenterId === assoc.center_id && (
                        <div className="p-8 bg-surface border-t-2 border-border animate-in slide-in-from-top-4 duration-500">
                           <CenterChecklist centerId={assoc.center_id} staffId={staffProfile.id} employmentClass={(assoc.status === 'active' ? assoc.employment_class : (assoc.requested_employment_class ?? assoc.employment_class))} />
                        </div>
                     )}
                  </div>
               ))
            )}
         </div>

         {/* Center Details Modal */}
         {viewingCenter && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-900/60 backdrop-blur-sm animate-in fade-in duration-200">
               <div className="bg-white rounded-[2rem] w-full max-w-lg overflow-hidden shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between p-6 bg-surface border-b border-border">
                     <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-brand-600 flex items-center justify-center shadow-md shadow-brand-600/20 shrink-0">
                           <Building className="w-6 h-6 text-white" />
                        </div>
                        <div>
                           <h3 className="text-xl font-black text-heading leading-none mb-1">{viewingCenter.name}</h3>
                           <span className="text-[10px] font-black uppercase tracking-widest text-brand-600 bg-[#dcfce7] px-2 py-0.5 rounded-md">Approved Staff</span>
                        </div>
                     </div>
                     <button
                        onClick={() => setViewingCenter(null)}
                        className="p-2 text-subtle hover:text-heading hover:bg-brand-50 rounded-full transition-colors"
                     >
                        <X className="w-5 h-5" />
                     </button>
                  </div>

                  <div className="p-8 space-y-6">
                     {/* Contact Person */}
                     <div>
                        <div className="flex items-center gap-2 mb-2 text-muted">
                           <User className="w-4 h-4 text-subtle" />
                           <span className="text-xs font-black uppercase tracking-widest">Director / Contact</span>
                        </div>
                        <p className="text-heading font-bold text-lg">{viewingCenter.director_name || 'Not provided'}</p>
                     </div>

                     {/* Address */}
                     <div>
                        <div className="flex items-center gap-2 mb-2 text-muted">
                           <MapPin className="w-4 h-4 text-subtle" />
                           <span className="text-xs font-black uppercase tracking-widest">Address</span>
                        </div>
                        <p className="text-heading font-bold text-lg leading-tight">
                           {viewingCenter.address && <span className="block">{viewingCenter.address}</span>}
                           {viewingCenter.city}, {viewingCenter.state} {viewingCenter.zip}
                        </p>
                     </div>

                     {/* Phone */}
                     <div>
                        <div className="flex items-center gap-2 mb-2 text-muted">
                           <Phone className="w-4 h-4 text-subtle" />
                           <span className="text-xs font-black uppercase tracking-widest">Phone</span>
                        </div>
                        <p className="text-heading font-bold text-lg">
                           {viewingCenter.phone ? (
                              <a href={`tel:${viewingCenter.phone}`} className="hover:text-brand-600 hover:underline transition-colors">{viewingCenter.phone}</a>
                           ) : 'Not provided'}
                        </p>
                     </div>

                     {/* Email */}
                     <div>
                        <div className="flex items-center gap-2 mb-2 text-muted">
                           <Mail className="w-4 h-4 text-subtle" />
                           <span className="text-xs font-black uppercase tracking-widest">Email</span>
                        </div>
                        <p className="text-heading font-bold text-lg break-all">
                           {viewingCenter.email ? (
                              <a href={`mailto:${viewingCenter.email}`} className="hover:text-brand-600 hover:underline transition-colors">{viewingCenter.email}</a>
                           ) : 'Not provided'}
                        </p>
                     </div>
                     {/* Reviews Section */}
                     {(centerReviews[viewingCenter.id] || []).length > 0 && (
                        <div className="pt-6 border-t-2 border-border">
                           <h4 className="text-lg font-black text-heading mb-4 flex items-center gap-2">
                              <Star className="w-5 h-5 text-amber-400 fill-amber-400" /> Staff Reviews
                           </h4>
                           <div className="grid gap-3">
                              {(centerReviews[viewingCenter.id] || []).map((review: any) => (
                                 <div key={review.id} className="p-4 rounded-2xl bg-surface border border-border">
                                    <div className="flex items-center justify-between mb-2">
                                       <div className="font-bold text-text-main text-sm">{review.reviewer_name}</div>
                                       <div className="flex gap-1">
                                          {[...Array(5)].map((_, i) => (
                                             <Star key={i} className={`w-3.5 h-3.5 ${i < review.rating ? 'text-amber-400 fill-amber-400' : 'text-border fill-transparent'}`} />
                                          ))}
                                       </div>
                                    </div>
                                    {review.tags && review.tags.length > 0 && (
                                       <div className="flex flex-wrap gap-1.5 mb-2">
                                          {review.tags.map((tag: string) => (
                                             <span key={tag} className="text-[9px] font-black uppercase tracking-widest bg-brand-50 text-brand-600 px-2 py-1 rounded-md border border-brand-100">
                                                {tag}
                                             </span>
                                          ))}
                                       </div>
                                    )}
                                    {review.public_comment && (
                                       <p className="text-xs text-text-muted italic mt-2 bg-white p-3 rounded-xl border border-border">"{review.public_comment}"</p>
                                    )}
                                 </div>
                              ))}
                           </div>
                        </div>
                     )}
                  </div>

                  <div className="p-6 bg-surface border-t border-border">
                     <button
                        onClick={() => setViewingCenter(null)}
                        className="w-full py-4 text-center bg-brand-600 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-brand-800 shadow-lg shadow-brand-600/20 transition-all"
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

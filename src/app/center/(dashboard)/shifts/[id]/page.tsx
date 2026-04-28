'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import { Shift, Classroom } from '@/lib/types'
import { useStaffRoles } from '@/lib/hooks/useStaffRoles'
import { 
  Calendar, Clock, MapPin, ArrowLeft, 
  CheckCircle2, AlertCircle, Loader2, Save, 
  Trash2, User, Phone, Mail, ShieldCheck, Edit3, AlertTriangle, X
} from 'lucide-react'
import Link from 'next/link'

export default function ShiftDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const supabase = createClient()
  const shiftId = Array.isArray(id) ? id[0] : id
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  
  const [shift, setShift] = useState<any>(null)
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [claims, setClaims] = useState<any[]>([])
  const [centerId, setCenterId] = useState<string | null>(null)
  const { roles: staffRoles } = useStaffRoles(centerId)

  // Form State (for Edit)
  const [editDate, setEditDate] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [editRate, setEditRate] = useState('')
  const [editMode, setEditMode] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editClassroom, setEditClassroom] = useState('')

  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelSubmitting, setCancelSubmitting] = useState(false)
  const [cancelModalError, setCancelModalError] = useState<string | null>(null)

  useEffect(() => {
    loadShiftData()
  }, [shiftId])

  async function loadShiftData() {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      if (!shiftId) return

      // 1. Fetch Shift
      const { data: shiftData, error: sError } = await supabase
        .from('shifts')
        .select(`
          *,
          classrooms (*)
        `)
        .eq('id', shiftId)
        .single()

      if (sError) throw sError
      setShift(shiftData)
      setCenterId(shiftData.center_id)

      // Initialize Edit State
      setEditDate(shiftData.shift_date)
      setEditStart(shiftData.start_time.substring(0, 5))
      setEditEnd(shiftData.end_time.substring(0, 5))
      setEditRate(shiftData.hourly_rate?.toString() || '20.00')
      setEditMode(shiftData.payment_mode || 'payroll')
      setEditNotes(shiftData.notes || '')
      setEditClassroom(shiftData.classroom_id || 'any')

      // 2. Fetch Claims
      const { data: claimsData } = await supabase
        .from('shift_claims')
        .select(`
          *,
          staff_profiles (*)
        `)
        .eq('shift_id', shiftId)
        .order('claimed_at', { ascending: false })
      
      setClaims(claimsData || [])

      // 3. Fetch Classrooms for selector
      const { data: rooms } = await supabase
        .from('classrooms')
        .select('*')
        .eq('center_id', shiftData.center_id)
      
      setClassrooms(rooms || [])

    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdate() {
    try {
      setSaving(true)
      const { error: uError } = await supabase
        .from('shifts')
        .update({
          shift_date: editDate,
          start_time: editStart + ':00',
          end_time: editEnd + ':00',
          hourly_rate: parseFloat(editRate),
          payment_mode: editMode,
          notes: editNotes,
          classroom_id: editClassroom === 'any' ? null : editClassroom
        })
        .eq('id', shiftId)

      if (uError) throw uError
      
      setIsEditing(false)
      loadShiftData()
    } catch (err: any) {
      alert("Failed to update: " + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleClaimAction(claimId: string, status: 'confirmed' | 'cancelled') {
    try {
      const { error: cError } = await supabase
        .from('shift_claims')
        .update({ status })
        .eq('id', claimId)
      
      if (cError) throw cError

      // If confirming, mark shift as filled
      if (status === 'confirmed') {
        await supabase
          .from('shifts')
          .update({ status: 'filled' })
          .eq('id', shiftId)
      }

      loadShiftData()
    } catch (err: any) {
      alert("Action failed: " + err.message)
    }
  }

  function openCancelShiftModal() {
    setCancelModalError(null)
    setCancelModalOpen(true)
  }

  function closeCancelShiftModal() {
    if (cancelSubmitting) return
    setCancelModalOpen(false)
    setCancelModalError(null)
  }

  async function confirmCancelShift() {
    setCancelSubmitting(true)
    setCancelModalError(null)
    const { error } = await supabase.from('shifts').update({ status: 'cancelled' }).eq('id', shiftId)
    setCancelSubmitting(false)
    if (error) {
      setCancelModalError(error.message)
      return
    }
    setCancelModalOpen(false)
    router.push('/center/shifts')
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 animate-pulse">
        <Loader2 className="w-12 h-12 text-[#157354] animate-spin mb-4" />
        <p className="text-[#6b7a73] font-black uppercase tracking-widest text-xs">Retrieving shift details...</p>
      </div>
    )
  }

  if (error || !shift) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-black text-[#0b3828] mb-2">Shift not found</h2>
        <p className="text-[#6b7a73] mb-8">{error || "The shift you're looking for doesn't exist or has been removed."}</p>
        <Link href="/center/shifts" className="bg-[#157354] text-white px-8 py-3 rounded-2xl font-bold transition-all hover:scale-105 inline-block">
          Return to Shifts
        </Link>
      </div>
    )
  }

  const isFilled = shift.status === 'filled'
  const confirmedClaim = claims.find(c => c.status === 'confirmed')

  return (
    <div className="max-w-6xl mx-auto pb-24">
      {/* Header */}
      <div className="mb-8">
        <Link 
          href="/center/shifts" 
          className="inline-flex items-center gap-2 text-[#6b7a73] hover:text-[#157354] font-bold text-sm mb-6 transition-all group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Back to Dashboard
        </Link>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border-2 ${
                shift.status === 'open' ? 'bg-[#d4ede4] text-[#0f4a36] border-[#157354]/10' :
                shift.status === 'filled' ? 'bg-[#f0fdf4] text-[#16a34a] border-emerald-100' :
                'bg-slate-100 text-slate-500 border-slate-200'
              }`}>
                {shift.status}
              </span>
              <span className="text-[#a8b5ae] font-bold text-xs">ID: {shift.id.substring(0,8)}</span>
            </div>
            <h1 className="text-3xl font-extrabold text-[#0b3828]">
               {isEditing ? "Editing Shift" : `${shift.classrooms?.name || 'Any Room'} Shift`}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {isEditing ? (
              <>
                <button 
                  onClick={() => setIsEditing(false)}
                  className="px-6 py-3 rounded-xl border border-[#e2e8e4] text-[#6b7a73] font-semibold hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleUpdate}
                  disabled={saving}
                  className="flex items-center gap-2 bg-[#157354] text-white px-8 py-3 rounded-xl font-semibold shadow-sm hover:bg-[#0f4a36] transition-colors disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} Save Changes
                </button>
              </>
            ) : (
              <button 
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 bg-white text-[#157354] border border-[#157354]/20 px-8 py-3 rounded-xl font-semibold shadow-sm hover:border-[#157354] transition-colors"
              >
                <Edit3 className="w-5 h-5" /> Edit Shift
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Col: Details */}
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white border border-[#e2e8e4] rounded-2xl p-8 shadow-sm relative overflow-hidden">
            {/* Background design */}
            <div className="absolute top-0 right-0 w-48 h-48 bg-[#edf7f3] rounded-full -mr-24 -mt-24 opacity-60"></div>
            
            {isEditing ? (
              <div className="space-y-8 relative z-10">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Shift Date</label>
                       <input 
                         type="date"
                         value={editDate}
                         onChange={(e) => setEditDate(e.target.value)}
                         className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                       />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Classroom</label>
                       <select 
                         value={editClassroom}
                         onChange={(e) => setEditClassroom(e.target.value)}
                         className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                       >
                         <option value="any">Float / No specific room</option>
                         {classrooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                 </div>

                 <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Start</label>
                       <input type="time" value={editStart} onChange={(e) => setEditStart(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">End</label>
                       <input type="time" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Rate ($/hr)</label>
                       <input type="number" step="0.5" value={editRate} onChange={(e) => setEditRate(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#157354] font-semibold" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Mode</label>
                       <select value={editMode} onChange={(e) => setEditMode(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]">
                         <option value="payroll">Payroll</option>
                         <option value="venmo">Venmo</option>
                         <option value="cash">Cash</option>
                         <option value="check">Check</option>
                         <option value="zelle">Zelle</option>
                      </select>
                    </div>
                 </div>

                 <div>
                     <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Notes for Staff</label>
                     <textarea 
                       value={editNotes} 
                       onChange={(e) => setEditNotes(e.target.value)} 
                       rows={4}
                       className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25] resize-none"
                     />
                 </div>
              </div>
            ) : (
              <div className="relative z-10">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                   <div className="space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-[#a8b5ae]">Date</div>
                      <div className="text-xl font-black text-[#1a2e25]">{new Date(shift.shift_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                   </div>
                   <div className="space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-[#a8b5ae]">Hours</div>
                      <div className="text-xl font-black text-[#1a2e25]">{shift.start_time.substring(0,5)} - {shift.end_time.substring(0,5)}</div>
                   </div>
                   <div className="space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-[#a8b5ae]">Pay Rate</div>
                      <div className="text-xl font-black text-[#157354]">${shift.hourly_rate || '0.00'} / hr</div>
                   </div>
                   <div className="space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-[#a8b5ae]">Method</div>
                      <div className="text-xl font-black text-[#1a2e25] capitalize">{shift.payment_mode || 'Payroll'}</div>
                   </div>
                </div>

                <div className="bg-[#f8faf9] rounded-3xl p-8 border-2 border-[#f0f4f2]">
                   <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#a8b5ae] mb-4">Internal Notes</div>
                   <p className="text-[#3d5a4f] leading-relaxed font-medium">
                      {shift.notes || "No additional notes provided for this shift."}
                   </p>
                </div>
              </div>
            )}
          </div>

          {/* Claims section */}
          <div className="bg-white border border-[#e2e8e4] rounded-2xl p-8 shadow-sm">
             <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-bold text-[#0b3828] tracking-tight">Educator Claims</h2>
                <div className="px-4 py-1.5 bg-[#edf7f3] text-[#157354] rounded-xl text-[10px] font-black uppercase tracking-widest">
                   {claims.length} Interested
                </div>
             </div>

             {claims.length === 0 ? (
               <div className="py-12 text-center">
                  <User className="w-12 h-12 text-[#e2e8e4] mx-auto mb-3" />
                  <p className="text-[#6b7a73] font-bold">No claims yet. This shift is still exploring the marketplace.</p>
               </div>
             ) : (
               <div className="space-y-4">
                  {claims.map((claim) => (
                    <div key={claim.id} className="flex flex-col md:flex-row md:items-center justify-between p-6 rounded-[1.75rem] border-2 border-[#f8faf9] hover:border-[#157354]/10 transition-all bg-[#fcfdfd]">
                       <div className="flex items-center gap-4 mb-4 md:mb-0">
                          <div className="w-14 h-14 rounded-2xl bg-[#157354] text-white flex items-center justify-center font-black text-xl shadow-lg ring-4 ring-[#edf7f3]">
                             {claim.staff_profiles?.first_name?.[0] || "?"}
                          </div>
                          <div>
                             <div className="font-black text-[#1a2e25] text-lg leading-tight">
                                {claim.staff_profiles?.first_name} {claim.staff_profiles?.last_name}
                             </div>
                             <div className="flex items-center gap-3 mt-1">
                                <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${
                                   claim.status === 'confirmed' ? 'bg-[#f0fdf4] text-[#16a34a]' :
                                   claim.status === 'pending' ? 'bg-[#fffbeb] text-[#d97706]' :
                                   'bg-slate-100 text-slate-500'
                                }`}>
                                   {claim.status}
                                </span>
                                <span className="text-[10px] text-[#a8b5ae] font-medium">Claimed {new Date(claim.claimed_at).toLocaleDateString()}</span>
                             </div>
                          </div>
                       </div>
                       
                       <div className="flex items-center gap-2 self-end md:self-auto">
                          {claim.status === 'pending' && (
                             <>
                               <button 
                                 onClick={() => handleClaimAction(claim.id, 'cancelled')}
                                 className="px-5 py-2.5 rounded-xl text-red-500 font-bold hover:bg-red-50 transition-all text-xs"
                               >
                                  Decline
                               </button>
                               <button 
                                 onClick={() => handleClaimAction(claim.id, 'confirmed')}
                                 className="px-6 py-2.5 bg-[#157354] text-white rounded-xl font-bold shadow-md hover:scale-105 transition-all active:scale-95 text-xs flex items-center gap-2"
                               >
                                  <ShieldCheck className="w-4 h-4" /> Confirm Staff
                               </button>
                             </>
                          )}
                          {claim.status === 'confirmed' && (
                             <div className="flex items-center gap-2 text-[#16a34a] font-black text-xs uppercase tracking-widest bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100 italic">
                                <CheckCircle2 className="w-4 h-4" /> Finalized
                             </div>
                          )}
                       </div>
                    </div>
                  ))}
               </div>
             )}
          </div>
        </div>

        {/* Right Col: Staff Sidebar */}
        <div className="space-y-8">
           {isFilled && confirmedClaim ? (
             <div className="bg-[#157354] rounded-2xl p-8 text-white shadow-lg shadow-[#157354]/20">
                <div className="flex items-center gap-2 text-[#a9dac9] font-black uppercase tracking-[0.25em] text-[10px] mb-6">
                   <User className="w-3.5 h-3.5" /> Assigned Professional
                </div>
                <div className="flex items-center gap-5 mb-8">
                   <div className="w-20 h-20 rounded-3xl bg-white/10 flex items-center justify-center text-3xl font-black border-2 border-white/10">
                      {confirmedClaim.staff_profiles?.first_name?.[0]}
                   </div>
                   <div>
                      <div className="text-2xl font-black leading-tight">
                         {confirmedClaim.staff_profiles?.first_name}<br/>
                         {confirmedClaim.staff_profiles?.last_name}
                      </div>
                      <div className="text-[#a9dac9] text-sm font-medium mt-1 uppercase tracking-widest text-[10px]">VERIFIED EDUCATOR</div>
                   </div>
                </div>
                <div className="space-y-4 pt-6 border-t border-white/10">
                   <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-[#a9dac9]">
                         <Mail className="w-5 h-5" />
                      </div>
                      <div className="text-sm font-medium truncate">{confirmedClaim.staff_profiles?.email}</div>
                   </div>
                   <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-[#a9dac9]">
                         <Phone className="w-5 h-5" />
                      </div>
                      <div className="text-sm font-medium">{confirmedClaim.staff_profiles?.phone || "No phone provided"}</div>
                   </div>
                </div>
                <button className="w-full mt-10 bg-white text-[#157354] py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg hover:bg-[#f8faf9] transition-all active:scale-95">
                   Message Educator
                </button>
             </div>
           ) : (
             <div className="bg-[#edf7f3] border border-[#157354]/10 rounded-2xl p-10 text-center">
                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm">
                   <ShieldCheck className="w-8 h-8 text-[#157354] transition-all" />
                </div>
                <h3 className="text-xl font-black text-[#0b3828] mb-2 tracking-tight leading-none">Awaiting Claims</h3>
                <p className="text-[#6b7a73] font-medium text-sm leading-relaxed px-2">
                   This shift is currently live in the expansion marketplace. You'll be notified as soon as a professional educator claims it.
                </p>
                <div className="mt-8 pt-6 border-t border-[#157354]/5">
                   <div className="font-black text-[#157354] text-[10px] uppercase tracking-widest mb-4">Discovery Status</div>
                   <div className="flex items-center justify-center gap-1.5">
                      {[1,2,3,4,5].map(i => (
                        <div key={i} className={`h-1 rounded-full flex-1 ${i <= 3 ? 'bg-[#157354]' : 'bg-[#157354]/10'}`}></div>
                      ))}
                   </div>
                </div>
             </div>
           )}
           
           <div className="bg-[#f8faf9] border border-[#e2e8e4] rounded-2xl p-8">
              <h4 className="font-black text-[#1a2e25] mb-6 uppercase tracking-widest text-xs">Danger Zone</h4>
              {shift.status === 'cancelled' ? (
                <div
                  role="status"
                  className="flex items-start gap-3 rounded-2xl border-2 border-red-100 bg-red-50/80 px-5 py-4 text-sm text-red-900"
                >
                  <AlertTriangle className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
                  <div>
                    <p className="font-black text-red-900 uppercase tracking-wide text-xs mb-1">Shift cancelled</p>
                    <p className="text-red-800/90 font-medium leading-relaxed">
                      This shift is no longer active. Staff who had shown interest may still see it as closed in their history.
                    </p>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={openCancelShiftModal}
                  className="w-full flex items-center justify-center gap-2 bg-white text-red-600 border-2 border-red-100 px-6 py-4 rounded-2xl font-bold hover:bg-red-50 hover:border-red-200 transition-all text-sm shadow-sm"
                >
                  <Trash2 className="w-4 h-4" /> Cancel shift
                </button>
              )}
           </div>
        </div>
      </div>

      {cancelModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b3828]/50 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-shift-title"
          aria-describedby="cancel-shift-desc"
          onClick={cancelSubmitting ? undefined : closeCancelShiftModal}
        >
          <div
            className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border-2 border-red-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative bg-gradient-to-br from-red-50 to-amber-50/40 px-8 pt-10 pb-6 border-b border-red-100">
              <button
                type="button"
                onClick={closeCancelShiftModal}
                disabled={cancelSubmitting}
                className="absolute right-5 top-5 p-2 rounded-full text-[#6b7a73] hover:bg-white/80 hover:text-[#0b3828] transition-colors disabled:opacity-40"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-red-600 text-white flex items-center justify-center shadow-lg shadow-red-600/25 shrink-0">
                  <AlertTriangle className="w-7 h-7" strokeWidth={2.25} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-700/80 mb-1">Irreversible action</p>
                  <h2 id="cancel-shift-title" className="text-2xl font-black text-[#0b3828] tracking-tight leading-tight">
                    Cancel this shift?
                  </h2>
                </div>
              </div>
            </div>
            <div className="px-8 py-6 space-y-4">
              <p id="cancel-shift-desc" className="text-[#3d5a4f] font-medium leading-relaxed text-sm">
                The shift will be marked <span className="font-black text-red-700">cancelled</span> and removed from the marketplace.
                {claims.length > 0 && (
                  <span className="block mt-3 pt-3 border-t border-[#f0f4f2] text-amber-900">
                    <span className="font-black text-xs uppercase tracking-widest text-amber-800">Heads up:</span>{' '}
                    {claims.length} educator{claims.length === 1 ? ' has' : 's have'} already submitted interest or claims — consider messaging them from your roster if needed.
                  </span>
                )}
              </p>
              {cancelModalError && (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                >
                  <AlertCircle className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
                  <div>
                    <p className="font-black text-xs uppercase tracking-wide text-red-800 mb-0.5">Could not cancel</p>
                    <p className="text-red-900/90 font-medium break-words">{cancelModalError}</p>
                  </div>
                </div>
              )}
            </div>
            <div className="px-8 pb-8 flex flex-col-reverse sm:flex-row gap-3">
              <button
                type="button"
                onClick={closeCancelShiftModal}
                disabled={cancelSubmitting}
                className="flex-1 py-4 px-6 rounded-2xl border-2 border-[#e2e8e4] font-black text-xs text-[#3d5a4f] hover:bg-[#f8faf9] transition-all disabled:opacity-50 uppercase tracking-widest"
              >
                Keep shift
              </button>
              <button
                type="button"
                onClick={confirmCancelShift}
                disabled={cancelSubmitting}
                className="flex-1 py-4 px-6 rounded-2xl bg-red-600 text-white font-black text-xs uppercase tracking-widest hover:bg-red-700 shadow-lg shadow-red-600/25 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {cancelSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Cancelling…
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" /> Yes, cancel shift
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Calendar, Clock, AlertCircle, Loader2, Heart, Plus, Star, LogIn, LogOut, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { submitReview } from '@/app/actions/reviews.actions'
import { checkInStaff, checkOutStaff } from '@/app/actions/timeclock.actions'
import { ReviewModal } from '@/components/ReviewModal'

export default function CenterShiftsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [shifts, setShifts] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reviewingShift, setReviewingShift] = useState<any>(null)
  const [reviewingStaffId, setReviewingStaffId] = useState<string | null>(null)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  useEffect(() => {
    async function loadShifts() {
      try {
        setLoading(true)

        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError || !user) {
          setError('Authentication error. Please log in again.')
          setLoading(false)
          return
        }

        // 1. Get Center Admin Record
        const { data: adminRows, error: adminError } = await supabase
          .from('center_admins')
          .select('center_id')
          .eq('user_id', user.id)
        
        const centerIds = (adminRows || []).map((r: any) => r.center_id).filter(Boolean)

        if (adminError) {
          setError('Failed to fetch center information.')
          setLoading(false)
          return
        }

        if (centerIds.length === 0) {
          setShifts([])
          setLoading(false)
          return
        }

        // 2. Fetch Shifts & Classrooms
        const { data: centerShifts, error: shiftsError } = await supabase
          .from('shifts')
          .select(`*, classrooms (name, age_group)`)
          .in('center_id', centerIds)
          .order('shift_date', { ascending: false })

        if (shiftsError) {
          setError(`Failed to load shifts: ${shiftsError.message}`)
          setLoading(false)
          return
        }

        if (!centerShifts || centerShifts.length === 0) {
          setShifts([])
          setLoading(false)
          return
        }

        const shiftIds = centerShifts.map(s => s.id)

        // 3. Fetch all claims
        const { data: allClaims } = await supabase
          .from('shift_claims')
          .select('*')
          .in('shift_id', shiftIds)

        // 4. Fetch interest counts
        const { data: interestRows } = await supabase
          .from('shift_claims')
          .select('shift_id')
          .in('shift_id', shiftIds)
          .eq('status', 'interested')

        const interestMap: Record<string, number> = {}
        ;(interestRows || []).forEach((r: any) => {
          interestMap[r.shift_id] = (interestMap[r.shift_id] || 0) + 1
        })

        // 5. Fetch staff profiles for claimants
        const staffIds = (allClaims || [])
          .map((c: any) => c.staff_id)
          .filter((id: string, idx: number, self: string[]) => id && self.indexOf(id) === idx)

        let staffMap: Record<string, any> = {}
        if (staffIds.length > 0) {
          const { data: profiles } = await supabase
            .from('staff_profiles')
            .select('id, first_name, last_name')
            .in('id', staffIds)
          ;(profiles || []).forEach((p: any) => { staffMap[p.id] = p })
        }

        // 6. Fetch existing reviews
        const { data: reviews } = await supabase
          .from('shift_reviews')
          .select('reviewee_id')
          .in('reviewee_id', staffIds)
          .in('reviewer_id', centerIds)
          .eq('reviewer_type', 'center')

        const reviewedMap: Record<string, boolean> = {}
        ;(reviews || []).forEach((r: any) => { reviewedMap[r.reviewee_id] = true })

        // 7. Enrich shifts
        const enrichedShifts = centerShifts.map(shift => {
          const shiftClaims = (allClaims || [])
            .filter((c: any) => c.shift_id === shift.id)
            .map((c: any) => ({ ...c, staff_profiles: staffMap[c.staff_id] || null }));
            
          const confirmedClaim = shiftClaims.find((c: any) => c.status === 'confirmed');
          
          return {
            ...shift,
            shift_claims: shiftClaims,
            interest_count: interestMap[shift.id] || 0,
            is_reviewed: confirmedClaim ? !!reviewedMap[confirmedClaim.staff_id] : false
          }
        })

        setShifts(enrichedShifts)
        setError(null)
      } catch (err: any) {
        setError(err.message || 'An unexpected error occurred.')
      } finally {
        setLoading(false)
      }
    }

    loadShifts()
  }, [])

  const handleReviewSubmit = async (data: any) => {
    if (!reviewingShift || !reviewingStaffId) return
    
    await submitReview({
      shift_id: reviewingShift.id,
      reviewer_id: reviewingShift.center_id, // center's ID
      reviewee_id: reviewingStaffId,
      reviewer_type: 'center',
      ...data
    })
    
    // Refresh to hide the review button
    window.location.reload()
  }

  const handleCheckIn = async (shiftId: string, staffId: string) => {
    setActionLoadingId(shiftId)
    await checkInStaff(shiftId, staffId)
    // Refresh page manually for simple state update
    window.location.reload()
  }

  const handleCheckOut = async (shiftId: string, staffId: string) => {
    setActionLoadingId(shiftId)
    await checkOutStaff(shiftId, staffId)
    window.location.reload()
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 text-[#157354] animate-spin mb-4" />
        <p className="text-[#6b7a73] font-medium">Fetching your shifts...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-100">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-semibold text-[#0b3828] mb-2">Something went wrong</h2>
        <p className="text-[#6b7a73] mb-6">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-[#157354] text-white px-6 py-2 rounded-xl font-semibold shadow-sm"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-[#0b3828] mb-1">Shifts</h1>
          <p className="text-[#6b7a73]">Manage your open shifts and view assigned staff.</p>
        </div>
        <Link
          href="/center/shifts/new"
          className="inline-flex items-center justify-center gap-2 bg-[#fbbf24] text-[#0b3828] font-semibold px-6 py-3 rounded-xl hover:bg-[#f59e0b] shadow-sm transition-colors"
        >
          <Plus className="w-5 h-5" /> Post New Shift
        </Link>
      </div>

      <div className="bg-white border border-[#e2e8e4] rounded-2xl shadow-sm overflow-hidden text-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f8faf9] border-b border-[#e2e8e4] text-[#6b7a73] font-medium">
                <th className="px-6 py-4">Date &amp; Time</th>
                <th className="px-6 py-4">Classroom</th>
                <th className="px-6 py-4">Role Needed</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Rate</th>
                <th className="px-6 py-4">Interested</th>
                <th className="px-6 py-4">Staff Assigned</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2e8e4]">
              {shifts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-[#6b7a73]">
                    <Calendar className="w-10 h-10 text-[#a9dac9] mx-auto mb-3 opacity-50" />
                    <p className="font-semibold text-[#1a2e25] text-base mb-1">No shifts found</p>
                    <p className="mb-6">You haven&apos;t posted any shifts yet for this center.</p>
                    <Link href="/center/shifts/new" className="text-[#157354] font-semibold text-sm hover:underline">
                      Post your first shift
                    </Link>
                  </td>
                </tr>
              ) : (
                shifts.map((shift) => {
                  const classroom = shift.classrooms
                  return (
                    <tr key={shift.id} className="hover:bg-[#f8faf9] transition-colors">
                      {/* Date & Time */}
                      <td className="px-6 py-4">
                        <div className="font-semibold text-[#1a2e25]">
                          {new Date(shift.shift_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div className="text-[#6b7a73] text-xs mt-0.5 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {(shift.start_time || '').substring(0, 5)} – {(shift.end_time || '').substring(0, 5)}
                        </div>
                      </td>

                      {/* Classroom */}
                      <td className="px-6 py-4">
                        {classroom ? (
                          <div>
                            <div className="font-medium text-[#1a2e25]">{classroom.name}</div>
                            <div className="text-[#6b7a73] text-xs">{classroom.age_group}</div>
                          </div>
                        ) : (
                          <span className="text-[#6b7a73] italic">Any room</span>
                        )}
                      </td>

                      {/* Role */}
                      <td className="px-6 py-4">
                        <div className="inline-flex bg-[#edf7f3] text-[#157354] px-2 py-1 rounded-md text-xs font-semibold">
                          {shift.staff_type_needed || 'Any'}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                          shift.status === 'open'   ? 'bg-[#d4ede4] text-[#0f4a36]' :
                          (shift.status === 'completed' || (shift.shift_claims || []).some((c:any) => c.check_out_time)) ? 'bg-[#f8faf9] text-[#6b7a73] border border-[#e2e8e4]' :
                          shift.status === 'filled' ? 'bg-[#f0fdf4] text-[#16a34a] border border-[#bbf7d0]' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {(shift.status === 'completed' || (shift.shift_claims || []).some((c:any) => c.check_out_time)) ? 'Completed' : shift.status === 'filled' ? 'Assigned' : shift.status.charAt(0).toUpperCase() + shift.status.slice(1)}
                        </span>
                      </td>

                      {/* Rate */}
                      <td className="px-6 py-4 font-semibold text-[#157354]">
                        ${shift.hourly_rate || '0.00'}/hr
                      </td>

                      {/* Interested count */}
                      <td className="px-6 py-4">
                        {shift.interest_count > 0 ? (
                          <span className="inline-flex items-center gap-1.5 bg-rose-50 text-rose-600 border border-rose-200 text-xs font-semibold px-2.5 py-1 rounded-full">
                            <Heart className="w-3 h-3 fill-rose-400" />
                            {shift.interest_count}
                          </span>
                        ) : (
                          <span className="text-[#a8b5ae] text-xs">—</span>
                        )}
                      </td>

                      {/* Staff Assigned */}
                      <td className="px-6 py-4">
                        {(() => {
                          const confirmedClaim = (shift.shift_claims || []).find((c: any) => c.status === 'confirmed')
                          const pendingClaim   = (shift.shift_claims || []).find((c: any) => c.status === 'pending')
                          const activeClaim    = confirmedClaim || pendingClaim
                          const staff          = activeClaim?.staff_profiles
                          if (!staff) return <span className="text-[#a8b5ae] italic text-xs">Unassigned</span>
                          return (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-[#157354] text-white flex items-center justify-center text-xs font-semibold shrink-0">
                                  {(staff.first_name || '?')[0]}
                                </div>
                                <span className="font-medium text-[#1a2e25] text-sm">
                                  {staff.first_name} {staff.last_name}
                                </span>
                                {pendingClaim && !confirmedClaim && (
                                  <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-md font-medium">
                                    Pending
                                  </span>
                                )}
                              </div>
                              
                              {confirmedClaim?.check_in_time && (
                                <div className="text-[11px] text-[#6b7a73] font-medium ml-8 flex items-center gap-1.5 flex-wrap">
                                  <span className="flex items-center gap-1"><LogIn className="w-3 h-3 text-[#157354]" /> {new Date(confirmedClaim.check_in_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                  {confirmedClaim.check_out_time && (
                                    <>
                                      <span className="text-[#e2e8e4]">|</span>
                                      <span className="flex items-center gap-1"><LogOut className="w-3 h-3 text-rose-600" /> {new Date(confirmedClaim.check_out_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                      <span className="text-[#e2e8e4]">|</span>
                                      <span className="font-bold text-[#157354]">
                                        {((new Date(confirmedClaim.check_out_time).getTime() - new Date(confirmedClaim.check_in_time).getTime()) / 3600000).toFixed(2)} hrs
                                      </span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })()}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          {(() => {
                            const confirmedClaim = (shift.shift_claims || []).find((c: any) => c.status === 'confirmed')
                            
                            // 1. If completed, show Review
                            if ((shift.status === 'completed' || confirmedClaim?.check_out_time) && confirmedClaim) {
                              if (shift.is_reviewed) {
                                return (
                                  <div className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#f8faf9] text-[#6b7a73] border border-[#e2e8e4] font-bold whitespace-nowrap text-xs">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Reviewed
                                  </div>
                                )
                              }
                              return (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReviewingShift(shift)
                                    setReviewingStaffId(confirmedClaim.staff_id)
                                  }}
                                  className="text-[#0b3828] font-semibold bg-[#fbbf24] px-4 py-2 rounded-xl transition-all hover:bg-[#f59e0b] shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap text-xs"
                                >
                                  <Star className="w-3.5 h-3.5" /> Review
                                </button>
                              )
                            }
                            
                            // 2. If filled (and not yet checked out), show Check In / Check Out
                            if (shift.status === 'filled' && confirmedClaim && !confirmedClaim.check_out_time) {
                              if (!confirmedClaim.check_in_time) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleCheckIn(shift.id, confirmedClaim.staff_id)}
                                    disabled={actionLoadingId === shift.id}
                                    className="text-white font-semibold bg-[#157354] px-4 py-2 rounded-xl transition-all hover:bg-[#0f4a36] shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap text-xs disabled:opacity-50"
                                  >
                                    {actionLoadingId === shift.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                                    Check In
                                  </button>
                                )
                              } else if (!confirmedClaim.check_out_time) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleCheckOut(shift.id, confirmedClaim.staff_id)}
                                    disabled={actionLoadingId === shift.id}
                                    className="text-rose-700 font-semibold bg-rose-100 px-4 py-2 rounded-xl transition-all hover:bg-rose-200 shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap text-xs disabled:opacity-50 border border-rose-200"
                                  >
                                    {actionLoadingId === shift.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                                    Check Out
                                  </button>
                                )
                              }
                            }
                            
                            return null
                          })()}
                          <Link
                            href={`/center/shifts/${shift.id}`}
                            className="text-[#157354] hover:text-[#0b3828] font-semibold bg-[#edf7f3] px-4 py-2 rounded-xl transition-all hover:scale-105 active:scale-95 inline-block text-xs text-center shadow-sm"
                          >
                            Manage
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ReviewModal 
        isOpen={!!reviewingShift}
        onClose={() => {
          setReviewingShift(null)
          setReviewingStaffId(null)
        }}
        onSubmit={handleReviewSubmit}
        reviewerType="center"
        title={reviewingShift && reviewingStaffId ? `Review Staff Performance` : ''}
      />
    </div>
  )
}

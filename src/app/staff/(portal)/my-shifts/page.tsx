'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MapPin, CheckCircle2, Loader2, ArrowRight, ShieldCheck, Globe, Sparkles, Heart, Calendar, Clock, Star, LogIn, LogOut, X, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getMyShiftsBypassingRLS } from '@/app/actions/my-shifts.actions'
import { submitReview } from '@/app/actions/reviews.actions'
import { ReviewModal } from '@/components/ReviewModal'

export default function MyShiftsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [shifts, setShifts] = useState<any[]>([])
  const [myProfile, setMyProfile] = useState<any>(null)
  const [myConnections, setMyConnections] = useState<Record<string, string>>({}) // center_id -> status
  const [joiningCenterId, setJoiningCenterId] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<'metro' | 'all'>('metro')
  const [metros, setMetros] = useState<any[]>([])
  const [claimedShiftIds, setClaimedShiftIds] = useState<Set<string>>(new Set())
  const [confirmedShiftIds, setConfirmedShiftIds] = useState<Set<string>>(new Set())
  const [interestedShiftIds, setInterestedShiftIds] = useState<Set<string>>(new Set())
  const [claimingShiftId, setClaimingShiftId] = useState<string | null>(null)
  const [expressingInterestId, setExpressingInterestId] = useState<string | null>(null)
  const [withdrawingShiftId, setWithdrawingShiftId] = useState<string | null>(null)
  const [reviewingShift, setReviewingShift] = useState<any>(null)
  const [reviewedCenterIds, setReviewedCenterIds] = useState<Set<string>>(new Set())
  const [showBalanceModal, setShowBalanceModal] = useState(false)

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 1. Get staff profile (including metro_area_id)
      const { data: profile } = await supabase
        .from('staff_profiles')
        .select(`
          *,
          metro_areas (name)
        `)
        .eq('user_id', user.id)
        .single()

      if (!profile) {
          setLoading(false)
          return
      }
      setMyProfile(profile)

      // 2. Get my existing center connections
      const { data: connections } = await supabase
        .from('center_staff')
        .select('center_id, status')
        .eq('staff_id', profile.id)
      
      const connectionMap = (connections || []).reduce((acc: any, curr: any) => {
        acc[curr.center_id] = curr.status
        return acc
      }, {})
      setMyConnections(connectionMap)

      // 3. Fetch shifts AND claims natively through our safe server action (bypasses RLS locks)
      const { shifts: myFetchedShifts, claims: myClaims, reviews: myReviews } = await getMyShiftsBypassingRLS(profile.id)
      
      const enrichedShifts = myFetchedShifts.map((s: any) => ({
        ...s,
        my_claim: myClaims.find((c: any) => c.shift_id === s.id)
      }))
      setShifts(enrichedShifts)

      // 4. Update the claim statuses accurately without getting blocked by RLS
      const claimed = new Set<string>()
      const confirmed = new Set<string>()
      const interested = new Set<string>()
      ;(myClaims || []).forEach((c: any) => {
        if (c.status === 'pending' || c.status === 'confirmed') claimed.add(c.shift_id)
        if (c.status === 'confirmed') confirmed.add(c.shift_id)
        if (c.status === 'interested') interested.add(c.shift_id)
      })
      setClaimedShiftIds(claimed)
      setConfirmedShiftIds(confirmed)
      setInterestedShiftIds(interested)

      const reviewed = new Set<string>()
      ;(myReviews || []).forEach((r: any) => reviewed.add(r.reviewee_id))
      setReviewedCenterIds(reviewed)

      // 5. Fetch Metros for context
      const { data: metroData } = await supabase.from('metro_areas').select('*').eq('is_active', true)
      setMetros(metroData || [])

      setLoading(false)
    }

    loadData()
  }, [])

  const handleStartOnboarding = async (centerId: string, centerSlug: string) => {
    if (!myProfile) return
    setJoiningCenterId(centerId)

    if (!myConnections[centerId]) {
      const { error } = await supabase
        .from('center_staff')
        .insert({
          center_id: centerId,
          staff_id: myProfile.id,
          status: 'invited'
        })

      if (error) {
        alert("Failed to start onboarding: " + error.message)
        setJoiningCenterId(null)
        return
      }
    }

    router.push(`/staff/documents?center=${centerSlug}`)
  }

  const handleExpressInterest = async (shiftId: string) => {
    if (!myProfile || expressingInterestId) return
    setExpressingInterestId(shiftId)
    const { error } = await supabase.from('shift_claims').insert({
      shift_id: shiftId,
      staff_id: myProfile.id,
      status: 'interested',
      claimed_at: new Date().toISOString(),
    })
    if (error) {
      alert('Failed to express interest: ' + error.message)
    } else {
      setInterestedShiftIds(prev => new Set([...prev, shiftId]))
    }
    setExpressingInterestId(null)
  }

  const handleWithdraw = async (shiftId: string) => {
    if (!myProfile || withdrawingShiftId) return
    setWithdrawingShiftId(shiftId)

    const { error } = await supabase.from('shift_claims')
      .update({ status: 'interested' })
      .eq('shift_id', shiftId)
      .eq('staff_id', myProfile.id)

    if (error) {
      alert('Failed to withdraw claim: ' + error.message)
    } else {
      setClaimedShiftIds(prev => { const s = new Set(prev); s.delete(shiftId); return s })
      setInterestedShiftIds(prev => new Set([...prev, shiftId]))
    }
    setWithdrawingShiftId(null)
  }

  const handleClaim = async (shiftId: string) => {
    if (!myProfile || claimingShiftId) return

    // Restriction: Staff must clear outstanding balance_due before claiming a shift
    if (myProfile.balance_due && parseFloat(myProfile.balance_due.toString()) > 0) {
      setShowBalanceModal(true)
      return
    }

    setClaimingShiftId(shiftId)
    const isAlreadyInterested = interestedShiftIds.has(shiftId)

    const { error } = isAlreadyInterested
      ? await supabase.from('shift_claims')
          .update({ status: 'pending', claimed_at: new Date().toISOString() })
          .eq('shift_id', shiftId).eq('staff_id', myProfile.id)
      : await supabase.from('shift_claims').insert({
          shift_id: shiftId,
          staff_id: myProfile.id,
          status: 'pending',
          claimed_at: new Date().toISOString(),
        })

    if (error) {
      alert('Failed to claim shift: ' + error.message)
    } else {
      setClaimedShiftIds(prev => new Set([...prev, shiftId]))
      setInterestedShiftIds(prev => { const s = new Set(prev); s.delete(shiftId); return s })
    }
    setClaimingShiftId(null)
  }

  const handleReviewSubmit = async (data: any) => {
    if (!myProfile || !reviewingShift) return
    
    await submitReview({
      shift_id: reviewingShift.id,
      reviewer_id: myProfile.id,
      reviewee_id: reviewingShift.center_id,
      reviewer_type: 'staff',
      ...data
    })
    setReviewedCenterIds(prev => new Set([...prev, reviewingShift.center_id]))
  }

  // Removed metro matching explicitly since this is purely a calendar of YOUR shifts
  
  if (loading) {
     return (
       <div className="max-w-5xl animate-pulse">
         <div className="h-40 bg-white rounded-3xl border border-[#e2e8e4] mb-8"></div>
         <div className="h-64 bg-white rounded-3xl border border-[#e2e8e4]"></div>
       </div>
     )
  }

  return (
    <div className="max-w-5xl pb-32">
      <div className="mb-10">
        <h1 className="text-4xl font-black text-[#0b3828] mb-2 tracking-tight">My Shifts</h1>
        <p className="text-[#6b7a73] text-lg font-medium">
          A personal overview of shifts you have claimed or are booked for.
        </p>
      </div>

      {shifts.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-[2rem] border-2 border-dashed border-[#e2e8e4]">
          <Calendar className="w-12 h-12 text-[#a8b5ae] mx-auto mb-4" />
          <h3 className="text-xl font-black text-[#0b3828] mb-2">No booked shifts yet</h3>
          <p className="text-[#6b7a73] font-medium max-w-sm mx-auto">
            Try checking the Available Shifts tabs to discover and claim your first shift!
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <h2 className="text-2xl font-black text-[#0b3828] mb-6 px-2">Booked & Pending Shifts</h2>
          {shifts.map((shift) => {
            const connectionStatus = myConnections[shift.center_id]
            const isActive = connectionStatus === 'active'
            const isPending = connectionStatus === 'invited'
            const isClaimed = claimedShiftIds.has(shift.id)
            const isConfirmed = confirmedShiftIds.has(shift.id)
            const isInterested = interestedShiftIds.has(shift.id)
            const centerMetro = metros.find((m: any) => m.id === shift.centers?.metro_area_id)
            const dateLabel = new Date(shift.shift_date).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })
            const timeLabel = `${shift.start_time.substring(0, 5)}–${shift.end_time.substring(0, 5)}`
            const roomLabel = [shift.classrooms?.name, shift.classrooms?.age_group].filter(Boolean).join(' · ') || null
            const locationLine = [shift.centers?.city, shift.centers?.state].filter(Boolean).join(', ') || '—'
            const zipPart = shift.centers?.zip ? ` ${shift.centers.zip}` : ''
            const payLabel = (shift.payment_mode || 'Corporate payroll').replace(/_/g, ' ')
            const myClaim = shift.my_claim
            const isCompleted = shift.status === 'completed' || !!myClaim?.check_out_time
            const isReviewed = reviewedCenterIds.has(shift.center_id)

            const actionHint = isCompleted
              ? isReviewed ? 'You have reviewed this center.' : 'Shift completed. Please share your experience.'
              : isConfirmed
              ? 'You are confirmed for this shift. Check your schedule.'
              : isClaimed
                ? 'Your claim is pending center confirmation.'
                : isActive
                  ? 'Verified connection for this center.'
                  : 'Complete onboarding to pick up shifts at this center.'

            return (
              <div
                key={shift.id}
                className="bg-white rounded-[1.5rem] border border-[#e6ece9] px-5 py-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex min-w-0 justify-center md:justify-start mb-3">
                  <div className="flex max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
                    {isCompleted ? (
                      <span className="shrink-0 rounded-full border border-[#e2e8e4] bg-[#f8faf9] px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-[#6b7a73]">
                        Completed
                      </span>
                    ) : isConfirmed ? (
                      <span className="shrink-0 rounded-full border border-[#dcfce7] bg-[#f0fdf4] px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-[#157354]">
                        Assigned
                      </span>
                    ) : isClaimed ? (
                      <span className="shrink-0 rounded-full border border-[#fef08a] bg-[#fefce8] px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-[#854d0e]">
                        Pending
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full border border-yellow-200 bg-[#fefce8] px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-yellow-800">
                        Open
                      </span>
                    )}
                    {isInterested && !isClaimed && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#d4ede4] bg-[#edf7f3] px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-[#157354]">
                        <Heart className="h-4 w-4 fill-[#157354]" /> Interested
                      </span>
                    )}
                    {isActive && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#dcfce7] bg-[#f0fdf4] px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-[#157354]">
                        <CheckCircle2 className="h-4 w-4" /> Match
                      </span>
                    )}
                    <span className="shrink-0 whitespace-nowrap rounded-full border border-[#d4ede4] bg-[#edf7f3] px-4 py-2 text-xs font-black uppercase tracking-widest text-[#157354]">
                      ${shift.hourly_rate ?? '20.00'}/hr
                    </span>
                    <span className="shrink-0 whitespace-nowrap rounded-full border border-[#e2e8e4] bg-[#f8faf9] px-4 py-2 text-xs font-black uppercase tracking-widest text-[#6b7a73]">
                      {shift.staff_type_needed || 'Professional'}
                    </span>
                    <span className="shrink-0 whitespace-nowrap rounded-full border border-[#e2e8e4] bg-[#f8faf9] px-4 py-2 text-xs font-black uppercase tracking-widest text-[#6b7a73] capitalize">
                      {payLabel}
                    </span>
                    {centerMetro && (
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[#e2e8e4] bg-[#f8faf9] px-4 py-2 text-xs font-black uppercase tracking-widest text-[#6b7a73]">
                        <Globe className="h-4 w-4 shrink-0" /> {centerMetro.name}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 text-center md:text-left">
                    <h3 className="text-xl font-black leading-tight text-[#0b3828] truncate">{shift.centers?.name}</h3>
                    <p className="mt-1 text-xs text-[#6b7a73] font-medium">
                      <MapPin className="inline w-3.5 h-3.5 text-[#a8b5ae] mr-1" />
                      {locationLine}{zipPart}
                    </p>
                    {roomLabel && (
                      <p className="mt-1 text-[11px] text-[#3d5a4f]">
                        <span className="font-black uppercase tracking-widest text-[#a8b5ae] text-[10px]">Room</span> {roomLabel}
                      </p>
                    )}
                    
                    {myClaim?.check_in_time && (
                      <div className="mt-3 p-3 bg-[#f8faf9] rounded-xl border border-[#e2e8e4] inline-flex flex-col gap-1">
                        <div className="text-xs text-[#6b7a73] font-medium flex items-center gap-2">
                          <LogIn className="w-3.5 h-3.5 text-[#157354]" /> In: {new Date(myClaim.check_in_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </div>
                        {myClaim.check_out_time && (
                          <div className="text-xs text-[#6b7a73] font-medium flex items-center gap-2">
                            <LogOut className="w-3.5 h-3.5 text-rose-600" /> Out: {new Date(myClaim.check_out_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            <span className="font-black text-[#157354] ml-2">
                              {((new Date(myClaim.check_out_time).getTime() - new Date(myClaim.check_in_time).getTime()) / 3600000).toFixed(2)} hrs
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-stretch sm:items-end gap-2 w-full md:w-auto shrink-0">
                    {isCompleted ? (
                      isReviewed ? (
                        <div className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#f8faf9] text-[#6b7a73] border border-[#e2e8e4] font-black text-xs uppercase tracking-widest whitespace-nowrap">
                          <CheckCircle2 className="w-4 h-4" /> Reviewed
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setReviewingShift(shift)}
                          className="px-5 py-2.5 bg-[#fbbf24] text-[#0b3828] font-black text-xs uppercase tracking-widest rounded-xl hover:bg-[#f59e0b] shadow-lg shadow-amber-200/30 transition-all flex items-center justify-center gap-2 whitespace-nowrap"
                        >
                          <Star className="w-4 h-4" /> Leave Review
                        </button>
                      )
                    ) : isConfirmed ? (
                      <div className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#f0fdf4] text-[#157354] border border-[#dcfce7] font-black text-xs uppercase tracking-widest whitespace-nowrap">
                        <CheckCircle2 className="w-4 h-4" /> Assigned
                      </div>
                    ) : isClaimed ? (
                      <button
                        type="button"
                        onClick={() => handleWithdraw(shift.id)}
                        disabled={withdrawingShiftId === shift.id}
                        className="px-5 py-2.5 bg-[#fee2e2] text-[#991b1b] border border-[#fecaca] font-black text-xs uppercase tracking-widest rounded-xl hover:bg-[#fecaca] transition-all disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
                      >
                        {withdrawingShiftId === shift.id ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <>
                            <X className="w-4 h-4" /> Withdraw Claim
                          </>
                        )}
                      </button>
                    ) : isInterested ? (
                      <>
                        <p className="text-center md:text-right text-[10px] font-bold text-[#6b7a73] uppercase tracking-wide max-w-[220px]">
                          Interest saved — claim to commit
                        </p>
                        <button
                          type="button"
                          onClick={() => handleClaim(shift.id)}
                          disabled={claimingShiftId === shift.id}
                          className="px-5 py-2.5 bg-[#fbbf24] text-[#0b3828] font-black text-xs uppercase tracking-widest rounded-xl hover:bg-[#f59e0b] shadow-lg shadow-amber-200/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
                        >
                          {claimingShiftId === shift.id ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <>
                              <CheckCircle2 className="w-4 h-4" /> Claim shift
                            </>
                          )}
                        </button>
                      </>
                    ) : isActive ? (
                      <button
                        type="button"
                        onClick={() => handleExpressInterest(shift.id)}
                        disabled={expressingInterestId === shift.id}
                        className="px-5 py-2.5 border border-[#157354] text-[#157354] font-black text-xs uppercase tracking-widest rounded-xl hover:bg-[#edf7f3] transition-all disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
                      >
                        {expressingInterestId === shift.id ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <>
                            <Heart className="w-4 h-4" /> Express interest
                          </>
                        )}
                      </button>
                    ) : isPending ? (
                      <Link
                        href="/staff/centers"
                        className="px-5 py-2.5 bg-[#fefce8] text-yellow-800 font-black text-xs uppercase tracking-widest rounded-xl border border-yellow-200 hover:border-yellow-400 transition-all flex items-center justify-center gap-2 whitespace-nowrap"
                      >
                        Approval pending <ArrowRight className="w-4 h-4" />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        disabled={joiningCenterId === shift.centers?.id}
                        onClick={() => handleStartOnboarding(shift.center_id, shift.centers?.slug)}
                        className="px-5 py-2.5 bg-[#157354] text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-[#0f4a36] shadow-lg shadow-[#157354]/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
                      >
                        {joiningCenterId === shift.centers?.id ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <>
                            <ShieldCheck className="w-5 h-5" /> Join center
                          </>
                        )}
                      </button>
                    )}
                    <p className="text-center md:text-right text-[10px] text-[#a8b5ae] font-bold uppercase tracking-wide max-w-[240px]">
                      {actionHint}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-center md:justify-start gap-x-4 gap-y-1.5 text-xs font-black tracking-wide text-[#6b7a73]">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-[#a8b5ae]" />
                    {dateLabel}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-[#a8b5ae]" />
                    {timeLabel}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Outstanding Balance Warning Modal ── */}
      {showBalanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-[2rem] border-2 border-[#e6ece9] max-w-md w-full p-8 shadow-2xl relative animate-slide-up text-left">
            <button 
              onClick={() => setShowBalanceModal(false)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-6">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-2xl font-black text-[#0b3828] mb-3">Clear Outstanding Due</h3>
            <p className="text-[#3d5a4f] text-sm leading-relaxed mb-6">
              You cannot claim this shift because you have an outstanding Staff Maintenance Fee balance of <strong className="text-[#0b3828]">${myProfile?.balance_due ? parseFloat(myProfile.balance_due.toString()).toFixed(2) : '0.00'}</strong>. You must pay your balance on the Account page before you can claim new shifts.
            </p>
            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => {
                  setShowBalanceModal(false)
                  router.push('/staff/account')
                }}
                className="w-full bg-[#157354] text-white font-bold py-3.5 px-4 rounded-xl hover:bg-[#0f4a36] transition-colors text-sm cursor-pointer text-center"
              >
                Go to Account & Pay
              </button>
              <button
                onClick={() => setShowBalanceModal(false)}
                className="w-full text-[#6b7a73] font-bold py-2 text-sm hover:text-[#0b3828] transition-colors cursor-pointer text-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <ReviewModal 
        isOpen={!!reviewingShift}
        onClose={() => setReviewingShift(null)}
        onSubmit={handleReviewSubmit}
        reviewerType="staff"
        title={reviewingShift ? `Review ${reviewingShift.centers?.name}` : ''}
      />
    </div>
  )
}

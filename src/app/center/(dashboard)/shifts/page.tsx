'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Calendar, Clock, AlertCircle, Loader2, Heart, Star, LogIn, LogOut, CheckCircle2, Bell, ChevronLeft, ChevronRight, UserCheck, Settings } from 'lucide-react'
import Link from 'next/link'
import { submitReview } from '@/app/actions/reviews.actions'
import { checkInStaff, checkOutStaff } from '@/app/actions/timeclock.actions'
import { ReviewModal } from '@/components/ReviewModal'
import { useLookups } from '@/hooks/use-lookups'
import { useCenterContext } from '../context'

export default function CenterShiftsPage() {
  const { staffTerm, workAreaTerm } = useCenterContext()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [shifts, setShifts] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reviewingShift, setReviewingShift] = useState<any>(null)
  const [reviewingStaffId, setReviewingStaffId] = useState<string | null>(null)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [notifyingShiftId, setNotifyingShiftId] = useState<string | null>(null)
  const [selectedShiftByDate, setSelectedShiftByDate] = useState<Record<string, string>>({})
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })
  
  const { data: lookupRoles } = useLookups('Role')

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

        const monthStart = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-01`
        const nextMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1)
        const nextMonthStart = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`

        // 2. Fetch Shifts & Work Areas
        const { data: centerShifts, error: shiftsError } = await supabase
          .from('shifts')
          .select(`*, work_areas (name, age_group)`)
          .in('center_id', centerIds)
          .neq('is_archived', true)
          .gte('shift_date', monthStart)
          .lt('shift_date', nextMonthStart)
          .order('shift_date', { ascending: true })

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
  }, [selectedMonth])

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

  const handleNotifyStaff = async (shift: any) => {
    setNotifyingShiftId(shift.id)
    try {
      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'shift_posted',
          shiftId: shift.id,
          centerId: shift.center_id,
          staffTypeNeeded: shift.staff_type_needed,
          shiftDate: shift.shift_date,
          startTime: shift.start_time,
          endTime: shift.end_time
        })
      })
      const data = await response.json()
      if (data.success) {
        alert(`Success! Notified ${data.notifiedCount || 0} eligible staff members.`)
      } else {
        alert(`Failed to notify: ${data.message || data.error || 'Unknown error'}`)
      }
    } catch (err: any) {
      console.error(err)
      alert(`Error: ${err.message || String(err)}`)
    } finally {
      setNotifyingShiftId(null)
    }
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

  const monthLabel = selectedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const firstWeekday = selectedMonth.getDay()
  const daysInMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0).getDate()
  const calendarCellCount = firstWeekday + daysInMonth > 35 ? 42 : 35
  const shiftsByDate = shifts.reduce<Record<string, any[]>>((groups, shift) => {
    if (!groups[shift.shift_date]) groups[shift.shift_date] = []
    groups[shift.shift_date].push(shift)
    return groups
  }, {})

  const changeMonth = (offset: number) => {
    setSelectedMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  const statusLabel = (shift: any) => {
    if (shift.status === 'completed' || (shift.shift_claims || []).some((claim: any) => claim.check_out_time)) return 'Completed'
    if (shift.status === 'filled') return 'Assigned'
    return shift.status ? shift.status.charAt(0).toUpperCase() + shift.status.slice(1) : 'Unknown'
  }

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#157354] mb-2">Schedule</p>
          <h1 className="text-3xl font-bold text-[#0b3828] mb-1">Current Month</h1>
          <p className="text-[#6b7a73]">Manage shifts and view assigned {staffTerm.toLowerCase()} by day.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-bold text-[#0b3828]">{monthLabel}</h2>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)} className="p-2 rounded-xl border border-[#e2e8e4] bg-white text-[#157354] hover:bg-[#edf7f3] transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button type="button" onClick={() => setSelectedMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="px-4 py-2 rounded-xl border border-[#e2e8e4] bg-white text-sm font-semibold text-[#157354] hover:bg-[#edf7f3] transition-colors">
            Today
          </button>
          <button type="button" aria-label="Next month" onClick={() => changeMonth(1)} className="p-2 rounded-xl border border-[#e2e8e4] bg-white text-[#157354] hover:bg-[#edf7f3] transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#e2e8e4] rounded-2xl shadow-sm overflow-x-auto">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-7 bg-[#f8faf9] border-b border-[#e2e8e4]">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-[#6b7a73]">{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 auto-rows-fr">
            {Array.from({ length: calendarCellCount }, (_, index) => {
              const dayNumber = index - firstWeekday + 1
              const isCurrentMonthDay = dayNumber >= 1 && dayNumber <= daysInMonth
              const dateKey = isCurrentMonthDay
                ? `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`
                : ''
              const dayShifts = dateKey ? shiftsByDate[dateKey] || [] : []
              return (
                <div key={index} className={`min-h-[190px] border-b border-r border-[#e2e8e4] p-2 ${isCurrentMonthDay ? 'bg-white' : 'bg-[#fbfcfb]'}`}>
                  {isCurrentMonthDay && (
                    <div className="group mb-2 flex items-center justify-between gap-2">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${dateKey === todayKey ? 'bg-[#157354] text-white' : 'text-[#1a2e25]'}`}>
                        {dayNumber}
                      </div>
                      {dateKey >= todayKey && (
                        <Link href={`/center/shifts/new?date=${dateKey}`} className="pointer-events-none flex items-center gap-1 rounded-lg bg-[#fbbf24] px-2 py-1 text-[10px] font-bold text-[#0b3828] opacity-0 transition-opacity hover:bg-[#f59e0b] group-hover:pointer-events-auto group-hover:opacity-100">
                          Post New Shift
                        </Link>
                      )}
                    </div>
                  )}
                  <div className="space-y-2">
                    {dayShifts.filter((shift: any) => dayShifts.length === 1 || shift.id === (selectedShiftByDate[dateKey] || dayShifts[0]?.id)).map((shift: any) => {
                      const classroom = shift.work_areas
                      const confirmedClaim = (shift.shift_claims || []).find((claim: any) => claim.status === 'confirmed')
                      const status = statusLabel(shift)
                      const statusClass = status === 'Open' ? 'bg-[#d4ede4] text-[#0f4a36]' : status === 'Assigned' ? 'bg-[#f0fdf4] text-[#16a34a]' : status === 'Completed' ? 'bg-[#f8faf9] text-[#6b7a73]' : 'bg-gray-100 text-gray-700'
                      const selectedId = selectedShiftByDate[dateKey] || dayShifts[0]?.id
                      const isSelected = selectedId === shift.id
                      return (
                        <div
                          key={shift.id}
                          role={dayShifts.length > 1 ? 'button' : undefined}
                          tabIndex={dayShifts.length > 1 ? 0 : undefined}
                          aria-pressed={dayShifts.length > 1 ? isSelected : undefined}
                          onClick={() => dayShifts.length > 1 && setSelectedShiftByDate(current => ({ ...current, [dateKey]: shift.id }))}
                          onKeyDown={(event) => {
                            if (dayShifts.length > 1 && (event.key === 'Enter' || event.key === ' ')) {
                              event.preventDefault()
                              setSelectedShiftByDate(current => ({ ...current, [dateKey]: shift.id }))
                            }
                          }}
                          className={`${dayShifts.length > 1 ? 'cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#157354] focus:ring-offset-1' : ''} rounded-xl border ${isSelected ? 'border-[#157354] ring-1 ring-[#157354]/30' : 'border-[#dce8e2]'} bg-[#fcfefd] p-2.5 shadow-sm`}
                        >
                          <div className="space-y-1 text-[11px]">
                            {isSelected && <div className="flex items-center gap-1 font-bold text-[#1a2e25]">
                              <Clock className="h-3 w-3 text-[#157354]" />
                              {(shift.start_time || '').substring(0, 5)}–{(shift.end_time || '').substring(0, 5)}
                            </div>}
                            <div><span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${statusClass}`}>{status}</span></div>
                            <div className="truncate text-xs font-semibold text-[#1a2e25]">{classroom?.name || 'Any room'}</div>
                            <div className="truncate font-semibold text-[#157354]">{lookupRoles.find(role => role.value === shift.staff_type_needed)?.label || shift.staff_type_needed || 'Any role'}</div>
                            <div className="font-bold text-[#157354]">${shift.hourly_rate || '0.00'}/hr</div>
                            <div className="flex items-center gap-1 font-semibold text-rose-600"><Heart className="h-3 w-3 fill-rose-400" /> Interested: {shift.interest_count || 0}</div>
                          </div>
                          <div className="mt-2 flex items-center justify-end gap-1 border-t border-[#e8f0ec] pt-2">
                            <Link href={`/center/shifts/${shift.id}#claims`} aria-label="View interested staff" title="Interested staff" className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-700 hover:bg-rose-100">
                              <Heart className="h-3.5 w-3.5" />
                            </Link>
                            <Link href={`/center/shifts/${shift.id}#claims`} aria-label="Manage claims" title="Claim management" className="rounded-lg border border-[#b9dacc] bg-white p-1.5 text-[#157354] hover:bg-[#edf7f3]">
                              <UserCheck className="h-3.5 w-3.5" />
                            </Link>
                            {shift.status === 'open' && <button type="button" aria-label="Notify staff" title="Notify staff" disabled={notifyingShiftId === shift.id} onClick={() => handleNotifyStaff(shift)} className="rounded-lg border border-amber-200 bg-amber-50 p-1.5 text-amber-700 hover:bg-amber-100 disabled:opacity-50"><Bell className="h-3.5 w-3.5" /></button>}
                            {shift.status === 'filled' && confirmedClaim && !confirmedClaim.check_out_time && (
                              <button type="button" aria-label={confirmedClaim.check_in_time ? 'Check out staff' : 'Check in staff'} title={confirmedClaim.check_in_time ? 'Check out staff' : 'Check in staff'} onClick={() => confirmedClaim.check_in_time ? handleCheckOut(shift.id, confirmedClaim.staff_id) : handleCheckIn(shift.id, confirmedClaim.staff_id)} disabled={actionLoadingId === shift.id} className="rounded-lg border border-[#b9dacc] bg-white p-1.5 text-[#157354] hover:bg-[#edf7f3] disabled:opacity-50">
                                {actionLoadingId === shift.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : confirmedClaim.check_in_time ? <LogOut className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
                              </button>
                            )}
                            {status === 'Completed' && confirmedClaim && !shift.is_reviewed && <button type="button" aria-label="Review staff" title="Review staff" onClick={() => { setReviewingShift(shift); setReviewingStaffId(confirmedClaim.staff_id) }} className="rounded-lg border border-amber-200 bg-amber-50 p-1.5 text-amber-700 hover:bg-amber-100"><Star className="h-3.5 w-3.5" /></button>}
                            <Link href={`/center/shifts/${shift.id}`} aria-label="Manage shift" title="Manage shift" className="rounded-lg border border-[#b9dacc] bg-white p-1.5 text-[#157354] hover:bg-[#edf7f3]"><Settings className="h-3.5 w-3.5" /></Link>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {dayShifts.length > 1 && (
                    <div className="mt-2 flex justify-center gap-1.5" aria-label="Select shift">
                      {dayShifts.map((shift: any, shiftIndex: number) => {
                        const selectedId = selectedShiftByDate[dateKey] || dayShifts[0]?.id
                        const isSelected = selectedId === shift.id
                        return (
                          <button
                            key={shift.id}
                            type="button"
                            aria-label={`Select shift ${shiftIndex + 1}`}
                            aria-pressed={isSelected}
                            title={`Select shift ${shiftIndex + 1}`}
                            onClick={() => setSelectedShiftByDate(current => ({ ...current, [dateKey]: shift.id }))}
                            className={`h-2 w-2 rounded-full border transition-colors ${isSelected ? 'border-[#157354] bg-[#157354]' : 'border-[#9fc8b7] bg-white hover:bg-[#b9dacc]'}`}
                          />
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {shifts.length === 0 && (
        <div className="py-10 text-center text-[#6b7a73]">
          <Calendar className="mx-auto mb-3 h-10 w-10 text-[#a9dac9] opacity-60" />
          <p className="font-semibold text-[#1a2e25]">No shifts found for {monthLabel}</p>
          <Link href="/center/shifts/new" className="mt-2 inline-block text-sm font-semibold text-[#157354] hover:underline">Post a shift</Link>
        </div>
      )}

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

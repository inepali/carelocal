'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getMyShiftsBypassingRLS } from '@/app/actions/my-shifts.actions'
import { checkInStaff, checkOutStaff } from '@/app/actions/timeclock.actions'
import { MapPin, CheckCircle2, Loader2, Calendar, Clock, LogIn, LogOut, AlertCircle } from 'lucide-react'

interface Shift {
  id: string
  shift_date: string
  start_time: string
  end_time: string
  status: string
  hourly_rate: number | null
  centers: {
    name: string
    city: string
    state: string
  } | null
  work_areas: {
    name: string
  } | null
  my_claim?: {
    status: string
    check_in_time: string | null
    check_out_time: string | null
  }
}

interface StaffProfile {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string
  balance_due: number | null
  staff_type: string
}

export default function MobileMyShiftsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null)
  
  // Tab control: 'upcoming' or 'completed'
  const [activeTab, setActiveTab] = useState<'upcoming' | 'completed'>('upcoming')
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 1. Get staff profile
      const { data: profile } = await supabase
        .from('staff_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (!profile) {
        setLoading(false)
        return
      }
      setMyProfile(profile)

      // 2. Fetch shifts AND claims through our service role bypass action (prevents RLS loops)
      const { shifts: myFetchedShifts, claims: myClaims } = await getMyShiftsBypassingRLS(profile.id)
      
      const enrichedShifts = (myFetchedShifts || []).map((s: { id: string }) => ({
        ...s,
        my_claim: (myClaims || []).find((c: { shift_id: string }) => c.shift_id === s.id)
      }))
      setShifts(enrichedShifts as Shift[])
    } catch (err: unknown) {
      console.error('Error loading my shifts:', err)
      setErrorMsg(err instanceof Error ? err.message : 'Failed to fetch shifts')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleCheckIn = async (shiftId: string) => {
    if (!myProfile || actionLoadingId) return
    setActionLoadingId(shiftId)
    setErrorMsg(null)
    
    try {
      const res = await checkInStaff(shiftId, myProfile.id)
      if (res.error) {
        setErrorMsg(res.error)
      } else {
        await loadData()
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Check-in failed')
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleCheckOut = async (shiftId: string) => {
    if (!myProfile || actionLoadingId) return
    setActionLoadingId(shiftId)
    setErrorMsg(null)
    
    try {
      const res = await checkOutStaff(shiftId, myProfile.id)
      if (res.error) {
        setErrorMsg(res.error)
      } else {
        await loadData()
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Check-out failed')
    } finally {
      setActionLoadingId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 py-4 animate-pulse">
        <div className="h-6 w-1/2 bg-slate-200 rounded-xl mb-6"></div>
        <div className="h-10 w-full bg-slate-200 rounded-xl mb-6"></div>
        <div className="h-40 bg-white rounded-2xl border border-slate-100"></div>
      </div>
    )
  }

  // Split shifts into Upcoming and Completed
  const upcomingShifts = shifts.filter(shift => {
    const isCompleted = shift.status === 'completed' || !!shift.my_claim?.check_out_time
    return !isCompleted
  })

  const completedShifts = shifts.filter(shift => {
    const isCompleted = shift.status === 'completed' || !!shift.my_claim?.check_out_time
    return isCompleted
  })

  const displayedShifts = activeTab === 'upcoming' ? upcomingShifts : completedShifts

  return (
    <div className="py-2">
      <div className="mb-5">
        <h1 className="text-2xl font-black text-[#0b3828] tracking-tight">My Shifts</h1>
        <p className="text-xs text-[#6b7a73] font-medium mt-1">Manage your schedule and time clock.</p>
      </div>

      {errorMsg && (
        <div className="mb-4 p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-800 text-xs shadow-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Error:</span> {errorMsg}
          </div>
        </div>
      )}

      {/* Segmented control for tabs */}
      <div className="bg-slate-100 p-1 rounded-xl flex gap-1 mb-6">
        <button
          onClick={() => setActiveTab('upcoming')}
          className={`flex-1 text-center py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'upcoming'
              ? 'bg-white text-[#0b3828] shadow-sm'
              : 'text-[#6b7a73] hover:text-[#0b3828]'
          }`}
        >
          Upcoming ({upcomingShifts.length})
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`flex-1 text-center py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'completed'
              ? 'bg-white text-[#0b3828] shadow-sm'
              : 'text-[#6b7a73] hover:text-[#0b3828]'
          }`}
        >
          Completed ({completedShifts.length})
        </button>
      </div>

      {displayedShifts.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-[#e2e8e4] px-4">
          <Calendar className="w-8 h-8 text-[#a8b5ae] mx-auto mb-3" />
          <h3 className="text-sm font-bold text-[#0b3828] mb-1">No Shifts Found</h3>
          <p className="text-xs text-[#6b7a73] font-medium max-w-xs mx-auto">
            {activeTab === 'upcoming'
              ? 'You have no upcoming confirmed or pending shifts. Browse available shifts to claim some!'
              : 'You have not completed any shifts yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayedShifts.map((shift) => {
            const myClaim = shift.my_claim
            const isConfirmed = myClaim?.status === 'confirmed'
            const isPending = myClaim?.status === 'pending'
            const isInterested = myClaim?.status === 'interested'
            
            const dateLabel = new Date(shift.shift_date).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })
            const timeLabel = `${shift.start_time.substring(0, 5)}–${shift.end_time.substring(0, 5)}`

            return (
              <div
                key={shift.id}
                className="bg-white rounded-2xl border border-[#e6ece9] p-5 shadow-sm space-y-4"
              >
                {/* Header Row: Status Tags & Rate */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {isConfirmed ? (
                      <span className="rounded-full bg-[#f0fdf4] border border-[#dcfce7] px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-[#157354]">
                        Assigned
                      </span>
                    ) : isPending ? (
                      <span className="rounded-full bg-[#fefce8] border border-[#fef08a] px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-[#854d0e]">
                        Pending Approval
                      </span>
                    ) : isInterested ? (
                      <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-blue-800">
                        Interested
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#f8faf9] border border-slate-200 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
                        {myClaim?.status || 'Unknown'}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-black text-[#157354] bg-[#edf7f3] border border-[#d4ede4] px-2.5 py-1 rounded-full">
                    ${shift.hourly_rate ?? '20.00'}/hr
                  </span>
                </div>

                {/* Body Row: Center Info */}
                <div className="space-y-1">
                  <h3 className="font-black text-[#0b3828] text-base leading-snug">{shift.centers?.name}</h3>
                  <div className="flex items-center text-[11px] text-[#6b7a73] font-medium">
                    <MapPin className="w-3.5 h-3.5 mr-1 text-slate-400" />
                    {shift.centers?.city}, {shift.centers?.state}
                  </div>
                  {shift.work_areas && (
                    <div className="text-[10px] text-[#3d5a4f] bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 w-fit mt-1">
                      <span className="font-bold text-slate-400">Area:</span> {shift.work_areas.name}
                    </div>
                  )}
                </div>

                {/* Timing info */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-[#6b7a73] pt-2 border-t border-[#f0f4f2]">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {dateLabel}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    {timeLabel}
                  </span>
                </div>

                {/* Time Clock (For Confirmed & Active Shifts) */}
                {isConfirmed && (
                  <div className="mt-2 p-3 bg-slate-50 border border-slate-200/60 rounded-xl space-y-3">
                    <div className="text-[10px] font-black uppercase tracking-wider text-[#6b7a73]">
                      Time Clock Activity
                    </div>
                    
                    <div className="flex flex-col gap-1.5 text-xs text-[#0b3828]">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-medium text-slate-500">
                          <LogIn className="w-3.5 h-3.5 text-[#157354]" /> Check-In:
                        </span>
                        <span className="font-bold">
                          {myClaim.check_in_time 
                            ? new Date(myClaim.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </span>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-medium text-slate-500">
                          <LogOut className="w-3.5 h-3.5 text-rose-500" /> Check-Out:
                        </span>
                        <span className="font-bold">
                          {myClaim.check_out_time 
                            ? new Date(myClaim.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="pt-1">
                      {!myClaim.check_in_time ? (
                        <button
                          type="button"
                          onClick={() => handleCheckIn(shift.id)}
                          disabled={actionLoadingId === shift.id}
                          className="w-full bg-[#157354] hover:bg-[#0f4a36] text-white font-bold py-2.5 rounded-lg text-xs uppercase tracking-wider shadow-sm flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
                        >
                          {actionLoadingId === shift.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <LogIn className="w-3.5 h-3.5" /> Confirm Check-In
                            </>
                          )}
                        </button>
                      ) : !myClaim.check_out_time ? (
                        <button
                          type="button"
                          onClick={() => handleCheckOut(shift.id)}
                          disabled={actionLoadingId === shift.id}
                          className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-lg text-xs uppercase tracking-wider shadow-sm flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
                        >
                          {actionLoadingId === shift.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <LogOut className="w-3.5 h-3.5" /> Confirm Check-Out
                            </>
                          )}
                        </button>
                      ) : (
                        <div className="text-center text-[10px] font-bold text-[#157354] bg-[#edf7f3] py-1.5 rounded-lg border border-[#d4ede4] flex items-center justify-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Completed Timecard Saved
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

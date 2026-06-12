'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MapPin, CheckCircle2, Loader2, ShieldCheck, Globe, Calendar, Clock, AlertCircle, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Shift {
  id: string
  shift_date: string
  start_time: string
  end_time: string
  status: string
  is_archived: boolean | null
  hourly_rate: number | null
  center_id: string
  centers: {
    id: string
    name: string
    address: string | null
    city: string
    state: string
    zip: string | null
    slug: string
    metro_area_id: string
  } | null
  classrooms: {
    name: string
    age_group: string | null
  } | null
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

export default function MobileShiftsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null)
  const [myConnections, setMyConnections] = useState<Record<string, string>>({}) // center_id -> status
  const [joiningCenterId, setJoiningCenterId] = useState<string | null>(null)
  const [claimedShiftIds, setClaimedShiftIds] = useState<Set<string>>(new Set())
  const [confirmedShiftIds, setConfirmedShiftIds] = useState<Set<string>>(new Set())
  const [claimingShiftId, setClaimingShiftId] = useState<string | null>(null)
  const [showBalanceModal, setShowBalanceModal] = useState(false)

  useEffect(() => {
    async function loadData() {
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

      // 2. Get my existing center connections
      const { data: connections } = await supabase
        .from('center_staff')
        .select('center_id, status')
        .eq('staff_id', profile.id)
      
      const connectionMap = (connections || []).reduce<Record<string, string>>((acc, curr) => {
        acc[curr.center_id] = curr.status
        return acc
      }, {})
      setMyConnections(connectionMap)

      // 3. Fetch all OPEN shifts
      const today = new Date().toISOString().split('T')[0]
      const { data: openShifts } = await supabase
        .from('shifts')
        .select(`
            *,
            centers (id, name, address, city, state, zip, slug, metro_area_id),
            classrooms (name, age_group)
        `)
        .eq('status', 'open')
        .neq('is_archived', true)
        .gte('shift_date', today)
        .order('shift_date', { ascending: true })
        
      setShifts((openShifts as unknown as Shift[]) || [])

      // 4. Fetch my existing claims
      const { data: myClaims } = await supabase
        .from('shift_claims')
        .select('shift_id, status')
        .eq('staff_id', profile.id)
        .not('status', 'eq', 'cancelled')

      const claimed = new Set<string>()
      const confirmed = new Set<string>()
      ;(myClaims || []).forEach((c: { shift_id: string; status: string }) => {
        if (c.status === 'pending' || c.status === 'confirmed') claimed.add(c.shift_id)
        if (c.status === 'confirmed') confirmed.add(c.shift_id)
      })
      setClaimedShiftIds(claimed)
      setConfirmedShiftIds(confirmed)

      setLoading(false)
    }

    loadData()
  }, [supabase])

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

    router.push(`/mobile/documents?center=${centerSlug}`)
  }

  const handleClaim = async (shiftId: string) => {
    if (!myProfile || claimingShiftId) return
 
    if (myProfile.balance_due && parseFloat(myProfile.balance_due.toString()) > 0) {
      setShowBalanceModal(true)
      return
    }

    setClaimingShiftId(shiftId)

    const { error } = await supabase.from('shift_claims').insert({
      shift_id: shiftId,
      staff_id: myProfile.id,
      status: 'pending',
      claimed_at: new Date().toISOString(),
    })

    if (error) {
      alert('Failed to claim shift: ' + error.message)
    } else {
      setClaimedShiftIds(prev => new Set([...prev, shiftId]))
    }
    setClaimingShiftId(null)
  }

  // Filter out shifts already confirmed
  const filteredShifts = shifts.filter(shift => !confirmedShiftIds.has(shift.id))

  if (loading) {
    return (
      <div className="space-y-4 py-4 animate-pulse">
        <div className="h-6 w-3/4 bg-slate-200 rounded-xl mb-6"></div>
        <div className="h-44 bg-white rounded-2xl border border-slate-100"></div>
        <div className="h-44 bg-white rounded-2xl border border-slate-100"></div>
      </div>
    )
  }

  return (
    <div className="py-2">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-[#0b3828] tracking-tight">Available Shifts</h1>
        <p className="text-xs text-[#6b7a73] font-medium mt-1">Claim open shifts from connected centers.</p>
      </div>

      {/* Warning banner for outstanding balance */}
      {myProfile?.balance_due && parseFloat(myProfile.balance_due.toString()) > 0 && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-2xl flex items-start gap-3 shadow-sm">
          <AlertCircle className="w-5 h-5 text-yellow-800 shrink-0 mt-0.5" />
          <div className="text-xs">
            <h4 className="font-bold text-[#0b3828]">Outstanding Balance Due</h4>
            <p className="text-yellow-900 mt-1">
              Clear your fee balance of <strong>${parseFloat(myProfile.balance_due.toString()).toFixed(2)}</strong> on the Account tab before claiming shifts.
            </p>
          </div>
        </div>
      )}

      {filteredShifts.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-[#e2e8e4] px-4">
          <Globe className="w-10 h-10 text-[#a8b5ae] mx-auto mb-3" />
          <h3 className="text-base font-bold text-[#0b3828] mb-1">No Open Shifts</h3>
          <p className="text-xs text-[#6b7a73] font-medium max-w-xs mx-auto">
            Check back later for new opportunities across our network!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredShifts.map((shift) => {
            const connectionStatus = myConnections[shift.center_id]
            const isActive = connectionStatus === 'active'
            const isPending = connectionStatus === 'invited'
            const isClaimed = claimedShiftIds.has(shift.id)
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
                    {isClaimed ? (
                      <span className="rounded-full bg-[#fefce8] border border-[#fef08a] px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-[#854d0e]">
                        Pending
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#fefce8] border border-yellow-200 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-yellow-800">
                        Open
                      </span>
                    )}
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#f0fdf4] border border-[#dcfce7] px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-[#157354]">
                        <CheckCircle2 className="w-3 h-3" /> Connected
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-black text-[#157354] bg-[#edf7f3] border border-[#d4ede4] px-2.5 py-1 rounded-full">
                    ${shift.hourly_rate ?? '20.00'}/hr
                  </span>
                </div>

                {/* Body Row: Center Info */}
                <div className="space-y-1.5">
                  <h3 className="font-black text-[#0b3828] text-base leading-snug">{shift.centers?.name}</h3>
                  <div className="flex items-center text-[11px] text-[#6b7a73] font-medium">
                    <MapPin className="w-3.5 h-3.5 mr-1 text-slate-400" />
                    {shift.centers?.city}, {shift.centers?.state}
                  </div>
                  {shift.classrooms && (
                    <div className="text-[10px] text-[#3d5a4f] bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 w-fit">
                      <span className="font-bold text-slate-400">Classroom:</span> {shift.classrooms.name} ({shift.classrooms.age_group})
                    </div>
                  )}
                </div>

                {/* Timing info */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-[#6b7a73] pt-1.5 border-t border-[#f0f4f2]">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {dateLabel}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    {timeLabel}
                  </span>
                </div>

                {/* Actions */}
                <div className="pt-2">
                  {isClaimed ? (
                    <div className="w-full text-center py-2.5 bg-slate-50 border border-slate-200 text-slate-400 rounded-xl text-xs font-black uppercase tracking-wider">
                      Claim Sent (Pending)
                    </div>
                  ) : isActive ? (
                    <button
                      type="button"
                      onClick={() => handleClaim(shift.id)}
                      disabled={claimingShiftId === shift.id}
                      className="w-full bg-[#157354] hover:bg-[#0f4a36] text-white font-bold py-3 px-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wider cursor-pointer"
                    >
                      {claimingShiftId === shift.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        'Claim Shift'
                      )}
                    </button>
                  ) : isPending ? (
                    <div className="w-full text-center py-2.5 bg-yellow-50/50 border border-yellow-200 text-yellow-800 rounded-xl text-xs font-bold">
                      Pending Center Approval
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={joiningCenterId === shift.centers?.id}
                      onClick={() => handleStartOnboarding(shift.center_id, shift.centers?.slug || '')}
                      className="w-full bg-[#157354]/10 hover:bg-[#157354]/20 text-[#157354] border border-[#157354]/20 font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wider cursor-pointer"
                    >
                      {joiningCenterId === shift.centers?.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" /> Onboard & Join Center
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Balance Modal ── */}
      {showBalanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl border border-[#e6ece9] max-w-sm w-full p-6 shadow-2xl relative text-left">
            <button 
              onClick={() => setShowBalanceModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <AlertCircle className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="text-lg font-black text-[#0b3828] mb-2">Fee Balance Due</h3>
            <p className="text-xs text-[#3d5a4f] leading-relaxed mb-6">
              You must pay your outstanding Staff Maintenance Fee balance of <strong>${parseFloat(myProfile?.balance_due?.toString() || '0').toFixed(2)}</strong> on the Account tab before claiming new shifts.
            </p>
            <button
              onClick={() => {
                setShowBalanceModal(false)
                router.push('/mobile/account')
              }}
              className="w-full bg-[#157354] text-white font-bold py-3 rounded-xl hover:bg-[#0f4a36] text-xs cursor-pointer text-center"
            >
              Go to Account tab
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

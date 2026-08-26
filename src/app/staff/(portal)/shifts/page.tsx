'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MapPin, CheckCircle2, Loader2, ArrowRight, ShieldCheck, Globe, Sparkles, Heart, Calendar, Clock, CreditCard, AlertCircle, X, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { payStaffBalance } from '@/app/actions/staff-billing.actions'

export default function StaffShiftsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [shifts, setShifts] = useState<any[]>([])
  const [myProfile, setMyProfile] = useState<any>(null)
  const [myConnections, setMyConnections] = useState<Record<string, string>>({}) // center_id -> status
  const [joiningCenterId, setJoiningCenterId] = useState<string | null>(null)
  const [metros, setMetros] = useState<any[]>([])
  const [claimedShiftIds, setClaimedShiftIds] = useState<Set<string>>(new Set())
  const [confirmedShiftIds, setConfirmedShiftIds] = useState<Set<string>>(new Set())
  const [interestedShiftIds, setInterestedShiftIds] = useState<Set<string>>(new Set())
  const [claimingShiftId, setClaimingShiftId] = useState<string | null>(null)
  const [expressingInterestId, setExpressingInterestId] = useState<string | null>(null)
  const [selectedShiftByDate, setSelectedShiftByDate] = useState<Record<string, string>>({})
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })

  // Maintenance fee payment states
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [showBalanceModal, setShowBalanceModal] = useState(false)
  const [activeAlertShiftId, setActiveAlertShiftId] = useState<string | null>(null)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [paymentSuccessMessage, setPaymentSuccessMessage] = useState<string | null>(null)

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

      // 3. Fetch all OPEN shifts from expansion territories
      const monthStart = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-01`
      const nextMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1)
      const nextMonthStart = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`
      const { data: openShifts } = await supabase
        .from('shifts')
        .select(`
            *,
            centers (id, name, address, city, state, zip, slug, metro_area_id),
            work_areas (name, age_group)
        `)
        .eq('status', 'open')
        .neq('is_archived', true)
        .gte('shift_date', monthStart)
        .lt('shift_date', nextMonthStart)
        .order('shift_date', { ascending: true })
        
      setShifts(openShifts || [])

      // 4. Fetch Metros for context
      const { data: metroData } = await supabase.from('metro_areas').select('*').eq('is_active', true)
      setMetros(metroData || [])

      // 5. Fetch my existing claims & interests
      const { data: myClaims } = await supabase
        .from('shift_claims')
        .select('shift_id, status')
        .eq('staff_id', profile.id)
        .not('status', 'eq', 'cancelled')

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

      setLoading(false)
    }

    loadData()
  }, [selectedMonth])

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

  const handlePayBalance = async () => {
    if (!myProfile) return
    setIsProcessingPayment(true)
    try {
      const result = await payStaffBalance(myProfile.id)
      if (result.error) {
        alert('Payment failed: ' + result.error)
      } else {
        setMyProfile((prev: any) => ({ ...prev, balance_due: 0.00 }))
        setPaymentSuccessMessage('Your balance has been successfully cleared! You can now claim shifts.')
        setTimeout(() => setPaymentSuccessMessage(null), 4000)
        setIsPaymentModalOpen(false)
      }
    } catch (err: any) {
      alert('An error occurred during payment processing: ' + err.message)
    } finally {
      setIsProcessingPayment(false)
    }
  }

  // Matching Logic: Exclude already claimed/interested shifts
  const filteredShifts = shifts.filter(shift => {
    // Hide shifts that appear in "My Shifts" (already booked, pending, or interested)
    if (claimedShiftIds.has(shift.id) || interestedShiftIds.has(shift.id)) return false
    return true
  })

  const monthLabel = selectedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const firstWeekday = selectedMonth.getDay()
  const daysInMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0).getDate()
  const calendarCellCount = firstWeekday + daysInMonth > 35 ? 42 : 35
  const shiftsByDate = filteredShifts.reduce<Record<string, any[]>>((groups, shift) => {
    if (!groups[shift.shift_date]) groups[shift.shift_date] = []
    groups[shift.shift_date].push(shift)
    return groups
  }, {})
  const changeMonth = (offset: number) => {
    setSelectedMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

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
      {/* Toast notifications */}
      {paymentSuccessMessage && (
        <div className="fixed bottom-6 right-6 z-50 p-4 bg-[#157354] text-white font-bold rounded-2xl shadow-xl flex items-center gap-2 animate-bounce">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{paymentSuccessMessage}</span>
        </div>
      )}

      {/* Warning banner for outstanding balance */}
      {myProfile?.balance_due && parseFloat(myProfile.balance_due.toString()) > 0 && (
        <div className="mb-8 p-6 bg-yellow-50 border-2 border-yellow-200 rounded-[1.5rem] flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-4 text-center sm:text-left">
            <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center shrink-0">
              <AlertCircle className="w-6 h-6 text-yellow-800" />
            </div>
            <div>
              <h4 className="font-black text-[#0b3828] text-lg">Staff Maintenance Fee Outstanding</h4>
              <p className="text-yellow-900 text-sm font-medium mt-0.5">
                You have a pending balance due of <strong className="text-yellow-950">${parseFloat(myProfile.balance_due.toString()).toFixed(2)}</strong>. Please pay this balance to claim new shifts.
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsPaymentModalOpen(true)}
            className="w-full sm:w-auto px-6 py-3 bg-[#157354] hover:bg-[#0f4a36] text-white font-black text-xs uppercase tracking-widest rounded-xl shadow-md transition-colors shrink-0"
          >
            Pay Fee Balance
          </button>
        </div>
      )}

      <div className="mb-10">
        <div className="flex items-center gap-2 text-[#157354] font-black tracking-[0.12em] text-[10px] uppercase mb-2">
          <Sparkles className="w-4 h-4" /> Expansion Marketplace
        </div>
        <h1 className="text-4xl font-black text-[#0b3828] mb-2 tracking-tight">Available Shifts</h1>
        <p className="text-[#6b7a73] text-lg font-medium">
          Showing all shifts across our expanding network.
        </p>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-black text-[#0b3828]">{monthLabel}</h2>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)} className="rounded-xl border border-[#e2e8e4] bg-white p-2 text-[#157354] hover:bg-[#edf7f3]"><ChevronLeft className="h-5 w-5" /></button>
          <button type="button" onClick={() => setSelectedMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="rounded-xl border border-[#e2e8e4] bg-white px-4 py-2 text-sm font-bold text-[#157354] hover:bg-[#edf7f3]">Today</button>
          <button type="button" aria-label="Next month" onClick={() => changeMonth(1)} className="rounded-xl border border-[#e2e8e4] bg-white p-2 text-[#157354] hover:bg-[#edf7f3]"><ChevronRight className="h-5 w-5" /></button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#e2e8e4] bg-white shadow-sm">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-7 border-b border-[#e2e8e4] bg-[#f8faf9]">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-[#6b7a73]">{day}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: calendarCellCount }, (_, index) => {
              const dayNumber = index - firstWeekday + 1
              const isCurrentMonthDay = dayNumber >= 1 && dayNumber <= daysInMonth
              const dateKey = isCurrentMonthDay ? `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}` : ''
              const dayShifts = dateKey ? shiftsByDate[dateKey] || [] : []
              const selectedId = selectedShiftByDate[dateKey] || dayShifts[0]?.id
              const visibleShifts = dayShifts.filter(shift => dayShifts.length === 1 || shift.id === selectedId)
              return (
                <div key={index} className={`min-h-[230px] border-b border-r border-[#e2e8e4] p-2 ${isCurrentMonthDay ? 'bg-white' : 'bg-[#fbfcfb]'}`}>
                  {isCurrentMonthDay && <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${dateKey === todayKey ? 'bg-[#157354] text-white' : 'text-[#1a2e25]'}`}>{dayNumber}</div>}
                  <div className="space-y-2">
                    {visibleShifts.map((shift: any) => {
            const connectionStatus = myConnections[shift.center_id]
            const isActive = connectionStatus === 'active'
            const isPending = connectionStatus === 'invited'
            const isClaimed = claimedShiftIds.has(shift.id)
            const isConfirmed = confirmedShiftIds.has(shift.id)
            const isInterested = interestedShiftIds.has(shift.id)
            const centerMetro = metros.find((m: any) => m.id === shift.centers?.metro_area_id)
            const timeLabel = `${shift.start_time.substring(0, 5)}–${shift.end_time.substring(0, 5)}`
            const roomLabel = [shift.work_areas?.name, shift.work_areas?.age_group].filter(Boolean).join(' · ') || null
            const locationLine = [shift.centers?.city, shift.centers?.state].filter(Boolean).join(', ') || '—'
            const zipPart = shift.centers?.zip ? ` ${shift.centers.zip}` : ''
            const payLabel = (shift.payment_mode || 'Corporate payroll').replace(/_/g, ' ')

            const actionHint = isConfirmed
              ? 'You are confirmed for this shift. Check your schedule.'
              : isClaimed
                ? 'Your claim is pending center confirmation.'
                : isActive
                  ? 'Verified connection for this center.'
                  : 'Complete onboarding to pick up shifts at this center.'

            return (
              <div key={shift.id} className="rounded-xl border border-[#dce8e2] bg-[#fcfefd] p-2.5 shadow-sm">
                <div className="space-y-1 text-[11px]">
                    {isConfirmed ? (
                      <span className="inline-flex rounded-full border border-[#dcfce7] bg-[#f0fdf4] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[#157354]">
                        Assigned
                      </span>
                    ) : isClaimed ? (
                      <span className="inline-flex rounded-full border border-[#fef08a] bg-[#fefce8] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[#854d0e]">
                        Pending
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full border border-yellow-200 bg-[#fefce8] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-yellow-800">
                        Open
                      </span>
                    )}
                    <div className="flex items-center gap-1 font-bold text-[#1a2e25]"><Clock className="h-3 w-3 text-[#157354]" />{timeLabel}</div>
                    <div className="truncate text-xs font-black text-[#0b3828]">{shift.centers?.name}</div>
                    <div className="truncate text-[11px] text-[#3d5a4f]">{roomLabel || 'Any room'}</div>
                    <div className="truncate text-[11px] font-semibold text-[#157354]">{shift.staff_type_needed || 'Professional'}</div>
                    <div className="font-bold text-[#157354]">${shift.hourly_rate ?? '20.00'}/hr</div>
                  </div>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {isConfirmed ? (
                      <div className="rounded-lg bg-[#f0fdf4] px-2 py-1.5 text-center text-[10px] font-bold text-[#157354]">Assigned</div>
                    ) : isClaimed ? (
                      <div className="rounded-lg bg-[#fefce8] px-2 py-1.5 text-center text-[10px] font-bold text-[#854d0e]">Pending approval</div>
                    ) : isInterested ? (
                      <button type="button" onClick={() => handleClaim(shift.id)} disabled={claimingShiftId === shift.id} className="flex items-center justify-center gap-1 rounded-lg bg-[#fbbf24] px-2 py-1.5 text-[10px] font-bold text-[#0b3828] disabled:opacity-50">
                        {claimingShiftId === shift.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Claim shift
                      </button>
                    ) : isActive ? (
                      <button type="button" onClick={() => handleExpressInterest(shift.id)} disabled={expressingInterestId === shift.id} className="flex items-center justify-center gap-1 rounded-lg border border-[#157354] px-2 py-1.5 text-[10px] font-bold text-[#157354] disabled:opacity-50">
                        {expressingInterestId === shift.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Heart className="h-3 w-3" />} Interested
                      </button>
                    ) : isPending ? (
                      <Link href="/staff/centers" className="flex items-center justify-center gap-1 rounded-lg border border-yellow-200 bg-[#fefce8] px-2 py-1.5 text-[10px] font-bold text-yellow-800">Approval pending <ArrowRight className="h-3 w-3" /></Link>
                    ) : (
                      <button type="button" disabled={joiningCenterId === shift.centers?.id} onClick={() => handleStartOnboarding(shift.center_id, shift.centers?.slug)} className="flex items-center justify-center gap-1 rounded-lg bg-[#157354] px-2 py-1.5 text-[10px] font-bold text-white disabled:opacity-50">
                        {joiningCenterId === shift.centers?.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} Join center
                      </button>
                    )}
                  </div>
                </div>
              )
                    })}
                  </div>
                  {dayShifts.length > 1 && <div className="mt-2 flex justify-center gap-1.5" aria-label="Select shift">
                    {dayShifts.map((shift: any, shiftIndex: number) => <button key={shift.id} type="button" aria-label={`Select shift ${shiftIndex + 1}`} aria-pressed={selectedId === shift.id} title={`Select shift ${shiftIndex + 1}`} onClick={() => setSelectedShiftByDate(current => ({ ...current, [dateKey]: shift.id }))} className={`h-2 w-2 rounded-full border ${selectedId === shift.id ? 'border-[#157354] bg-[#157354]' : 'border-[#9fc8b7] bg-white'}`} />)}
                  </div>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {filteredShifts.length === 0 && (
        <div className="py-10 text-center text-[#6b7a73]"><Globe className="mx-auto mb-3 h-10 w-10 text-[#a8b5ae]" /><p className="font-semibold text-[#0b3828]">No open shifts for {monthLabel}</p></div>
      )}
      {/* The old list-card fragment below is retained only as a comment boundary. */}
      {/*
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
                  </div>

                  <div className="flex flex-col items-stretch sm:items-end gap-2 w-full md:w-auto shrink-0">
                    {isConfirmed ? (
                      <div className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#f0fdf4] text-[#157354] border border-[#dcfce7] font-black text-xs uppercase tracking-widest whitespace-nowrap">
                        <CheckCircle2 className="w-4 h-4" /> Assigned
                      </div>
                    ) : isClaimed ? (
                      <div className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#fefce8] text-[#854d0e] border border-[#fef08a] font-black text-xs uppercase tracking-widest whitespace-nowrap">
                        <Clock className="w-4 h-4" /> Pending
                      </div>
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
      */}
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

      {/* ── Payment Sandbox Modal ── */}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-[2rem] border-2 border-[#e6ece9] max-w-md w-full p-8 shadow-2xl relative animate-slide-up text-left">
            <button 
              onClick={() => setIsPaymentModalOpen(false)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="flex items-center gap-3 mb-6">
              <CreditCard className="w-6 h-6 text-[#157354]" />
              <h3 className="text-2xl font-black text-[#0b3828]">Pay Balance Due</h3>
            </div>

            <div className="bg-[#f8faf9] rounded-2xl p-4 border border-[#e6ece9] mb-6 flex justify-between items-center">
              <span className="text-[#3d5a4f] text-sm font-semibold">Amount to Pay</span>
              <span className="text-2xl font-black text-[#157354]">
                ${myProfile?.balance_due ? parseFloat(myProfile.balance_due.toString()).toFixed(2) : '0.00'}
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#0b3828] mb-1">Cardholder Name</label>
                <input 
                  type="text" 
                  disabled={isProcessingPayment} 
                  defaultValue={myProfile ? `${myProfile.first_name} ${myProfile.last_name}` : ''}
                  className="w-full px-3.5 py-2.5 text-sm border border-[#e6ece9] rounded-xl bg-[#f8faf9] outline-none focus:border-[#157354]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0b3828] mb-1">Card Number (Sandbox)</label>
                <div className="relative">
                  <input 
                    type="text" 
                    disabled={isProcessingPayment} 
                    placeholder="4242 4242 4242 4242"
                    maxLength={19}
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-[#e6ece9] rounded-xl bg-[#f8faf9] outline-none focus:border-[#157354]"
                  />
                  <CreditCard className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#0b3828] mb-1">Expiration</label>
                  <input 
                    type="text" 
                    disabled={isProcessingPayment} 
                    placeholder="MM/YY"
                    maxLength={5}
                    className="w-full px-3.5 py-2.5 text-sm border border-[#e6ece9] rounded-xl bg-[#f8faf9] outline-none focus:border-[#157354]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#0b3828] mb-1">CVC</label>
                  <input 
                    type="password" 
                    disabled={isProcessingPayment} 
                    placeholder="•••"
                    maxLength={3}
                    className="w-full px-3.5 py-2.5 text-sm border border-[#e6ece9] rounded-xl bg-[#f8faf9] outline-none focus:border-[#157354]"
                  />
                </div>
              </div>

              <div className="pt-4">
                <button
                  onClick={handlePayBalance}
                  disabled={isProcessingPayment}
                  className="w-full bg-[#157354] hover:bg-[#0f4a36] text-white font-bold py-3.5 px-4 rounded-xl transition-all disabled:opacity-75 flex items-center justify-center gap-2 text-sm cursor-pointer"
                >
                  {isProcessingPayment ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processing Sandbox Payment...
                    </>
                  ) : (
                    `Pay $${myProfile?.balance_due ? parseFloat(myProfile.balance_due.toString()).toFixed(2) : '0.00'} Now`
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Calendar, Clock, MapPin, CheckCircle2, Loader2, ArrowRight, ShieldCheck, Globe, Sparkles, Heart } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function StaffShiftsPage() {
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
  const [interestedShiftIds, setInterestedShiftIds] = useState<Set<string>>(new Set())
  const [claimingShiftId, setClaimingShiftId] = useState<string | null>(null)
  const [expressingInterestId, setExpressingInterestId] = useState<string | null>(null)

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
      const today = new Date().toISOString().split('T')[0]
      const { data: openShifts } = await supabase
        .from('shifts')
        .select(`
            *,
            centers (id, name, address, city, state, zip, slug, metro_area_id),
            classrooms (name, age_group)
        `)
        .eq('status', 'open')
        .gte('shift_date', today)
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
      const interested = new Set<string>()
      ;(myClaims || []).forEach((c: any) => {
        if (c.status === 'pending' || c.status === 'confirmed') claimed.add(c.shift_id)
        if (c.status === 'interested') interested.add(c.shift_id)
      })
      setClaimedShiftIds(claimed)
      setInterestedShiftIds(interested)

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

  const handleClaim = async (shiftId: string) => {
    if (!myProfile || claimingShiftId) return
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

  // Matching Logic: Filter by Metro Area ID
  const filteredShifts = shifts.filter(shift => {
    if (filterType === 'all') return true
    if (!myProfile || !myProfile.metro_area_id) return true
    
    return shift.centers?.metro_area_id === myProfile.metro_area_id
  })

  const currentMetroName = myProfile?.metro_areas?.name || 'your region'

  if (loading) {
     return (
       <div className="max-w-4xl py-12 px-6">
         <div className="animate-pulse space-y-8">
            <div className="h-12 w-64 bg-slate-200 rounded-2xl mb-8"></div>
            <div className="h-48 bg-white rounded-[3rem] border border-[#e2e8e4]"></div>
            <div className="h-48 bg-white rounded-[3rem] border border-[#e2e8e4]"></div>
         </div>
       </div>
     )
  }

  return (
    <div className="max-w-4xl pb-32 px-6">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-8 mb-16">
        <div>
          <div className="flex items-center gap-1.5 text-[#157354] font-medium tracking-wide text-[10px] uppercase mb-3">
             <Sparkles className="w-3.5 h-3.5" /> Expansion Marketplace
          </div>
          <h1 className="text-3xl font-bold text-[#0b3828] mb-3 tracking-tight leading-snug">Available Shifts</h1>
          <p className="text-[#6b7a73] text-xl font-medium leading-relaxed max-w-xl">
             {filterType === 'metro' && myProfile?.metro_area_id ? 
               `Showing opportunities in ${currentMetroName}.` : 
               'Showing all shifts across our expanding network.'}
          </p>
        </div>

        <div className="flex items-center bg-[#edf7f3] p-2 rounded-2xl border-2 border-[#a9dac9] shadow-xl">
           <button
             onClick={() => setFilterType('metro')}
             className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-semibold transition-all ${filterType === 'metro' ? 'bg-[#157354] text-white shadow-md' : 'text-[#3d5a4f] hover:bg-white/50'}`}
           >
              <MapPin className="w-3.5 h-3.5" /> My Metro
           </button>
           <button
             onClick={() => setFilterType('all')}
             className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-semibold transition-all ${filterType === 'all' ? 'bg-[#157354] text-white shadow-md' : 'text-[#3d5a4f] hover:bg-white/50'}`}
           >
              <Globe className="w-3.5 h-3.5" /> All Metros
           </button>
        </div>
      </div>

      {filteredShifts.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-[#a9dac9] rounded-[4rem] p-24 text-center shadow-2xl">
           <div className="w-24 h-24 bg-[#f0fdf4] rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 shadow-inner">
             <Globe className="w-12 h-12 text-[#a9dac9]" />
           </div>
           <h2 className="text-xl font-semibold text-[#1a2e25] mb-4">No shifts in this metro yet</h2>
           <p className="text-[#6b7a73] max-w-sm mx-auto text-lg leading-relaxed mb-10">
              {filterType === 'metro' ? `We are currently expanding in ${currentMetroName}. Switch to 'All Metros' to see shifts in nearby regions.` : "There are no open shifts right now. Your expansion team is working on it!"}
           </p>
           {filterType === 'metro' && (
             <button onClick={() => setFilterType('all')} className="bg-[#fbbf24] text-[#0b3828] font-semibold px-10 py-4 rounded-2xl hover:bg-[#f59e0b] shadow-lg shadow-[#fbbf24]/20 transition-all active:scale-95">
               Explore All Available Regions
             </button>
           )}
        </div>
      ) : (
        <div className="space-y-10">
            {filteredShifts.map((shift) => {
                const connectionStatus = myConnections[shift.center_id]
                const isActive = connectionStatus === 'active'
                const isPending = connectionStatus === 'invited'
                const isClaimed = claimedShiftIds.has(shift.id)
                const isInterested = interestedShiftIds.has(shift.id)
                const centerMetro = metros.find((m: any) => m.id === shift.centers?.metro_area_id)
                return (
                  <div key={shift.id} className="bg-white border-2 border-[#f0f4f2] hover:border-[#157354] rounded-[3.5rem] p-12 shadow-sm hover:shadow-[0_40px_80px_-20px_rgba(21,115,84,0.15)] transition-all duration-700 flex flex-col xl:flex-row xl:items-center justify-between gap-12 group relative overflow-hidden backdrop-blur-sm">
                    {/* Background Detail */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-[#f0fdf4] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
                    
                    <div className="flex-1 space-y-8 relative z-10">
                       <div className="flex flex-wrap items-center gap-3">
                          <div className="inline-flex items-center gap-2 bg-[#edf7f3] text-[#157354] px-4 py-1.5 rounded-xl text-xs font-semibold border border-[#d4ede4]">
                             {shift.staff_type_needed || 'Professional'}
                          </div>
                          {centerMetro && (
                            <div className="inline-flex items-center gap-2 bg-[#f8faf9] text-[#6b7a73] px-4 py-1.5 rounded-xl text-[10px] font-medium border border-[#e2e8e4]">
                               <Globe className="w-3 h-3" /> {centerMetro.name}
                            </div>
                          )}
                          {isActive && (
                            <div className="inline-flex items-center gap-2 bg-[#f0fdf4] text-[#16a34a] px-4 py-1.5 rounded-xl text-[10px] font-medium border border-[#bbf7d0]">
                                <CheckCircle2 className="w-3.5 h-3.5" /> High Match
                            </div>
                          )}
                          <div className="inline-flex items-center gap-1.5 bg-[#fbbf24] text-[#0b3828] px-4 py-1.5 rounded-xl text-xs font-semibold shadow-md shadow-amber-200/50">
                             ${shift.hourly_rate || '20.00'} / hr
                          </div>
                       </div>
                       
                       <div className="space-y-2">
                          <h3 className="text-2xl font-bold text-[#0b3828] group-hover:text-[#157354] transition-colors tracking-tight leading-snug">
                             {shift.centers?.name}
                          </h3>
                          <div className="flex items-center gap-2 text-[#a8b5ae] font-medium text-xs">
                             <MapPin className="w-4 h-4 text-[#157354]" /> {shift.centers?.city}, {shift.centers?.state}
                          </div>
                       </div>
                       
                       <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 pt-4">
                          <div className="flex items-center gap-4 text-[#1a2e25]">
                             <div className="w-12 h-12 rounded-xl bg-[#f8faf9] flex items-center justify-center border-2 border-[#f0f4f2] shadow-sm">
                                <Calendar className="w-5 h-5 text-[#157354]" />
                             </div>
                             <div className="flex flex-col">
                                <span className="text-[10px] text-[#a8b5ae] font-medium mb-1">Date</span>
                                <span className="text-base font-semibold tracking-tight">{new Date(shift.shift_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                             </div>
                          </div>
                          
                          <div className="flex items-center gap-4 text-[#1a2e25]">
                             <div className="w-12 h-12 rounded-xl bg-[#f8faf9] flex items-center justify-center border-2 border-[#f0f4f2] shadow-sm">
                                <Clock className="w-5 h-5 text-[#157354]" />
                             </div>
                             <div className="flex flex-col">
                                <span className="text-[10px] text-[#a8b5ae] font-medium mb-1">Hours</span>
                                <span className="text-base font-semibold tracking-tight">{shift.start_time.substring(0,5)} Ã¢â‚¬â€œ {shift.end_time.substring(0,5)}</span>
                             </div>
                          </div>

                          <div className="flex items-center gap-4 text-[#1a2e25] sm:col-span-2 mt-2 p-4 bg-[#f8faf9] rounded-2xl border-2 border-[#f0f4f2]">
                             <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm">
                                <ShieldCheck className="w-5 h-5 text-[#157354]" />
                             </div>
                             <div>
                                <div className="text-[10px] text-[#a8b5ae] font-medium mb-1">Payment Method</div>
                                <div className="text-sm font-medium text-[#1a2e25] capitalize">{shift.payment_mode || 'Corporate Payroll'}</div>
                             </div>
                          </div>
                       </div>
                    </div>
                    
                    <div className="shrink-0 flex flex-col gap-5 min-w-[280px] relative z-10">
                        {isClaimed ? (
                          <div className="w-full flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 border-2 border-emerald-200 font-semibold px-8 py-5 rounded-2xl text-base">
                             <CheckCircle2 className="w-5 h-5" /> Assigned
                          </div>
                        ) : isInterested ? (
                          <div className="flex flex-col gap-3 w-full">
                            <div className="flex items-center gap-2 text-[#157354] text-xs font-medium px-2">
                              <Heart className="w-3.5 h-3.5 fill-[#157354]" /> Interest registered — ready to commit?
                            </div>
                            <button
                              onClick={() => handleClaim(shift.id)}
                              disabled={claimingShiftId === shift.id}
                              className="w-full bg-[#fbbf24] text-[#0b3828] font-semibold px-8 py-5 rounded-2xl hover:bg-[#f59e0b] shadow-lg shadow-amber-200/40 transition-all hover:-translate-y-1 active:scale-95 text-base flex items-center justify-center gap-2 disabled:opacity-60"
                            >
                              {claimingShiftId === shift.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle2 className="w-4 h-4" /> Claim Shift</>}
                            </button>
                          </div>
                        ) : isActive ? (
                          <button
                            onClick={() => handleExpressInterest(shift.id)}
                            disabled={expressingInterestId === shift.id}
                            className="w-full bg-white text-[#157354] border-2 border-[#157354] font-semibold px-8 py-5 rounded-2xl hover:bg-[#edf7f3] transition-all hover:-translate-y-1 active:scale-95 text-base flex items-center justify-center gap-2 disabled:opacity-60"
                          >
                            {expressingInterestId === shift.id ? <Loader2 className="w-5 h-5 animate-spin text-[#157354]" /> : <><Heart className="w-4 h-4" /> Express Interest</>}
                          </button>
                       ) : isPending ? (
                          <Link
                            href="/staff/centers"
                            className="w-full bg-amber-50 text-amber-700 font-semibold px-8 py-5 rounded-2xl border-2 border-amber-200 hover:border-amber-400 transition-all flex items-center justify-center gap-2 group/btn text-base"
                          >
                             Approval Pending <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                          </Link>
                       ) : (
                          <button
                            disabled={joiningCenterId === shift.centers?.id}
                           onClick={() => handleStartOnboarding(shift.center_id, shift.centers?.slug)}
                           className="w-full bg-[#157354] text-white font-semibold px-8 py-5 rounded-2xl hover:bg-[#0f4a36] shadow-lg shadow-[#157354]/30 transition-all hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-3 text-base"
                         >
                            {joiningCenterId === shift.centers?.id ? <Loader2 className="w-8 h-8 animate-spin text-white" /> : (
                              <>
                                <ShieldCheck className="w-5 h-5" />
                                <span>Join Center</span>
                              </>
                            )}
                         </button>
                       )}
                       
                       <p className="px-8 text-[11px] text-[#6b7a73] font-bold text-center leading-relaxed italic opacity-60">
                           {isClaimed ? 'Your claim is pending center confirmation.' : isActive ? "Verified connection for this regional facility." : "Regional credentials required for this metro location."}
                       </p>
                    </div>
                  </div>
                )
            })}
        </div>
      )}
    </div>
  )
}

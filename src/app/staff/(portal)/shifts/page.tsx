'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Shift } from '@/lib/types'
import { Calendar, Clock, MapPin, CheckCircle2 } from 'lucide-react'

export default function StaffShiftsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [shifts, setShifts] = useState<any[]>([])

  useEffect(() => {
    async function loadShifts() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Get staff profile
      const { data: profile } = await supabase
        .from('staff_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!profile) {
          setLoading(false)
          return
      }

      // Get shifts for centers this staff is active in
      // For MVP we just fetch open shifts from centers where status='active'
      const { data: activeCenters } = await supabase
        .from('center_staff')
        .select('center_id')
        .eq('staff_id', profile.id)
        .eq('status', 'active')
        
      if (activeCenters && activeCenters.length > 0) {
          const centerIds = activeCenters.map(c => c.center_id)
          
          const today = new Date().toISOString().split('T')[0]
          
          const { data: openShifts } = await supabase
            .from('shifts')
            .select(`
                *,
                centers (name, address, city, state),
                classrooms (name, age_group)
            `)
            .in('center_id', centerIds)
            .eq('status', 'open')
            .gte('shift_date', today)
            .order('shift_date', { ascending: true })
            
          setShifts(openShifts || [])
      }

      setLoading(false)
    }

    loadShifts()
  }, [])

  if (loading) {
     return <div className="animate-pulse space-y-4">
        <div className="h-32 bg-white rounded-2xl border border-[#e2e8e4]"></div>
        <div className="h-32 bg-white rounded-2xl border border-[#e2e8e4]"></div>
     </div>
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Available Shifts</h1>
        <p className="text-[#6b7a73]">Open shifts from all your connected care centers.</p>
      </div>

      {shifts.length === 0 ? (
        <div className="bg-white border border-[#e2e8e4] rounded-2xl p-12 text-center shadow-sm">
           <CheckCircle2 className="w-16 h-16 text-[#a9dac9] mx-auto mb-4" />
           <h2 className="text-xl font-bold text-[#1a2e25] mb-2">You're all caught up</h2>
           <p className="text-[#6b7a73] max-w-md mx-auto">
              There are no open shifts right now. We'll send you an SMS automatically when a new shift matches your profile.
           </p>
        </div>
      ) : (
        <div className="space-y-4">
            {shifts.map((shift) => (
                <div key={shift.id} className="bg-white border border-[#e2e8e4] hover:border-[#157354] rounded-2xl p-6 shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-6">
                   <div className="space-y-3">
                      <div className="inline-flex items-center gap-1.5 bg-[#edf7f3] text-[#157354] px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide">
                         {shift.staff_type_needed ? shift.staff_type_needed : 'Any Role'}
                      </div>
                      
                      <h3 className="text-lg font-bold text-[#1a2e25]">{shift.centers?.name}</h3>
                      
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 text-sm text-[#6b7a73]">
                         <div className="flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 shrink-0" />
                            <span>{new Date(shift.shift_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                         </div>
                         <div className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4 shrink-0" />
                            <span>{shift.start_time.substring(0,5)} - {shift.end_time.substring(0,5)}</span>
                         </div>
                         <div className="flex items-center gap-1.5">
                            <MapPin className="w-4 h-4 shrink-0" />
                            <span className="truncate max-w-[200px]">{shift.centers?.city}, {shift.centers?.state}</span>
                         </div>
                      </div>
                      
                      {shift.classrooms && (
                          <div className="text-sm bg-[#f8faf9] px-3 py-2 rounded-lg inline-block border border-[#e2e8e4]">
                             Room: <span className="font-medium text-[#1a2e25]">{shift.classrooms.name}</span> ({shift.classrooms.age_group})
                          </div>
                      )}
                   </div>
                   
                   <button className="shrink-0 bg-[#fbbf24] text-[#0b3828] font-bold px-8 py-3.5 rounded-xl hover:bg-[#f59e0b] shadow-sm transition-colors w-full md:w-auto">
                      Claim Shift
                   </button>
                </div>
            ))}
        </div>
      )}
    </div>
  )
}

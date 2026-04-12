'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Calendar, Plus, Users, Clock, Edit2, MapPin } from 'lucide-react'
import Link from 'next/link'

export default function CenterShiftsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [shifts, setShifts] = useState<any[]>([])

  useEffect(() => {
    async function loadShifts() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: adminData } = await supabase
        .from('center_admins')
        .select('center_id')
        .eq('user_id', user.id)
        .single()

      if (!adminData) {
          setLoading(false)
          return
      }

      const { data: centerShifts } = await supabase
        .from('shifts')
        .select(`
            *,
            classrooms (name, age_group),
            shift_claims (
                id,
                status,
                staff_profiles (first_name, last_name, avatar_url)
            )
        `)
        .eq('center_id', adminData.center_id)
        .order('shift_date', { ascending: false })

      setShifts(centerShifts || [])
      setLoading(false)
    }

    loadShifts()
  }, [])

  if (loading) {
     return <div className="animate-pulse space-y-4">
        <div className="h-20 bg-white rounded-2xl border border-[#e2e8e4]"></div>
        <div className="h-32 bg-white rounded-2xl border border-[#e2e8e4]"></div>
     </div>
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Shifts</h1>
          <p className="text-[#6b7a73]">Manage your open shifts and view confirmed staff.</p>
        </div>
        <Link 
           href="/center/dashboard/shifts/new"
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
                  <th className="px-6 py-4">Date & Time</th>
                  <th className="px-6 py-4">Classroom</th>
                  <th className="px-6 py-4">Role Needed</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Staff Assigned</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2e8e4]">
                {shifts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-[#6b7a73]">
                      <Calendar className="w-8 h-8 text-[#a9dac9] mx-auto mb-3" />
                      <p className="font-medium text-[#1a2e25] mb-1">No shifts found</p>
                      <p>You haven't posted any shifts yet.</p>
                    </td>
                  </tr>
                ) : (
                  shifts.map((shift) => {
                     const isFilled = shift.status === 'filled'
                     const confirmedClaim = shift.shift_claims?.find((c: any) => c.status === 'confirmed')
                     
                     return (
                      <tr key={shift.id} className="hover:bg-[#f8faf9] transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-semibold text-[#1a2e25]">
                             {new Date(shift.shift_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                          <div className="text-[#6b7a73] text-xs mt-0.5 flex items-center gap-1">
                             <Clock className="w-3 h-3" />
                             {shift.start_time.substring(0,5)} - {shift.end_time.substring(0,5)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                           {shift.classrooms ? (
                              <div>
                                 <div className="font-medium text-[#1a2e25]">{shift.classrooms.name}</div>
                                 <div className="text-[#6b7a73] text-xs">{shift.classrooms.age_group}</div>
                              </div>
                           ) : (
                              <span className="text-[#6b7a73] italic">Any room</span>
                           )}
                        </td>
                        <td className="px-6 py-4">
                           <div className="inline-flex bg-[#edf7f3] text-[#157354] px-2 py-1 rounded-md text-xs font-semibold uppercase tracking-wide">
                              {shift.staff_type_needed || 'Any'}
                           </div>
                        </td>
                        <td className="px-6 py-4">
                           <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                              shift.status === 'open' ? 'bg-[#d4ede4] text-[#0f4a36]' :
                              shift.status === 'filled' ? 'bg-[#f0fdf4] text-[#16a34a] border border-[#bbf7d0]' :
                              'bg-gray-100 text-gray-700'
                           }`}>
                              {shift.status.charAt(0).toUpperCase() + shift.status.slice(1)}
                           </span>
                        </td>
                        <td className="px-6 py-4">
                           {isFilled && confirmedClaim ? (
                              <div className="flex items-center gap-2">
                                 <div className="w-6 h-6 rounded-full bg-[#157354] text-white flex items-center justify-center text-xs font-bold shrink-0">
                                    {confirmedClaim.staff_profiles.first_name[0]}
                                 </div>
                                 <span className="font-medium text-[#1a2e25]">
                                    {confirmedClaim.staff_profiles.first_name} {confirmedClaim.staff_profiles.last_name}
                                 </span>
                              </div>
                           ) : (
                              <span className="text-[#a8b5ae] italic">Unassigned</span>
                           )}
                        </td>
                        <td className="px-6 py-4 text-right">
                           <button className="text-[#157354] hover:text-[#0b3828] font-medium bg-[#edf7f3] px-3 py-1.5 rounded-lg transition-colors">
                              View
                           </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
        </div>
      </div>
    </div>
  )
}

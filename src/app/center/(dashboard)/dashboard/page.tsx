'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Shift, StaffProfile } from '@/lib/types'
import Link from 'next/link'
import { Calendar, Users, AlertCircle, FileText, ArrowRight, CheckCircle2, Clock } from 'lucide-react'

export default function DashboardOverview() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    activeStaff: 0,
    openShifts: 0,
    filledShifts: 0,
    missingDocs: 0
  })

  useEffect(() => {
    async function fetchDashboardStats() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Get center ID
      const { data: adminData } = await supabase
        .from('center_admins')
        .select('center_id')
        .eq('user_id', user.id)
        .single()

      if (!adminData) return

      const centerId = adminData.center_id

      // 1. Get active staff count
      const { count: staffCount } = await supabase
        .from('center_staff')
        .select('*', { count: 'exact', head: true })
        .eq('center_id', centerId)
        .eq('status', 'active')

      // 2. Get open shifts count (future shifts)
      const today = new Date().toISOString().split('T')[0]
      const { count: openShiftsCount } = await supabase
        .from('shifts')
        .select('*', { count: 'exact', head: true })
        .eq('center_id', centerId)
        .eq('status', 'open')
        .gte('shift_date', today)

      // 3. Get filled shifts count (this month - simplified to future filled for now)
      const { count: filledShiftsCount } = await supabase
        .from('shifts')
        .select('*', { count: 'exact', head: true })
        .eq('center_id', centerId)
        .eq('status', 'filled')
        .gte('shift_date', today)

      setStats({
        activeStaff: staffCount || 0,
        openShifts: openShiftsCount || 0,
        filledShifts: filledShiftsCount || 0,
        missingDocs: 0 // Will implement document engine logic later
      })
      
      setLoading(false)
    }

    fetchDashboardStats()
  }, [])

  if (loading) {
     return <div className="animate-pulse flex gap-4">
        <div className="h-32 w-1/4 bg-white rounded-2xl border border-[#e2e8e4]"></div>
        <div className="h-32 w-1/4 bg-white rounded-2xl border border-[#e2e8e4]"></div>
        <div className="h-32 w-1/4 bg-white rounded-2xl border border-[#e2e8e4]"></div>
     </div>
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Overview</h1>
          <p className="text-[#6b7a73]">Welcome back to your CareLocal dashboard.</p>
        </div>
      </div>

      {/* ── Stats Grid ── */}
      <div className="grid md:grid-cols-3 gap-6 mb-10">
        <div className="bg-white p-6 rounded-2xl border border-[#e2e8e4] shadow-sm flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-[#6b7a73] mb-1">Open Shifts</p>
            <div className="text-3xl font-extrabold text-[#0b3828]">{stats.openShifts}</div>
          </div>
          <div className="w-12 h-12 rounded-full bg-[#edf7f3] flex items-center justify-center">
            <Calendar className="w-6 h-6 text-[#157354]" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-[#e2e8e4] shadow-sm flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-[#6b7a73] mb-1">Active Staff Pool</p>
            <div className="text-3xl font-extrabold text-[#0b3828]">{stats.activeStaff}</div>
          </div>
          <div className="w-12 h-12 rounded-full bg-[#f0fdf4] flex items-center justify-center">
            <Users className="w-6 h-6 text-[#16a34a]" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-[#e2e8e4] shadow-sm flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-[#6b7a73] mb-1">Doc Reviews Pending</p>
            <div className="text-3xl font-extrabold text-[#0b3828]">0</div>
          </div>
          <div className="w-12 h-12 rounded-full bg-[#fffbeb] flex items-center justify-center">
            <FileText className="w-6 h-6 text-[#d97706]" />
          </div>
        </div>
      </div>

      {stats.activeStaff === 0 && (
        <div className="bg-[#edf7f3] border border-[#a9dac9] rounded-2xl p-8 text-center mb-8">
           <div className="w-16 h-16 bg-[#157354] rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-white" />
           </div>
           <h2 className="text-xl font-bold text-[#0b3828] mb-2">Build your staff pool</h2>
           <p className="text-[#3d5a4f] max-w-lg mx-auto mb-6">
              You can't post a shift until you invite staff to your center. Invite your existing subs, floaters, and teachers. Their accounts are free.
           </p>
           <Link 
              href="/center/dashboard/staff" 
              className="inline-flex items-center gap-2 bg-[#157354] text-white font-semibold px-6 py-3 rounded-xl hover:bg-[#0f4a36] transition-colors shadow-sm"
            >
              Invite Staff <ArrowRight className="w-4 h-4" />
           </Link>
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white border border-[#e2e8e4] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[#e2e8e4]">
            <h2 className="font-bold text-[#1a2e25] text-lg">Upcoming Open Shifts</h2>
          </div>
          <div className="p-6 text-center text-[#6b7a73]">
            {stats.openShifts === 0 ? (
               <div className="py-8">
                  <CheckCircle2 className="w-12 h-12 text-[#a9dac9] mx-auto mb-3" />
                  <p>No open shifts right now.</p>
               </div>
            ) : (
               <p>Shifts list will appear here.</p>
            )}
          </div>
        </div>

        <div className="bg-white border border-[#e2e8e4] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[#e2e8e4]">
             <h2 className="font-bold text-[#1a2e25] text-lg">Recent Staff Activity</h2>
          </div>
          <div className="p-6 text-center text-[#6b7a73]">
             <div className="py-8">
                <Clock className="w-12 h-12 text-[#e2e8e4] mx-auto mb-3" />
                <p>Activity feed will appear here.</p>
             </div>
          </div>
        </div>
      </div>
    </div>
  )
}

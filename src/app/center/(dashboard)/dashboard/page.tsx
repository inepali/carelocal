'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Shift, StaffProfile } from '@/lib/types'
import Link from 'next/link'
import { Calendar, Users, AlertCircle, FileText, ArrowRight, CheckCircle2, Clock, Plus, UserPlus, Globe, Star } from 'lucide-react'

export default function DashboardOverview() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    activeStaff: 0,
    openShifts: 0,
    filledShifts: 0,
    missingDocs: 0,
    avgRating: 0,
    totalReviews: 0,
    trialDaysLeft: 0,
    isTrialing: false
  })
  const [upcomingShifts, setUpcomingShifts] = useState<any[]>([])
  const [recentActivity, setRecentActivity] = useState<any[]>([])

  useEffect(() => {
    async function fetchDashboardData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: adminData } = await supabase
        .from('center_admins')
        .select('center_id')
        .eq('user_id', user.id)
        .single()

      if (!adminData) return
      const centerId = adminData.center_id

      const { data: centerData } = await supabase
        .from('centers')
        .select('created_at, trial_months, subscription_status, subscriptions(status)')
        .eq('id', centerId)
        .single()

      let trialDaysLeft = 0;
      let isTrialing = false;
      if (centerData) {
        const sub = centerData.subscriptions?.[0]
        const isActive = centerData.subscription_status === 'active' || (sub && sub.status === 'active')
        
        if (!isActive) {
          const trialMonths = centerData.trial_months || 6
          const trialEnd = new Date(centerData.created_at)
          trialEnd.setMonth(trialEnd.getMonth() + trialMonths)
          trialDaysLeft = Math.ceil((trialEnd.getTime() - new Date().getTime()) / (1000 * 3600 * 24))
          if (trialDaysLeft > 0) isTrialing = true
        }
      }

      const today = new Date().toISOString().split('T')[0]

      // 1. Fetch Stats & Listings in Parallel
      const [
        { count: staffCount },
        { count: openCount },
        { count: pendingDocCount },
        { data: shiftsData },
        { data: claimsData },
        { data: poolData },
        { data: reviewsData }
      ] = await Promise.all([
        supabase.from('center_staff').select('*', { count: 'exact', head: true }).eq('center_id', centerId).eq('status', 'active'),
        supabase.from('shifts').select('*', { count: 'exact', head: true }).eq('center_id', centerId).eq('status', 'open').gte('shift_date', today),
        supabase.from('center_staff_document_status').select('*', { count: 'exact', head: true }).eq('center_id', centerId).eq('status', 'pending_review'),
        supabase.from('shifts').select('*, classrooms(name)').eq('center_id', centerId).eq('status', 'open').gte('shift_date', today).order('shift_date', { ascending: true }).limit(3),
        supabase.from('shift_claims').select('*, staff_profiles(first_name, last_name), shifts(shift_date, start_time, classroom_id, classrooms(name))').eq('status', 'pending').order('claimed_at', { ascending: false }).limit(3),
        supabase.from('center_staff').select('*, staff_profiles(first_name, last_name)').eq('center_id', centerId).order('added_at', { ascending: false }).limit(3),
        supabase.from('shift_reviews').select('rating').eq('reviewee_id', centerId).eq('reviewer_type', 'staff')
      ])

      let avgRating = 0
      let totalReviews = 0
      if (reviewsData && reviewsData.length > 0) {
        totalReviews = reviewsData.length
        const sum = reviewsData.reduce((acc, curr) => acc + curr.rating, 0)
        avgRating = sum / totalReviews
      }

      setStats({
        activeStaff: staffCount || 0,
        openShifts: openCount || 0,
        filledShifts: 0, // Placeholder
        missingDocs: pendingDocCount || 0,
        avgRating,
        totalReviews,
        trialDaysLeft,
        isTrialing
      })

      setUpcomingShifts(shiftsData || [])

      // Combine claims and new staff for activity feed
      const activity = [
        ...(claimsData || []).map(c => ({
          id: c.id,
          type: 'claim',
          text: `${c.staff_profiles.first_name} claimed shift for ${c.shifts.classrooms?.name || 'Any Room'}`,
          time: c.claimed_at,
          icon: Calendar
        })),
        ...(poolData || []).map(p => ({
          id: p.staff_id,
          type: 'join',
          text: `${p.staff_profiles.first_name} joined your staff pool`,
          time: p.added_at,
          icon: UserPlus
        }))
      ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 5)

      setRecentActivity(activity)
      setLoading(false)
    }

    fetchDashboardData()
  }, [])

  if (loading) {
     return <div className="space-y-8 animate-pulse pt-10 px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1,2,3].map(i => <div key={i} className="h-32 bg-white rounded-3xl border border-slate-100 shadow-sm"></div>)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="h-96 bg-white rounded-3xl border border-slate-100 shadow-sm"></div>
          <div className="h-96 bg-white rounded-3xl border border-slate-100 shadow-sm"></div>
        </div>
     </div>
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <div className="flex items-center gap-2 text-[#157354] font-black uppercase tracking-[0.3em] text-[10px] mb-2">
             <Globe className="w-3.5 h-3.5" /> Expansion Region
          </div>
          <h1 className="text-4xl font-black text-[#0b3828] tracking-tight mb-2">Overview</h1>
          <p className="text-[#6b7a73] font-medium">Real-time status of your center's staffing and compliance.</p>
        </div>
        <Link 
          href="/center/shifts/new"
          className="bg-[#fbbf24] text-[#0b3828] font-black px-8 py-4 rounded-2xl hover:bg-[#f59e0b] shadow-lg shadow-amber-200/50 transition-all active:scale-95 flex items-center gap-2"
        >
          <Plus className="w-5 h-5" /> Post New Shift
        </Link>
      </div>

      {stats.isTrialing && (
        <div className="mb-10 bg-[#fffbeb] border border-[#fcd34d] p-4 rounded-[1.5rem] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-bottom-2">
           <div className="flex items-center gap-4">
             <div className="w-12 h-12 rounded-xl bg-[#fde68a] flex items-center justify-center shrink-0">
               <AlertCircle className="w-6 h-6 text-[#d97706]" />
             </div>
             <div>
               <div className="font-black text-[#b45309] text-lg">Free Trial Active</div>
               <div className="text-sm font-bold text-[#d97706]">You have {stats.trialDaysLeft} days remaining on your free trial.</div>
             </div>
           </div>
           <Link href="/center/settings/billing" className="bg-[#d97706] text-white px-6 py-3 rounded-xl font-bold hover:bg-[#b45309] transition-colors shadow-sm whitespace-nowrap text-center">
             Subscribe Now
           </Link>
        </div>
      )}

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <div className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 group">
          <div className="flex items-start justify-between mb-6">
            <div className="p-4 rounded-2xl bg-[#edf7f3] text-[#157354] shadow-sm group-hover:bg-[#157354] group-hover:text-white transition-colors">
              <Calendar className="w-6 h-6" />
            </div>
            <div className="text-[10px] font-black uppercase tracking-widest text-[#a8b5ae]">Active</div>
          </div>
          <div>
            <div className="text-4xl font-black text-[#0b3828] mb-1">{stats.openShifts}</div>
            <div className="text-sm font-bold text-[#6b7a73]">Open Shifts Today</div>
          </div>
        </div>

        <div className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 group">
          <div className="flex items-start justify-between mb-6">
            <div className="p-4 rounded-2xl bg-[#f0fdf4] text-[#16a34a] shadow-sm group-hover:bg-[#16a34a] group-hover:text-white transition-colors">
              <Users className="w-6 h-6" />
            </div>
            <div className="text-[10px] font-black uppercase tracking-widest text-[#a8b5ae]">Network</div>
          </div>
          <div>
            <div className="text-4xl font-black text-[#0b3828] mb-1">{stats.activeStaff}</div>
            <div className="text-sm font-bold text-[#6b7a73]">Verified Educators</div>
          </div>
        </div>

        <div className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 group">
          <div className="flex items-start justify-between mb-6">
            <div className="p-4 rounded-2xl bg-[#fffbeb] text-[#d97706] shadow-sm group-hover:bg-[#d97706] group-hover:text-white transition-colors">
              <FileText className="w-6 h-6" />
            </div>
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-500">Urgent</div>
          </div>
          <div>
            <div className="text-4xl font-black text-[#0b3828] mb-1">{stats.missingDocs}</div>
            <div className="text-sm font-bold text-[#6b7a73]">Docs Pending Review</div>
          </div>
        </div>

        <div className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 group">
          <div className="flex items-start justify-between mb-6">
            <div className="p-4 rounded-2xl bg-[#fefce8] text-[#fbbf24] shadow-sm group-hover:bg-[#fbbf24] group-hover:text-white transition-colors">
              <Star className="w-6 h-6" />
            </div>
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-500">Reputation</div>
          </div>
          <div>
            <div className="text-4xl font-black text-[#0b3828] mb-1 flex items-baseline gap-1">
              {stats.avgRating > 0 ? stats.avgRating.toFixed(1) : '—'}
              <Star className="w-5 h-5 text-[#fbbf24] fill-[#fbbf24]" />
            </div>
            <div className="text-sm font-bold text-[#6b7a73]">{stats.totalReviews} Staff Review{stats.totalReviews !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Upcoming Shifts */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden shadow-sm flex flex-col">
          <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-[#f8faf9]/50">
            <h2 className="text-xl font-black text-[#0b3828] tracking-tight">Upcoming Open Shifts</h2>
            <Link href="/center/shifts" className="text-[#157354] font-black text-xs uppercase tracking-widest hover:underline">View All</Link>
          </div>
          <div className="p-6 flex-1 space-y-4">
            {upcomingShifts.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-[#a9dac9] mx-auto mb-3 opacity-50" />
                <p className="text-sm font-bold text-[#6b7a73]">You're all set! No open shifts.</p>
              </div>
            ) : (
              upcomingShifts.map((shift) => (
                <div key={shift.id} className="flex items-center gap-4 p-5 rounded-2xl bg-[#f8faf9] border border-[#e2e8e4] hover:border-[#157354] transition-all group">
                  <div className="w-12 h-12 rounded-xl bg-white border border-[#e2e8e4] flex flex-col items-center justify-center shrink-0">
                    <span className="text-[10px] font-black text-[#157354] uppercase tracking-tighter">
                      {new Date(shift.shift_date).toLocaleDateString('en-US', { month: 'short' })}
                    </span>
                    <span className="text-lg font-black text-[#0b3828] leading-none">
                      {new Date(shift.shift_date).getDate()}
                    </span>
                  </div>
                  <div className="flex-1">
                    <div className="font-black text-[#1a2e25] text-sm group-hover:text-[#157354] transition-colors">
                      {shift.classrooms?.name || 'Any Room'}
                    </div>
                    <div className="text-[11px] font-bold text-[#6b7a73] flex items-center gap-1.5 mt-0.5">
                      <Clock className="w-3 h-3" /> {shift.start_time.substring(0,5)} - {shift.end_time.substring(0,5)}
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-[#a8b5ae] group-hover:translate-x-1 transition-transform" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden shadow-sm flex flex-col">
          <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-[#f8faf9]/50">
             <h2 className="text-xl font-black text-[#0b3828] tracking-tight">Recent Activity</h2>
          </div>
          <div className="p-6 flex-1 space-y-2">
            {recentActivity.length === 0 ? (
              <div className="py-12 text-center">
                <Clock className="w-12 h-12 text-[#e2e8e4] mx-auto mb-3 opacity-50" />
                <p className="text-sm font-bold text-[#6b7a73]">No recent activity to show.</p>
              </div>
            ) : (
              recentActivity.map((item, i) => (
                <div key={i} className="flex items-center gap-4 p-4 rounded-2xl hover:bg-slate-50 transition-colors group">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${item.type === 'claim' ? 'bg-[#edf7f3] text-[#157354]' : 'bg-[#f0fdf4] text-[#16a34a]'}`}>
                    <item.icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-[#1a2e25] text-sm">{item.text}</div>
                    <div className="text-[10px] font-black text-[#a8b5ae] uppercase tracking-widest mt-0.5">
                      {new Date(item.time).toLocaleDateString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-6 mt-auto">
             <button className="w-full py-4 bg-[#f8faf9] rounded-2xl text-[#157354] font-black text-xs uppercase tracking-widest hover:bg-[#edf7f3] transition-all border border-[#e2e8e4]">
                Download Activity Report
             </button>
          </div>
        </div>
      </div>
      
      {stats.activeStaff === 0 && (
        <div className="mt-8 bg-[#edf7f3] border border-[#a9dac9] rounded-[2.5rem] p-8 text-center">
          <div className="w-16 h-16 bg-[#157354] rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Users className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-black text-[#0b3828] mb-2 tracking-tight">Build your staff pool</h2>
          <p className="text-[#3d5a4f] max-w-lg mx-auto mb-6 font-medium">
            You can't post a shift until you invite staff to your center. Invite your existing subs, floaters, and teachers to get started.
          </p>
          <Link 
            href="/center/staff" 
            className="inline-flex items-center gap-2 bg-[#157354] text-white font-black px-8 py-4 rounded-2xl hover:bg-[#0f4a36] transition-all shadow-lg active:scale-95"
          >
            Invite Staff <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      )}
    </div>
  )
}

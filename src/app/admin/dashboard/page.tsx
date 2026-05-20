'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { 
  Building2, 
  Users, 
  TrendingUp, 
  AlertCircle,
  Activity,
  UserPlus,
  CalendarCheck,
  CheckCircle2,
  CreditCard
} from 'lucide-react'

export default function AdminDashboardPage() {
  const supabase = createClient()
  const [stats, setStats] = useState({
    totalCenters: 0,
    totalStaff: 0,
    activeShifts: 0,
    filledToday: 0
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadStats() {
      // Parallel fetches for efficiency
      const [
        { count: centersCount },
        { count: staffCount },
        { count: shiftsCount },
        { count: filledCount }
      ] = await Promise.all([
        supabase.from('centers').select('*', { count: 'exact', head: true }),
        supabase.from('staff_profiles').select('*', { count: 'exact', head: true }),
        supabase.from('shifts').select('*', { count: 'exact', head: true }).eq('status', 'open').neq('is_archived', true),
        supabase.from('shifts').select('*', { count: 'exact', head: true }).eq('status', 'filled').neq('is_archived', true)
      ])

      setStats({
        totalCenters: centersCount || 0,
        totalStaff: staffCount || 0,
        activeShifts: shiftsCount || 0,
        filledToday: filledCount || 0
      })
      setLoading(false)
    }

    loadStats()
  }, [])

  const statCards = [
    { label: 'Total Centers', value: stats.totalCenters, icon: Building2, color: 'bg-blue-500', trend: '+12% this month' },
    { label: 'Active Staff', value: stats.totalStaff, icon: Users, color: 'bg-emerald-500', trend: '+5% this month' },
    { label: 'Open Shifts', value: stats.activeShifts, icon: Activity, color: 'bg-amber-500', trend: 'Critical: 4 expiring' },
    { label: 'Fulfillment Rate', value: '94%', icon: CheckCircle2, color: 'bg-indigo-500', trend: '+2% from last week' },
  ]

  if (loading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-white rounded-3xl border border-slate-200"></div>)}
        </div>
        <div className="h-96 bg-white rounded-3xl border border-slate-200"></div>
      </div>
    )
  }

  return (
    <div className="space-y-10">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2">Platform Overview</h1>
          <p className="text-slate-500 font-medium">Real-time performance metrics across all onboarded locations.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm">
            Export Report
          </button>
          <button className="px-5 py-2.5 bg-[#0f172a] rounded-xl text-sm font-bold text-white hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/10">
            System Status
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card) => (
          <div key={card.label} className="bg-white p-7 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
            <div className="flex items-start justify-between mb-6">
              <div className={`p-4 rounded-2xl ${card.color} text-white shadow-lg`}>
                <card.icon className="w-6 h-6" />
              </div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-600 transition-colors">
                Real-time
              </div>
            </div>
            <div>
              <div className="text-3xl font-black text-slate-900 mb-1">{card.value}</div>
              <div className="text-sm font-bold text-slate-500 mb-4">{card.label}</div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600">
                <TrendingUp className="w-3.5 h-3.5" />
                {card.trend}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Main Content Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-8 border-b border-slate-100 flex items-center justify-between">
             <h2 className="text-xl font-black text-slate-900 tracking-tight">System-Wide Activity</h2>
             <button className="text-blue-600 font-bold text-xs hover:underline uppercase tracking-wider">View All</button>
          </div>
          <div className="p-4 flex-1 space-y-2">
            {[
              { type: 'onboarding', user: 'Sunshine Early Learning', time: '2 mins ago', action: 'New Center Registered', icon: UserPlus, color: 'text-blue-500 bg-blue-50' },
              { type: 'shift', user: 'Sarah Jenkins', time: '14 mins ago', action: 'Claimed Shift at Little Sprouts', icon: CalendarCheck, color: 'text-emerald-500 bg-emerald-50' },
              { type: 'alert', user: 'System', time: '1 hour ago', action: 'Cloudflare Workers Rate Limit reached', icon: AlertCircle, color: 'text-rose-500 bg-rose-50' },
              { type: 'payment', user: 'Bright Horizons', time: '3 hours ago', action: 'Subscription Renewed (Enterprise)', icon: CreditCard, color: 'text-indigo-500 bg-indigo-50' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-2xl hover:bg-slate-50 transition-colors cursor-pointer group">
                 <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${item.color}`}>
                   <item.icon className="w-6 h-6" />
                 </div>
                 <div className="flex-1">
                   <div className="font-black text-slate-900 text-sm group-hover:text-blue-600 transition-colors">{item.action}</div>
                   <div className="text-xs text-slate-500 font-semibold">{item.user}</div>
                 </div>
                 <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{item.time}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions / Metrics */}
        <div className="space-y-8">
           <div className="bg-[#0f172a] rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden group">
              <div className="relative z-10">
                <h3 className="text-lg font-black mb-2 tracking-tight">Platform Health</h3>
                <div className="flex items-baseline gap-2 mb-6">
                   <span className="text-4xl font-black">99.9%</span>
                   <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Optimal</span>
                </div>
                <div className="space-y-4">
                   <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                      <span>Database API</span>
                      <span className="text-emerald-400">Active</span>
                   </div>
                   <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-emerald-400 h-full w-[98%] shadow-[0_0_10px_rgba(52,211,153,0.5)]"></div>
                   </div>
                   <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                      <span>Auth Service</span>
                      <span className="text-emerald-400">Active</span>
                   </div>
                   <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-emerald-400 h-full w-[99%] shadow-[0_0_10px_rgba(52,211,153,0.5)]"></div>
                   </div>
                </div>
              </div>
              <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-blue-600/10 rounded-full blur-3xl group-hover:bg-blue-600/20 transition-all duration-700"></div>
           </div>

           <div className="bg-white rounded-[2.5rem] p-8 border border-slate-200">
              <h3 className="text-lg font-black text-slate-900 mb-6 flex items-center gap-2 tracking-tight">
                <TrendingUp className="w-5 h-5 text-blue-500" />
                Growth Strategy
              </h3>
              <p className="text-xs text-slate-500 font-bold leading-relaxed mb-6">
                Your target for Q2 is 250 verified centers. You are currently at 42% of this goal.
              </p>
              <button className="w-full py-4 bg-slate-100 rounded-2xl text-slate-900 font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all">
                Platform Settings
              </button>
           </div>
        </div>
      </div>
    </div>
  )
}

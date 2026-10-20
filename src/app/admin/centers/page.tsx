'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { 
  Building2, 
  Search, 
  Filter, 
  MoreHorizontal, 
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  CreditCard,
  MapPin,
  Calendar,
  FileDown,
  Trash2
} from 'lucide-react'
import Link from 'next/link'
import { exportCenterRequirementsAsTemplate } from '@/app/actions/requirement-templates.actions'
import { setCenterEnabled } from '@/app/actions/account-status.actions'
import { setCenterJobsEnabled } from '@/app/actions/jobs.actions'
import { purgeCenter } from '@/app/actions/data-cleanup.actions'
import { PurgeDialog } from '@/components/admin/PurgeDialog'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'

export default function AdminCentersPage() {
  const supabase = createClient()
  const [centers, setCenters] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [purging, setPurging] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    async function loadCenters() {
      const { data, error } = await supabase
        .from('centers')
        .select(`
          *,
          subscriptions (
            tier,
            status,
            current_period_end
          ),
          metro_areas (
            name
          )
        `)
        .order('created_at', { ascending: false })

      if (data) {
        setCenters(data)
      }
      setLoading(false)
    }

    loadCenters()
  }, [])

  const filteredCenters = centers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.city.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-100 text-emerald-700'
      case 'trialing': return 'bg-blue-100 text-blue-700'
      case 'past_due': return 'bg-amber-100 text-amber-700'
      case 'canceled': return 'bg-rose-100 text-rose-700'
      default: return 'bg-slate-100 text-slate-700'
    }
  }

  const updateTrialMonths = async (centerId: string, months: number) => {
    const { error } = await supabase.from('centers').update({ trial_months: months }).eq('id', centerId)
    if (!error) {
      setCenters(prev => prev.map(c => c.id === centerId ? { ...c, trial_months: months } : c))
    } else {
      showAlert('Failed to update trial months')
    }
  }

  const toggleEnabled = async (center: { id: string; name: string; is_active?: boolean }) => {
    const enabling = center.is_active === false
    const ok = await showConfirm(
      enabling
        ? `Enable ${center.name}? Its admins will be able to use the center portal again.`
        : `Disable ${center.name}? Its admins will be signed out and cannot use the center portal until you enable it again.`,
      { title: enabling ? 'Enable center' : 'Disable center', tone: enabling ? 'default' : 'danger', confirmLabel: enabling ? 'Enable' : 'Disable' },
    )
    if (!ok) return
    const res = await setCenterEnabled(center.id, enabling)
    if (!res.success) { showAlert(res.error); return }
    setCenters(prev => prev.map(c => c.id === center.id ? { ...c, is_active: enabling } : c))
  }

  const toggleJobs = async (center: { id: string; name: string; jobs_enabled?: boolean }) => {
    const enabling = !center.jobs_enabled
    if (!await showConfirm(enabling ? `Turn on job postings for ${center.name}?` : `Turn off job postings for ${center.name}? Existing postings stay as they are.`, { title: 'Hiring pilot', confirmLabel: enabling ? 'Turn on' : 'Turn off', tone: 'default' })) return
    const res = await setCenterJobsEnabled(center.id, enabling)
    if (!res.success) { showAlert(res.error); return }
    setCenters(prev => prev.map(c => c.id === center.id ? { ...c, jobs_enabled: enabling } : c))
  }

  const exportChecklist = async (center: { id: string; name: string }) => {
    const name = await showPrompt(`Template name for ${center.name}'s document requirements:`, `${center.name} checklist`, { title: 'Export as template' })
    if (!name?.trim()) return
    const description = (await showPrompt('Short description (optional):', '', { title: 'Export as template' })) ?? ''
    const res = await exportCenterRequirementsAsTemplate(center.id, name, description)
    showAlert(res.success ? `Saved "${name.trim()}" with ${res.count} requirements. Other centers can now import it from Document Requirements.` : res.error)
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 rounded-lg"></div>
        <div className="grid grid-cols-1 gap-4">
          {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-white rounded-2xl border border-slate-200"></div>)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2">Centers Management</h1>
          <p className="text-slate-500 font-medium">Provision centers, manage subscriptions, and oversee compliance.</p>
        </div>
        <div className="flex items-center gap-3">
           <div className="bg-white px-4 py-2.5 rounded-2xl border border-slate-200 flex items-center gap-2 group focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all">
              <Search className="w-5 h-5 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search centers..." 
                className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 w-64"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
           </div>
           <button className="p-2.5 bg-white border border-slate-200 rounded-2xl text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors shadow-sm">
             <Filter className="w-5 h-5" />
           </button>
        </div>
      </div>

      {/* Centers Table/List */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
         <div className="overflow-x-auto">
           <table className="w-full text-left border-collapse">
             <thead>
               <tr className="border-b border-slate-100 bg-slate-50/50">
                 <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Center Details</th>
                 <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Metro</th>
                 <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Location</th>
                 <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Subscription</th>
                 <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Free Trial</th>
                 <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                 <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Actions</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-slate-100">
               {filteredCenters.map((center) => {
                 const sub = center.subscriptions?.[0]
                 return (
                   <tr key={center.id} className="hover:bg-slate-50 transition-colors group">
                     <td className="px-8 py-6">
                       <div className="flex items-center gap-4">
                         <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200 shadow-sm transition-transform group-hover:scale-105">
                           {center.logo_url ? (
                             <img src={center.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover" />
                           ) : (
                             <Building2 className="w-6 h-6 text-slate-400" />
                           )}
                         </div>
                         <div>
                           <div className="font-extrabold text-slate-900 text-sm mb-0.5 tracking-tight group-hover:text-blue-600 transition-colors">
                             {center.name}
                           </div>
                           <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                             /{center.slug}
                           </div>
                         </div>
                       </div>
                     </td>
                     <td className="px-8 py-6">
                       <div className="flex items-center gap-2 text-slate-500 font-bold text-xs">
                         {center.metro_areas?.name || <span className="italic text-slate-300">Unassigned</span>}
                       </div>
                     </td>
                     <td className="px-8 py-6">
                       <div className="flex items-center gap-2 text-slate-500 font-bold text-xs mb-1">
                         <MapPin className="w-3 h-3" />
                         {center.city}, {center.state}
                       </div>
                       <div className="text-[10px] text-slate-400 font-semibold">{center.zip}</div>
                     </td>
                     <td className="px-8 py-6">
                       <div className="flex items-center gap-2 mb-1">
                          <CreditCard className="w-3.5 h-3.5 text-blue-500" />
                          <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                            {center.subscription_tier}
                          </span>
                       </div>
                       {sub?.current_period_end && (
                         <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Exp: {new Date(sub.current_period_end).toLocaleDateString()}
                         </div>
                       )}
                     </td>
                     <td className="px-8 py-6">
                       <select 
                         value={center.trial_months || 3} 
                         onChange={(e) => updateTrialMonths(center.id, parseInt(e.target.value))}
                         className="bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 px-2 py-1 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                       >
                         <option value={6}>6 Months</option>
                         <option value={3}>3 Months</option>
                         <option value={2}>2 Months</option>
                         <option value={1}>1 Month</option>
                       </select>
                     </td>
                     <td className="px-8 py-6">
                       <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${getStatusColor(sub?.status || 'inactive')}`}>
                         {sub?.status || 'No Sub'}
                       </span>
                       {center.is_active === false && (
                         <span className="ml-2 inline-flex items-center px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-rose-50 text-rose-600 border border-rose-100">Disabled</span>
                       )}
                     </td>
                     <td className="px-8 py-6 text-right">
                       <div className="flex items-center justify-end gap-2">
                         <button
                           onClick={() => toggleJobs(center)}
                           title="Job postings (hiring pilot)"
                           className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${center.jobs_enabled ? 'text-violet-700 border-violet-200 bg-violet-50 hover:bg-violet-100' : 'text-slate-500 border-slate-200 hover:text-violet-700 hover:border-violet-200'}`}
                         >
                           {center.jobs_enabled ? 'Jobs on' : 'Jobs off'}
                         </button>
                         <button
                           onClick={() => toggleEnabled(center)}
                           className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${center.is_active === false ? 'text-emerald-600 border-emerald-200 hover:bg-emerald-50' : 'text-slate-500 border-slate-200 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50'}`}
                         >
                           {center.is_active === false ? 'Enable' : 'Disable'}
                         </button>
                       </div>
                       <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity mt-1">
                         <button onClick={() => exportChecklist(center)} className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-xl transition-all" title="Export document requirements as a template">
                           <FileDown className="w-5 h-5" />
                         </button>
                         <button onClick={() => setPurging({ id: center.id, name: center.name })} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all" title="Delete center and all its data">
                           <Trash2 className="w-5 h-5" />
                         </button>
                         <button className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all" title="View Records">
                           <ExternalLink className="w-5 h-5" />
                         </button>
                         <button className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all">
                           <MoreHorizontal className="w-5 h-5" />
                         </button>
                         <Link 
                           href={`/center/dashboard?as=${center.id}`}
                           className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                           title="Masquerade"
                         >
                           <ChevronRight className="w-5 h-5" />
                         </Link>
                       </div>
                     </td>
                   </tr>
                 )
               })}
             </tbody>
           </table>
         </div>
         {filteredCenters.length === 0 && (
           <div className="p-20 text-center">
             <div className="w-20 h-20 bg-slate-50 rounded-[2rem] border border-slate-100 flex items-center justify-center mx-auto mb-6">
               <Building2 className="w-10 h-10 text-slate-200" />
             </div>
             <h3 className="text-xl font-black text-slate-900 tracking-tight mb-2">No centers found</h3>
             <p className="text-slate-500 font-medium max-w-xs mx-auto">Try adjusting your search filters or check your spelling.</p>
           </div>
         )}
      </div>

      {purging && (
        <PurgeDialog
          title="Delete center and all data"
          targetLabel={purging.name}
          confirmHint="Type the center name to confirm"
          consequences={[
            'The center, its profile, programs, team and subscription record',
            'All shifts, claims, time records, requests and support tickets',
            'Document requirements, compliance records, inspections, vendors and their uploaded files',
            "Staff links to this center (the staff members' own accounts and documents stay)",
          ]}
          option={{ label: "Also delete the center admins' sign-in accounts (skips anyone who is also staff or runs another center)", defaultChecked: false }}
          onClose={() => setPurging(null)}
          onConfirm={async ({ confirmName, password, option }) => {
            const res = await purgeCenter(purging.id, { confirmName, password, deleteAdminAccounts: option })
            if (res.success) setCenters(prev => prev.filter(c => c.id !== purging.id))
            return res
          }}
        />
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { TIER_LABELS, type SubscriptionTier } from '@/lib/types'
import { 
  Building2, 
  Search, 
  Filter, 
  MoreHorizontal, 
  LogIn,
  Power,
  Briefcase,
  ShieldCheck,
  CreditCard,
  MapPin,
  Calendar,
  FileDown,
  Trash2,
  Settings2,
  Plus
} from 'lucide-react'
import Link from 'next/link'
import { exportCenterRequirementsAsTemplate } from '@/app/actions/requirement-templates.actions'
import { setCenterEnabled } from '@/app/actions/account-status.actions'
import { setCenterJobLimit, setCenterJobsEnabled } from '@/app/actions/jobs.actions'
import { setCenterChildFilesEnabled, setCenterRosterEnabled } from '@/app/actions/child-files-admin.actions'
import { purgeCenter } from '@/app/actions/data-cleanup.actions'
import { setCenterMenuPlanningEnabled, setCenterCacfpEnabled, setCenterLessonPlansEnabled, setCenterParentPortalEnabled, setCenterAnnouncementsEnabled, setCenterScheduleEnabled, setCenterScheduleSlot } from '@/app/actions/center-modules.actions'
import { CenterDetailsDialog, moduleSummary } from '@/components/admin/CenterDetailsDialog'
import { PurgeDialog } from '@/components/admin/PurgeDialog'
import { NewCenterDialog } from '@/components/admin/CenterOwners'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'

export default function AdminCentersPage() {
  const supabase = createClient()
  const [centers, setCenters] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [purging, setPurging] = useState<{ id: string; name: string } | null>(null)
  // Center whose details pop-up is open; looked up in `centers` so its switches update in place
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [metros, setMetros] = useState<{ id: string; name: string }[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const detailsCenter = detailsId ? centers.find(c => c.id === detailsId) ?? null : null
  // The row menu is drawn at a fixed spot under its button so the table's scroll area cannot clip it
  const [menu, setMenu] = useState<{ center: { id: string; name: string; is_active?: boolean; job_limit_override?: number | null }; top: number; right: number } | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

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
  }, [reloadKey])

  // Metro areas for the New center form, loaded when it opens
  useEffect(() => {
    if (!creating || metros.length) return
    supabase.from('metro_areas').select('id, name').order('name')
      .then(({ data }) => setMetros((data ?? []) as { id: string; name: string }[]))
  }, [creating])

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

  /** The override as people type and read it: blank = plan default, "unlimited", or a number */
  const describeJobLimit = (value: number | null | undefined) => value == null ? '' : value === -1 ? 'unlimited' : String(value)

  const changeJobLimit = async (center: { id: string; name: string; job_limit_override?: number | null }) => {
    const answer = await showPrompt(
      `How many active jobs may ${center.name} have at once? Enter a number, "unlimited", or leave blank to follow the plan (trial 1, Starter 2, Growth 5, Network unlimited).`,
      describeJobLimit(center.job_limit_override),
      { title: 'Job limit' },
    )
    if (answer === null || answer === undefined) return
    const text = answer.trim().toLowerCase()
    const limit = text === '' ? null : text === 'unlimited' ? -1 : Number(text)
    if (limit !== null && !Number.isInteger(limit)) { showAlert('Enter a whole number, "unlimited", or leave it blank.'); return }
    const res = await setCenterJobLimit(center.id, limit)
    if (!res.success) { showAlert(res.error); return }
    setCenters(prev => prev.map(c => c.id === center.id ? { ...c, job_limit_override: limit } : c))
  }

  const toggleChildFiles = async (center: { id: string; name: string; child_files_enabled?: boolean }) => {
    const enabling = !center.child_files_enabled
    if (!await showConfirm(
      enabling
        ? `Turn on Child Files for ${center.name}? Its owner and administrators will be able to store children\u2019s records. Only do this once the child records data addendum is accepted.`
        : `Turn off Child Files for ${center.name}? Nobody at the center can open child records until it is turned on again. Nothing is deleted.`,
      { title: 'Child Files pilot', confirmLabel: enabling ? 'Turn on' : 'Turn off', tone: 'default' },
    )) return
    const res = await setCenterChildFilesEnabled(center.id, enabling)
    if (!res.success) { showAlert(res.error); return }
    setCenters(prev => prev.map(c => c.id === center.id ? { ...c, child_files_enabled: enabling } : c))
  }

  const toggleRoster = async (center: { id: string; name: string; roster_enabled?: boolean }) => {
    const enabling = !center.roster_enabled
    if (!await showConfirm(
      enabling
        ? `Turn on the live roster for ${center.name}? Its owner, administrators and regular teachers will see where every child and teacher is, and can check children in and out.`
        : `Turn off the live roster for ${center.name}? The roster page closes for everyone at the center. Today's check-ins and the history are kept.`,
      { title: 'Live roster pilot', confirmLabel: enabling ? 'Turn on' : 'Turn off', tone: 'default' },
    )) return
    const res = await setCenterRosterEnabled(center.id, enabling)
    if (!res.success) { showAlert(res.error); return }
    setCenters(prev => prev.map(c => c.id === center.id ? { ...c, roster_enabled: enabling } : c))
  }

  const toggleMenu = async (center: { id: string; name: string; menu_planning_enabled?: boolean; cacfp_enabled?: boolean }) => {
    const enabling = !center.menu_planning_enabled
    if (!await showConfirm(
      enabling
        ? `Turn on menu planning for ${center.name}? Its owner, administrators and staff marked as menu editors can plan the monthly menu, and regular staff can see published months.`
        : `Turn off menu planning for ${center.name}? Menus close for everyone at the center${center.cacfp_enabled ? ' and CACFP tracking turns off too' : ''}. Nothing is deleted.`,
      { title: 'Menu planning', confirmLabel: enabling ? 'Turn on' : 'Turn off', tone: 'default' },
    )) return
    const res = await setCenterMenuPlanningEnabled(center.id, enabling)
    if (!res.success) { showAlert(res.error); return }
    setCenters(prev => prev.map(c => c.id === center.id ? { ...c, menu_planning_enabled: enabling, cacfp_enabled: enabling ? c.cacfp_enabled : false } : c))
  }

  const toggleCacfp = async (center: { id: string; name: string; menu_planning_enabled?: boolean; cacfp_enabled?: boolean }) => {
    const enabling = !center.cacfp_enabled
    if (!await showConfirm(
      enabling
        ? `Turn on CACFP tracking for ${center.name}? Menus will show whether each meal meets the CACFP meal pattern, and the monthly CACFP report opens.`
        : `Turn off CACFP tracking for ${center.name}? Menus stay; the component checks and report are hidden.`,
      { title: 'CACFP tracking', confirmLabel: enabling ? 'Turn on' : 'Turn off', tone: 'default' },
    )) return
    const res = await setCenterCacfpEnabled(center.id, enabling)
    if (!res.success) { showAlert(res.error); return }
    setCenters(prev => prev.map(c => c.id === center.id ? { ...c, cacfp_enabled: enabling } : c))
  }

  const toggleLessonPlans = async (center: { id: string; name: string; lesson_plans_enabled?: boolean }) => {
    const enabling = center.lesson_plans_enabled === false
    if (!await showConfirm(
      enabling
        ? `Turn on Lesson Plans for ${center.name}? Its admins and regular teachers can build and approve weekly lesson plans again.`
        : `Turn off Lesson Plans for ${center.name}? Lesson Plans closes for everyone at the center. Plans and goals are kept.`,
      { title: 'Lesson Plans', confirmLabel: enabling ? 'Turn on' : 'Turn off', tone: 'default' },
    )) return
    const res = await setCenterLessonPlansEnabled(center.id, enabling)
    if (!res.success) { showAlert(res.error); return }
    setCenters(prev => prev.map(c => c.id === center.id ? { ...c, lesson_plans_enabled: enabling } : c))
  }

  const toggleParentPortal = async (center: { id: string; name: string; parent_portal_enabled?: boolean }) => {
    const enabling = !center.parent_portal_enabled
    if (!await showConfirm(
      enabling
        ? `Turn on the parent page for ${center.name}? Its owner and administrators can give parents 6-digit PINs to see daily activities and photos and message teachers.`
        : `Turn off the parent page for ${center.name}? Every parent is signed out right away. Access codes are kept for when it is turned back on.`,
      { title: 'Parent page', confirmLabel: enabling ? 'Turn on' : 'Turn off', tone: 'default' },
    )) return
    const res = await setCenterParentPortalEnabled(center.id, enabling)
    if (!res.success) { showAlert(res.error); return }
    setCenters(prev => prev.map(c => c.id === center.id ? { ...c, parent_portal_enabled: enabling } : c))
  }

  const toggleAnnouncements = async (center: { id: string; name: string; announcements_enabled?: boolean }) => {
    const enabling = !center.announcements_enabled
    if (!await showConfirm(
      enabling
        ? `Turn on Announcements for ${center.name}? Its owner and administrators can email one note to parents of the whole center or chosen classes, and to staff.`
        : `Turn off Announcements for ${center.name}? Anything still sending stops and links in sent emails close. Past announcements are kept.`,
      { title: 'Announcements', confirmLabel: enabling ? 'Turn on' : 'Turn off', tone: 'default' },
    )) return
    const res = await setCenterAnnouncementsEnabled(center.id, enabling)
    if (!res.success) { showAlert(res.error); return }
    setCenters(prev => prev.map(c => c.id === center.id ? { ...c, announcements_enabled: enabling } : c))
  }

  const toggleSchedule = async (center: { id: string; name: string; schedule_enabled?: boolean }) => {
    const enabling = !center.schedule_enabled
    if (!await showConfirm(
      enabling
        ? `Turn on the staff schedule for ${center.name}? Its owner and administrators can set fixed weekly schedules for regular staff and plan each day by room. Teachers see the schedule read-only.`
        : `Turn off the staff schedule for ${center.name}? The schedule is hidden for everyone at the center. Saved schedules are kept for when it is turned back on.`,
      { title: 'Staff schedule', confirmLabel: enabling ? 'Turn on' : 'Turn off', tone: 'default' },
    )) return
    const res = await setCenterScheduleEnabled(center.id, enabling)
    if (!res.success) { showAlert(res.error); return }
    setCenters(prev => prev.map(c => c.id === center.id ? { ...c, schedule_enabled: enabling } : c))
  }

  /** Flips the board's drag snap between 15 and 30 minutes */
  const changeScheduleSlot = async (center: { id: string; name: string; schedule_slot_minutes?: number }) => {
    const next = center.schedule_slot_minutes === 30 ? 15 : 30
    if (!await showConfirm(
      `Snap ${center.name}'s schedule board to ${next} minutes? Drags and time pickers move in ${next}-minute steps. Saved times stay as they are.`,
      { title: 'Schedule snap', confirmLabel: `Use ${next} min`, tone: 'default' },
    )) return
    const res = await setCenterScheduleSlot(center.id, next)
    if (!res.success) { showAlert(res.error); return }
    setCenters(prev => prev.map(c => c.id === center.id ? { ...c, schedule_slot_minutes: next } : c))
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
           <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-slate-800 shadow-sm">
             <Plus className="w-4 h-4" /> New center
           </button>
        </div>
      </div>

      {/* Centers Table/List */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
         <div className="overflow-x-auto">
           <table className="w-full text-left border-collapse">
             <thead>
               <tr className="border-b border-slate-100 bg-slate-50/50">
                 <th className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Center Details</th>
                 <th className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Location · Metro</th>
                 <th className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Subscription</th>
                 <th className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Free Trial</th>
                 <th className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                 <th className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Actions</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-slate-100">
               {filteredCenters.map((center) => {
                 const sub = center.subscriptions?.[0]
                 return (
                   <tr key={center.id} className="hover:bg-slate-50 transition-colors group">
                     <td className="px-4 py-4">
                       <div className="flex items-center gap-4">
                         <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200 shadow-sm transition-transform group-hover:scale-105">
                           {center.logo_url ? (
                             <img src={center.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover" />
                           ) : (
                             <Building2 className="w-6 h-6 text-slate-400" />
                           )}
                         </div>
                         <div>
                           <button onClick={() => setDetailsId(center.id)} className="block text-left font-extrabold text-slate-900 text-sm mb-0.5 tracking-tight group-hover:text-blue-600 hover:underline transition-colors">
                             {center.name}
                           </button>
                           <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                             /{center.slug}
                           </div>
                         </div>
                       </div>
                     </td>
                     <td className="px-4 py-4">
                       <div className="flex items-center gap-2 text-slate-500 font-bold text-xs mb-1">
                         <MapPin className="w-3 h-3" />
                         {center.city}, {center.state}
                       </div>
                       <div className="text-[10px] text-slate-400 font-semibold">{center.zip} · {center.metro_areas?.name || <span className="italic text-slate-300">No metro</span>}</div>
                     </td>
                     <td className="px-4 py-4">
                       <div className="flex items-center gap-2 mb-1">
                          <CreditCard className="w-3.5 h-3.5 text-blue-500" />
                          <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                            {TIER_LABELS[center.subscription_tier as SubscriptionTier] ?? center.subscription_tier}
                          </span>
                       </div>
                       {sub?.current_period_end && (
                         <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Exp: {new Date(sub.current_period_end).toLocaleDateString()}
                         </div>
                       )}
                     </td>
                     <td className="px-4 py-4">
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
                     <td className="px-4 py-4">
                       <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${getStatusColor(sub?.status || 'inactive')}`}>
                         {sub?.status || 'No Sub'}
                       </span>
                       {center.is_active === false && (
                         <span className="ml-2 inline-flex items-center px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-rose-50 text-rose-600 border border-rose-100">Disabled</span>
                       )}
                     </td>
                     <td className="px-4 py-4">
                       <div className="flex items-center justify-end gap-1.5">
                         {moduleSummary(center).length > 0 && (
                           <span className="hidden 2xl:inline text-[10px] font-bold text-slate-400 mr-1" title="Modules on">
                             {moduleSummary(center).join(' · ')}
                           </span>
                         )}
                         <button
                           onClick={() => setDetailsId(center.id)}
                           title="Center details and modules"
                           className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest border border-slate-200 text-slate-600 hover:text-blue-700 hover:border-blue-200 hover:bg-blue-50 transition-all"
                         >
                           <Settings2 className="w-3.5 h-3.5" /> Manage
                           <span className="ml-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 normal-case tracking-normal">{moduleSummary(center).length}</span>
                         </button>
                         <button
                           aria-haspopup="menu"
                           aria-expanded={menu?.center.id === center.id}
                           aria-label={`More actions for ${center.name}`}
                           onClick={(e) => {
                             if (menu?.center.id === center.id) { setMenu(null); return }
                             const r = e.currentTarget.getBoundingClientRect()
                             setMenu({ center, top: r.bottom + 4, right: window.innerWidth - r.right })
                           }}
                           className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                         >
                           <MoreHorizontal className="w-5 h-5" />
                         </button>
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

      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div role="menu" style={{ top: menu.top, right: menu.right }} className="fixed z-50 w-60 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
            <Link role="menuitem" href={`/center/dashboard?as=${menu.center.id}`} onClick={() => setMenu(null)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700">
              <LogIn className="w-4 h-4" /> Open as center admin
            </Link>
            <button role="menuitem" onClick={() => { const c = menu.center; setMenu(null); exportChecklist(c) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-violet-50 hover:text-violet-700">
              <FileDown className="w-4 h-4" /> Export requirements template
            </button>
            <button role="menuitem" onClick={() => { const c = menu.center; setMenu(null); changeJobLimit(c) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-violet-50 hover:text-violet-700">
              <Briefcase className="w-4 h-4" /> Job limit…{menu.center.job_limit_override != null && <span className="ml-auto text-xs font-semibold text-slate-400">{describeJobLimit(menu.center.job_limit_override)}</span>}
            </button>
            <button role="menuitem" onClick={() => { const c = menu.center; setMenu(null); toggleEnabled(c) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100">
              <Power className="w-4 h-4" /> {menu.center.is_active === false ? 'Enable center' : 'Disable center'}
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button role="menuitem" onClick={() => { const c = menu.center; setMenu(null); setPurging({ id: c.id, name: c.name }) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50">
              <Trash2 className="w-4 h-4" /> Delete center and data…
            </button>
          </div>
        </>,
        document.body,
      )}

      {detailsCenter && (
        <CenterDetailsDialog
          center={detailsCenter}
          onClose={() => setDetailsId(null)}
          statusLabel={detailsCenter.subscriptions?.[0]?.status || 'No subscription'}
          jobLimitLabel={describeJobLimit(detailsCenter.job_limit_override)}
          actions={{ toggleJobs, changeJobLimit, toggleChildFiles, toggleRoster, toggleLessonPlans, toggleMenu, toggleCacfp, toggleParentPortal, toggleAnnouncements, toggleSchedule, changeScheduleSlot }}
        />
      )}

      {creating && (
        <NewCenterDialog
          metros={metros}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); setReloadKey(k => k + 1); setDetailsId(id) }}
        />
      )}

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

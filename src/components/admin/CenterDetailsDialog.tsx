'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  X, Building2, MapPin, Phone, Mail, User, ShieldCheck, CreditCard, Calendar, Users, LogIn,
  Briefcase, Baby, LayoutGrid, NotebookPen, Utensils, ClipboardList, KeyRound,
} from 'lucide-react'
import { TIER_LABELS, type SubscriptionTier } from '@/lib/types'

/** The center row as the super admin centers page loads it (centers.* plus joins) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminCenter = Record<string, any> & { id: string; name: string }

type Toggle = (center: AdminCenter) => void | Promise<void>

export interface CenterModuleActions {
  toggleJobs: Toggle
  changeJobLimit: Toggle
  toggleChildFiles: Toggle
  toggleRoster: Toggle
  toggleLessonPlans: Toggle
  toggleMenu: Toggle
  toggleCacfp: Toggle
  toggleParentPortal: Toggle
}

interface ModuleRow {
  key: string
  label: string
  description: string
  icon: typeof Briefcase
  on: boolean
  toggle: Toggle
  /** Shown instead of the switch when a module it builds on is off */
  needs?: string
  /** Rides on the module above it */
  sub?: boolean
  extra?: { label: string; value?: string; onClick: Toggle }
}

/**
 * Super admin: one center's details and every module switch in a single place. New modules only need a row in
 * `modules` below, so the centers table never has to grow another column of buttons.
 */
export function CenterDetailsDialog({ center, onClose, actions, statusLabel, jobLimitLabel }: {
  center: AdminCenter
  onClose: () => void
  actions: CenterModuleActions
  statusLabel: string
  jobLimitLabel: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const childcare = (center.domain_key ?? 'childcare') === 'childcare'
  const modules: ModuleRow[] = [
    {
      key: 'jobs', label: 'Jobs', icon: Briefcase, on: !!center.jobs_enabled, toggle: actions.toggleJobs,
      description: 'Post regular full- and part-time jobs and take applications.',
      extra: { label: 'Job limit', value: jobLimitLabel, onClick: actions.changeJobLimit },
    },
    ...(childcare ? [
      {
        key: 'child_files', label: 'Children', icon: Baby, on: !!center.child_files_enabled, toggle: actions.toggleChildFiles,
        description: 'Children’s files and incident records. Only after the child records data addendum is accepted.',
      },
      {
        key: 'roster', label: 'Live roster', icon: LayoutGrid, on: !!center.roster_enabled, toggle: actions.toggleRoster,
        description: 'Rooms, ratios and check-in/out for every child and teacher.',
        needs: !center.child_files_enabled && !center.roster_enabled ? 'Turn on Children first' : undefined,
      },
      {
        key: 'lesson_plans', label: 'Lesson Plans', icon: NotebookPen, on: center.lesson_plans_enabled !== false, toggle: actions.toggleLessonPlans,
        description: 'Weekly lesson plans per class, approved by a center admin.',
      },
      {
        key: 'menu', label: 'Menu planning', icon: Utensils, on: !!center.menu_planning_enabled, toggle: actions.toggleMenu,
        description: 'Monthly meal calendar built from presets; the cook can edit.',
      },
      {
        key: 'cacfp', label: 'CACFP tracking', icon: ClipboardList, on: !!center.cacfp_enabled, toggle: actions.toggleCacfp, sub: true,
        description: 'Meal-pattern checks on the menu and the monthly CACFP report.',
        needs: !center.menu_planning_enabled ? 'Turn on Menu planning first' : undefined,
      },
      {
        key: 'parent_portal', label: 'Parent page', icon: KeyRound, on: !!center.parent_portal_enabled, toggle: actions.toggleParentPortal,
        description: 'Parents see daily activities and photos and message teachers on the center’s link, with a 6-digit PIN.',
        needs: !center.roster_enabled && !center.parent_portal_enabled ? 'Turn on Live roster first' : undefined,
      },
    ] : []),
  ]
  const onCount = modules.filter(m => m.on).length

  const location = [center.address, [center.city, center.state].filter(Boolean).join(', '), center.zip].filter(Boolean).join(' · ')
  const sub = center.subscriptions?.[0]
  const details: { icon: typeof MapPin; label: string; value: React.ReactNode }[] = [
    { icon: MapPin, label: 'Location', value: <>{location || '—'}{center.metro_areas?.name ? <span className="text-slate-400"> · {center.metro_areas.name}</span> : null}</> },
    { icon: User, label: 'Director', value: center.director_name || '—' },
    { icon: Phone, label: 'Phone', value: center.phone || '—' },
    { icon: Mail, label: 'Email', value: center.email || '—' },
    { icon: ShieldCheck, label: 'License', value: center.license_number || '—' },
    { icon: Users, label: 'Capacity', value: center.max_capacity ?? '—' },
    {
      icon: CreditCard, label: 'Plan',
      value: <>{TIER_LABELS[center.subscription_tier as SubscriptionTier] ?? center.subscription_tier} · {statusLabel}{sub?.current_period_end ? <span className="text-slate-400"> · renews {new Date(sub.current_period_end).toLocaleDateString()}</span> : null}</>,
    },
    { icon: Calendar, label: 'Joined', value: center.created_at ? new Date(center.created_at).toLocaleDateString() : '—' },
  ]

  return createPortal(
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="center-details-title"
        className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-4 p-6 border-b border-slate-100">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200">
            {center.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={center.logo_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
              : <Building2 className="w-7 h-7 text-slate-400" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="center-details-title" className="text-xl font-black text-slate-900 tracking-tight truncate">{center.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest">
              <span className="text-slate-400">/{center.slug}</span>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{center.domain_key ?? 'childcare'}</span>
              {center.is_active === false && <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-100">Disabled</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto p-6 space-y-6">
          {/* Details */}
          <section>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Details</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {details.map(d => (
                <div key={d.label} className="flex items-start gap-2.5 min-w-0">
                  <d.icon className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{d.label}</dt>
                    <dd className="text-sm font-semibold text-slate-800 break-words">{d.value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </section>

          {/* Modules */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Modules</h3>
              <span className="text-xs font-bold text-slate-500">{onCount} of {modules.length} on</span>
            </div>
            <ul className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
              {modules.map(m => (
                <li key={m.key} className={`flex items-center gap-3 px-4 py-3 ${m.sub ? 'pl-10 bg-slate-50/60' : ''}`}>
                  <m.icon className={`w-5 h-5 shrink-0 ${m.on ? 'text-blue-600' : 'text-slate-300'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-900">{m.label}</div>
                    <div className="text-xs text-slate-500">{m.description}</div>
                    {m.extra && m.on && (
                      <button onClick={() => m.extra!.onClick(center)} className="mt-1 text-xs font-bold text-blue-600 hover:underline">
                        {m.extra.label}: {m.extra.value || 'plan default'}
                      </button>
                    )}
                  </div>
                  {m.needs ? (
                    <span className="text-[11px] font-semibold text-slate-400 text-right max-w-32">{m.needs}</span>
                  ) : (
                    <button role="switch" aria-checked={m.on} aria-label={m.label} onClick={() => m.toggle(center)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 ${m.on ? 'bg-blue-600' : 'bg-slate-200'}`}>
                      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${m.on ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <Link href={`/center/dashboard?as=${center.id}`} className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700 hover:underline">
            <LogIn className="w-4 h-4" /> Open as center admin
          </Link>
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800">Done</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Short summary of which modules a center has on, for the table row */
export function moduleSummary(center: AdminCenter): string[] {
  const childcare = (center.domain_key ?? 'childcare') === 'childcare'
  return [
    center.jobs_enabled && 'Jobs',
    childcare && center.child_files_enabled && 'Children',
    childcare && center.roster_enabled && 'Roster',
    childcare && center.lesson_plans_enabled !== false && 'Lessons',
    childcare && center.menu_planning_enabled && 'Menu',
    childcare && center.cacfp_enabled && 'CACFP',
    childcare && center.parent_portal_enabled && 'Parents',
  ].filter((x): x is string => typeof x === 'string')
}


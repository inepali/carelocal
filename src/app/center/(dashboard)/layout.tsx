'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LogOut, LayoutDashboard, Users, UserPlus, Info, Calendar, Tags, LifeBuoy, ClipboardCheck, Truck, Baby, Building2, UserCircle, Inbox, ShieldCheck, Briefcase, CalendarCheck, LayoutGrid, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { CenterContext, canOpenChildFiles, canOpenRoster } from './context'
import type { DomainKey } from '@/lib/domain-config'

// Dev/demo tool: jumps the browser to another vertical's domain (it does not change the
// center's vertical). Off unless NEXT_PUBLIC_SHOW_VERTICAL_SWITCHER=true.
const SHOW_VERTICAL_SWITCHER = process.env.NEXT_PUBLIC_SHOW_VERTICAL_SWITCHER === 'true'

const NAV_COLLAPSED_KEY = 'carelocal.center.navCollapsed'

const VERTICALS: { key: DomainKey; label: string; Icon?: typeof Baby }[] = [
  { key: 'childcare', label: 'Child Care', Icon: Baby },
  { key: 'senior', label: 'Senior' },
  { key: 'healthcare', label: 'Hospital', Icon: Building2 },
]

export default function CenterDashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [centerName, setCenterName] = useState('Loading...')
  const [staffTerm, setStaffTerm] = useState('Staffs')
  const [workAreaTerm, setWorkAreaTerm] = useState('Classrooms')
  const [domainKey, setDomainKey] = useState<DomainKey>('childcare')
  const [hasStaffProfile, setHasStaffProfile] = useState(false)
  const [jobsEnabled, setJobsEnabled] = useState(false)
  const [centerId, setCenterId] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [childFilesEnabled, setChildFilesEnabled] = useState(false)
  const [rosterEnabled, setRosterEnabled] = useState(false)
  // Narrow icon-only sidebar; remembered in this browser
  const [collapsed, setCollapsed] = useState(false)

  function toggleCollapsed() {
    setCollapsed(c => {
      try { window.localStorage.setItem(NAV_COLLAPSED_KEY, c ? '0' : '1') } catch { /* storage blocked */ }
      return !c
    })
  }

  useEffect(() => {
    async function loadCenter() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return router.push('/login')

      const { data } = await supabase
        .from('center_admins')
        .select(`
          role,
          center_id,
          centers (
            name,
            staff_term,
            work_area_term,
            domain_key,
            jobs_enabled,
            child_files_enabled,
            roster_enabled
          )
        `)
        .eq('user_id', user.id)
        .single()

      if (data) {
        setRole((data as { role?: string }).role ?? null)
        setCenterId((data as { center_id?: string }).center_id ?? null)
      }

      if (data && data.centers) {
        // @ts-ignore - Supabase type inference limitation with joins
        setCenterName(data.centers.name)
        // @ts-ignore
        if (data.centers.staff_term) setStaffTerm(data.centers.staff_term)
        // @ts-ignore
        if (data.centers.work_area_term) setWorkAreaTerm(data.centers.work_area_term)
        // @ts-ignore
        if (data.centers.domain_key) setDomainKey(data.centers.domain_key)
        // @ts-ignore
        setJobsEnabled(!!data.centers.jobs_enabled)
        // @ts-ignore
        setChildFilesEnabled(!!data.centers.child_files_enabled)
        // @ts-ignore
        setRosterEnabled(!!data.centers.roster_enabled)
      }

      // Admins who are also employees can switch to their own staff portal
      const { data: ownProfile } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
      setHasStaffProfile(!!ownProfile)
      try { setCollapsed(window.localStorage.getItem(NAV_COLLAPSED_KEY) === '1') } catch { /* storage blocked */ }
      setLoading(false)
    }

    loadCenter()
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  function switchVertical(target: DomainKey) {
    const currentUrl = new URL(window.location.href)
    const isLocal = currentUrl.hostname === 'localhost' || currentUrl.hostname === '127.0.0.1'
    const targetHost = target === 'healthcare' ? 'carelocal.net' : target === 'senior' ? 'carelocalsenior.com' : 'carelocal.co'
    const targetOrigin = isLocal
      ? `${currentUrl.protocol}//${currentUrl.hostname}:${target === 'healthcare' ? '3001' : target === 'senior' ? '3002' : '3000'}`
      : `${currentUrl.protocol}//${targetHost}`

    window.location.assign(`${targetOrigin}${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`)
  }

  const NAVIGATION = [
    { name: 'Dashboard', href: '/center/dashboard', icon: LayoutDashboard },
    { name: 'Shifts', href: '/center/shifts', icon: Calendar },
    { name: staffTerm, href: '/center/team_member', icon: Users },
    ...(canOpenRoster({ domainKey, role, childFilesEnabled, rosterEnabled }) ? [{ name: 'Live roster', href: '/center/roster', icon: LayoutGrid }] : []),
    ...(canOpenChildFiles({ domainKey, role, childFilesEnabled }) ? [{ name: 'Children', href: '/center/children', icon: Baby }] : []),
    ...(jobsEnabled ? [{ name: 'Jobs', href: '/center/jobs', icon: Briefcase }] : []),
    { name: 'Requests', href: '/center/requests', icon: Inbox },
    { name: 'Tours', href: '/center/tours', icon: CalendarCheck },
    { name: 'Compliance', href: '/center/compliance', icon: ShieldCheck },
    { name: 'Inspections', href: '/center/inspections', icon: ClipboardCheck },
    // Receipts has no menu item of its own: it opens from a vendor's receipts link
    { name: 'Vendors', href: '/center/vendors', icon: Truck, also: ['/center/receipts'] },
    { name: 'Support', href: '/center/support', icon: LifeBuoy },
    { name: 'About', href: '/center/about', icon: Info },
  ]

  if (loading) {
     return <div className="min-h-screen bg-surface flex items-center justify-center">Loading...</div>
  }

  return (
    <CenterContext.Provider value={{ staffTerm, workAreaTerm, domainKey, centerId, role, childFilesEnabled, rosterEnabled }}>
      <div className="center-shell min-h-screen bg-surface flex font-sans">
      {/* ── Sidebar ── */}
      <aside className={`${collapsed ? 'w-16' : 'w-64'} bg-brand-900 text-white flex flex-col fixed inset-y-0 z-10 transition-[width] duration-200`}>
        <div className={`h-20 flex items-center border-b border-white/10 shrink-0 ${collapsed ? 'justify-center px-0' : 'px-6'}`}>
          <Link href="/center/dashboard" className="flex items-center gap-2">
            {domainKey === 'childcare' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/logo.png" alt="CareLocal" width={64} height={64} className={`${collapsed ? 'h-10 w-10' : 'h-16 w-16'} rounded-xl object-contain bg-white`} />
            ) : (
              <div className="w-7 h-7 rounded-md bg-brand-600 flex items-center justify-center">
                <span className="text-white font-bold text-xs">{domainKey === 'healthcare' ? 'CLH' : 'CLS'}</span>
              </div>
            )}
            {!collapsed && (
              <span className="font-semibold text-lg tracking-tight truncate">
                {domainKey === 'healthcare' ? 'CareLocal Health' : domainKey === 'senior' ? 'CareLocal Senior' : ''}
              </span>
            )}
          </Link>
        </div>

        {SHOW_VERTICAL_SWITCHER && !collapsed && (
          <div className="px-4 py-4 border-b border-white/10 shrink-0">
            <div className="text-[10px] text-brand-300 uppercase tracking-wider font-semibold mb-2">Switch vertical</div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-black/10 p-1">
              {VERTICALS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => switchVertical(key)}
                  disabled={domainKey === key}
                  aria-pressed={domainKey === key}
                  className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${
                    domainKey === key
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-brand-200 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          {NAVIGATION.map((item) => {
            const isActive = pathname === item.href || ('also' in item && item.also?.includes(pathname))
            return (
              <Link
                key={item.name}
                href={item.href}
                title={collapsed ? item.name : undefined}
                aria-label={collapsed ? item.name : undefined}
                className={`flex items-center gap-3 py-2.5 rounded-lg text-sm transition-colors ${collapsed ? 'justify-center px-0' : 'px-3'} ${
                  isActive
                    ? 'bg-brand-600 text-white font-medium'
                    : 'text-brand-100 hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-brand-300' : 'text-brand-200'}`} />
                {!collapsed && item.name}
              </Link>
            )
          })}
        </nav>

      </aside>

      {/* ── Main Content ── */}
      <main className={`flex-1 ${collapsed ? 'ml-16' : 'ml-64'} min-w-0 flex flex-col min-h-screen overflow-x-hidden transition-[margin] duration-200`}>
        <header className="h-20 glass border-b border-border flex items-center justify-between gap-4 px-8 sticky top-0 z-10">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
              title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
              className="shrink-0 rounded-lg p-2 text-muted transition-colors hover:bg-brand-50 hover:text-brand-600"
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </button>
            <div className="min-w-0">
              <div className="text-xs text-muted uppercase tracking-wider font-semibold">
                {domainKey === 'healthcare' ? 'Facility' : domainKey === 'senior' ? 'Care Organization' : 'Center'}
              </div>
              <div className="truncate text-lg font-bold text-heading">{centerName}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {hasStaffProfile && (
              <Link
                href="/staff/documents"
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-brand-50 hover:text-brand-600"
              >
                <UserCircle className="h-4 w-4" />
                My staff portal
              </Link>
            )}
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-muted transition-colors hover:border-brand-600 hover:text-brand-600"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </header>
        <div className={`${pathname === '/center/roster' ? 'p-4' : 'p-8'} flex-1`}>
          {children}
        </div>
      </main>
    </div>
    </CenterContext.Provider>
  )
}

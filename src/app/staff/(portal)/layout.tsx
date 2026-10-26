'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LogOut, Calendar, FileText, UserCircle, Globe, Search, CreditCard, Building, LayoutDashboard, Inbox, Briefcase, ClipboardList } from 'lucide-react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useIsRegularOnly, isSubstituteOnlyRoute, isRegularOnlyRoute } from '@/lib/hooks/useIsRegularOnly'
import { getDomainKey } from '@/lib/domain-config'
import { GettingStartedBanner } from '@/components/staff/GettingStarted'

export default function StaffPortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const [userName, setUserName] = useState('Loading...')
  const [isCenterAdmin, setIsCenterAdmin] = useState(false)
  const [openRequestCount, setOpenRequestCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [isChildcare, setIsChildcare] = useState(true)
  const { isRegularOnly, loading: classLoading } = useIsRegularOnly()

  // Regular employees get a single-center portal without the shift marketplace;
  // substitutes keep the multi-center portal
  const homeHref = isRegularOnly ? '/staff/center' : '/staff/shifts'
  const blockedRoute = isRegularOnly ? isSubstituteOnlyRoute(pathname) : isRegularOnlyRoute(pathname)
  useEffect(() => {
    if (!classLoading && blockedRoute) router.replace(isRegularOnly ? '/staff/center' : '/staff/centers')
  }, [classLoading, blockedRoute, isRegularOnly, router])

  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return router.push('/login')

      const { data, error } = await supabase
        .from('staff_profiles')
        .select('id, first_name, last_name')
        .eq('user_id', user.id)
      
      if (data && data.length > 0) {
        setUserName(`${data[0].first_name} ${data[0].last_name}`)
        const { count } = await supabase.from('document_requests').select('id', { count: 'exact', head: true })
          .eq('staff_id', data[0].id).eq('status', 'open')
        setOpenRequestCount(count ?? 0)
      } else {
        setUserName(user.email?.split('@')[0] || 'Educator')
      }

      // Employees who are also center admins can switch back to the center dashboard
      const { data: adminRow } = await supabase.from('center_admins').select('center_id').eq('user_id', user.id).limit(1).maybeSingle()
      setIsCenterAdmin(!!adminRow)
      setLoading(false)
    }

    loadUser()
    setIsChildcare(getDomainKey(window.location.host) === 'childcare')
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  const NAVIGATION = [
    { name: 'My Center', href: '/staff/center', icon: Building },
    { name: 'My Centers', href: '/staff/centers', icon: Globe },
    { name: 'Available Shifts', href: '/staff/shifts', icon: Search },
    { name: 'My Shifts', href: '/staff/my-shifts', icon: Calendar },
    { name: 'Jobs', href: '/staff/jobs', icon: Briefcase },
    { name: 'Applications', href: '/staff/applications', icon: ClipboardList },
    { name: 'My Documents', href: '/staff/documents', icon: FileText },
    { name: 'Requests', href: '/staff/requests', icon: Inbox },
    { name: 'My Profile', href: '/staff/profile', icon: UserCircle },
    { name: 'My Account', href: '/staff/account', icon: CreditCard },
  ].filter(item => isRegularOnly ? !isSubstituteOnlyRoute(item.href) : !isRegularOnlyRoute(item.href))

  if (loading || classLoading || blockedRoute) {
     return <div className="min-h-screen bg-surface flex items-center justify-center">Loading...</div>
  }

  return (
    <div className="staff-shell min-h-screen bg-surface flex font-sans">
      {/* ── Sidebar (desktop) ── */}
      <aside className="w-64 bg-brand-900 text-white hidden md:flex flex-col fixed inset-y-0 z-10">
        <div className="h-20 flex items-center px-6 border-b border-white/10 shrink-0">
          <Link href={homeHref} className="flex items-center gap-2">
            {isChildcare ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/logo.png" alt="CareLocal" width={64} height={64} className="h-16 w-16 rounded-xl object-contain bg-white" />
            ) : (
              <div className="w-7 h-7 rounded-md bg-brand-600 flex items-center justify-center">
                <span className="text-white font-bold text-xs">CL</span>
              </div>
            )}
            <span className="font-semibold text-lg tracking-tight truncate">{isChildcare ? '' : 'CareLocal'}</span>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          {NAVIGATION.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-600 text-white font-medium'
                    : 'text-brand-100 hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon className={`w-5 h-5 ${isActive ? 'text-brand-300' : 'text-brand-200'}`} />
                <span className="flex-1">{item.name}</span>
                {item.href === '/staff/requests' && openRequestCount > 0 && (
                  <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{openRequestCount}</span>
                )}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 md:ml-64 flex flex-col min-h-screen overflow-x-hidden">
        <header className="h-20 glass border-b border-border flex items-center justify-between gap-4 px-4 md:px-8 sticky top-0 z-10">
          <div className="min-w-0">
            <Link href={homeHref} className="md:hidden flex items-center gap-2">
              {isChildcare ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/logo.png" alt="CareLocal" width={40} height={40} className="h-10 w-10 rounded-lg object-contain bg-white" />
              ) : (
                <div className="w-7 h-7 rounded-md bg-brand-600 flex items-center justify-center">
                  <span className="text-white font-bold text-xs">CL</span>
                </div>
              )}
              <span className="font-semibold text-lg tracking-tight text-heading">CareLocal</span>
            </Link>
            <div className="hidden md:block">
              <div className="text-xs text-muted uppercase tracking-wider font-semibold">Staff</div>
              <div className="truncate text-lg font-bold text-heading">{userName}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isCenterAdmin && (
              <Link
                href="/center/dashboard"
                className="hidden sm:inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-brand-50 hover:text-brand-600"
              >
                <LayoutDashboard className="h-4 w-4" />
                Center dashboard
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
        <div className="p-4 md:p-8 flex-1">
          <GettingStartedBanner href="/staff/getting-started" pathname={pathname} />
          {children}
        </div>
      </main>

       {/* Mobile bottom nav */}
       <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-border flex justify-around p-2 z-20 pb-safe">
            {NAVIGATION.map((item) => {
                const isActive = pathname === item.href
                return (
                <Link
                    key={item.name}
                    href={item.href}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg text-xs transition-colors ${
                    isActive 
                        ? 'text-brand-600 font-medium' 
                        : 'text-muted'
                    }`}
                >
                    <item.icon className="w-6 h-6" />
                    <span className="relative">
                      {item.name.replace('My ', '')}
                      {item.href === '/staff/requests' && openRequestCount > 0 && (
                        <span className="absolute -right-3 -top-5 rounded-full bg-red-500 px-1.5 text-[9px] font-bold text-white">{openRequestCount}</span>
                      )}
                    </span>
                </Link>
                )
            })}
       </nav>
    </div>
  )
}

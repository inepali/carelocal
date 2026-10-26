'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Calendar, Clock, FileText, LogOut, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useIsRegularOnly, isSubstituteOnlyRoute } from '@/lib/hooks/useIsRegularOnly'
import { GettingStartedBanner } from '@/components/staff/GettingStarted'

export default function MobilePortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { isRegularOnly, loading: classLoading } = useIsRegularOnly()

  // Regular employees don't use the shift marketplace — keep them off those pages
  const blockedRoute = isRegularOnly && isSubstituteOnlyRoute(pathname)
  useEffect(() => {
    if (!classLoading && blockedRoute) router.replace('/mobile/documents')
  }, [classLoading, blockedRoute, router])

  const tabs = [
    {
      label: 'Shifts',
      icon: Calendar,
      href: '/mobile/shifts',
    },
    {
      label: 'My Shifts',
      icon: Clock,
      href: '/mobile/my-shifts',
    },
    {
      label: 'Documents',
      icon: FileText,
      href: '/mobile/documents',
    },
    {
      label: 'Account',
      icon: User,
      href: '/mobile/account',
    },
  ].filter(tab => !isRegularOnly || !isSubstituteOnlyRoute(tab.href))

  // Account (which holds Log Out) is hidden for regular employees, so they get it in the tab bar
  const handleLogout = async () => {
    await createClient().auth.signOut()
    router.replace('/mobile/login')
  }

  // Avoid flashing a marketplace page before the regular-employee redirect
  const holdContent = isSubstituteOnlyRoute(pathname) && (classLoading || blockedRoute)

  return (
    <div className="flex-1 flex flex-col min-h-screen relative pb-16">
      {/* Main tab content */}
      <main className="flex-grow p-6 overflow-y-auto max-h-[calc(100vh-4rem)]">
        {holdContent ? null : (
          <>
            <GettingStartedBanner href="/mobile/getting-started" pathname={pathname} />
            {children}
          </>
        )}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-white/95 backdrop-blur-md border-t border-border flex justify-around items-center z-50 max-w-md mx-auto shadow-lg">
        {!classLoading && tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = pathname === tab.href

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center justify-center flex-1 h-full select-none active:scale-95 transition-all ${
                isActive ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <Icon className="w-5 h-5 mb-1" />
              <span className="text-[10px] font-bold uppercase tracking-wider">{tab.label}</span>
            </Link>
          )
        })}
        {!classLoading && isRegularOnly && (
          <button
            onClick={handleLogout}
            className="flex flex-col items-center justify-center flex-1 h-full select-none active:scale-95 transition-all text-slate-400 hover:text-slate-600"
          >
            <LogOut className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Sign Out</span>
          </button>
        )}
      </nav>
    </div>
  )
}

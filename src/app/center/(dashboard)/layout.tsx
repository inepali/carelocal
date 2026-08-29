'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LogOut, LayoutDashboard, Users, UserPlus, FileText, Settings, Calendar, Home, Tags, CreditCard, Database, LifeBuoy } from 'lucide-react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { CenterContext } from './context'

export default function CenterDashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [centerName, setCenterName] = useState('Loading...')
  const [staffTerm, setStaffTerm] = useState('Staffs')
  const [workAreaTerm, setWorkAreaTerm] = useState('Classrooms')
  const [domainKey, setDomainKey] = useState<'childcare' | 'healthcare'>('childcare')

  useEffect(() => {
    async function loadCenter() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return router.push('/login')

      const { data } = await supabase
        .from('center_admins')
        .select(`
          centers (
            name,
            staff_term,
            work_area_term,
            domain_key
          )
        `)
        .eq('user_id', user.id)
        .single()

      if (data && data.centers) {
        // @ts-ignore - Supabase type inference limitation with joins
        setCenterName(data.centers.name)
        // @ts-ignore
        if (data.centers.staff_term) setStaffTerm(data.centers.staff_term)
        // @ts-ignore
        if (data.centers.work_area_term) setWorkAreaTerm(data.centers.work_area_term)
        // @ts-ignore
        if (data.centers.domain_key) setDomainKey(data.centers.domain_key)
      }
      setLoading(false)
    }

    loadCenter()
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  const NAVIGATION = [
    { name: 'Dashboard', href: '/center/dashboard', icon: LayoutDashboard },
    { name: 'Shifts', href: '/center/shifts', icon: Calendar },
    { name: staffTerm, href: '/center/team_member', icon: Users },
    { name: workAreaTerm, href: '/center/sections', icon: Home },
    { name: 'Documents', href: '/center/documents', icon: FileText },
    { name: 'Manage Data', href: '/center/settings/data', icon: Database },
    { name: 'Subscription', href: '/center/subscription', icon: CreditCard },
    { name: 'Support', href: '/center/support', icon: LifeBuoy },
    { name: 'Settings', href: '/center/settings', icon: Settings },
  ]

  if (loading) {
     return <div className="min-h-screen bg-surface flex items-center justify-center">Loading...</div>
  }

  return (
    <CenterContext.Provider value={{ staffTerm, workAreaTerm }}>
      <div className="center-shell min-h-screen bg-surface flex font-sans">
      {/* ── Sidebar ── */}
      <aside className="w-64 bg-brand-900 text-white flex flex-col fixed inset-y-0 z-10">
        <div className="h-16 flex items-center px-6 border-b border-white/10 shrink-0">
          <Link href="/center/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">{domainKey === 'healthcare' ? 'CLH' : 'CL'}</span>
            </div>
            <span className="font-semibold text-lg tracking-tight truncate">
              {domainKey === 'healthcare' ? 'CareLocal Health' : 'CareLocal'}
            </span>
          </Link>
        </div>

        <div className="px-6 py-4 border-b border-white/10 shrink-0">
          <div className="text-xs text-brand-300 uppercase tracking-wider font-semibold mb-1">
            {domainKey === 'healthcare' ? 'Facility' : 'Center'}
          </div>
          <div className="font-medium truncate">{centerName}</div>
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
                {item.name}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-white/10 shrink-0">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 w-full text-sm text-brand-200 hover:bg-white/5 hover:text-white rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 ml-64 flex flex-col min-h-screen overflow-x-hidden">
        <header className="h-16 glass border-b border-[#e2e8e4] flex items-center px-8 sticky top-0 z-10">
          {/* Breadcrumbs or page title could go here */}
        </header>
        <div className="p-8 flex-1">
          {children}
        </div>
      </main>
    </div>
    </CenterContext.Provider>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LogOut, LayoutDashboard, Users, UserPlus, FileText, Settings, Calendar, Plus, Home, Tags } from 'lucide-react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'

export default function CenterDashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const [centerName, setCenterName] = useState('Loading...')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadCenter() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return router.push('/login')

      const { data, error } = await supabase
        .from('center_admins')
        .select(`
          center_id,
          centers (
            name,
            slug
          )
        `)
        .eq('user_id', user.id)
        .single()

      if (data && data.centers) {
        // @ts-ignore - Supabase type inference limitation with joins
        setCenterName(data.centers.name)
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
    { name: 'Staff Pool', href: '/center/staff', icon: Users },
    { name: 'Classrooms', href: '/center/classrooms', icon: Home },
    { name: 'Documents', href: '/center/documents', icon: FileText },
    { name: 'Role Types', href: '/center/roles', icon: Tags },
    { name: 'Settings', href: '/center/settings', icon: Settings },
  ]

  if (loading) {
     return <div className="min-h-screen bg-[#f8faf9] flex items-center justify-center">Loading...</div>
  }

  return (
    <div className="center-shell min-h-screen bg-[#f8faf9] flex font-sans">
      {/* ── Sidebar ── */}
      <aside className="w-64 bg-[#0b3828] text-white flex flex-col fixed inset-y-0 z-10">
        <div className="h-16 flex items-center px-6 border-b border-white/10 shrink-0">
          <Link href="/center/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-[#157354] flex items-center justify-center">
              <span className="text-white font-bold text-xs">CL</span>
            </div>
            <span className="font-semibold text-lg tracking-tight truncate">CareLocal</span>
          </Link>
        </div>

        <div className="px-6 py-4 border-b border-white/10 shrink-0">
          <div className="text-xs text-[#74c3a8] uppercase tracking-wider font-semibold mb-1">Center</div>
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
                    ? 'bg-[#157354] text-white font-medium' 
                    : 'text-[#d4ede4] hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon className={`w-5 h-5 ${isActive ? 'text-[#74c3a8]' : 'text-[#a9dac9]'}`} />
                {item.name}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-white/10 shrink-0">
          <Link
            href="/center/shifts/new"
            className="flex items-center justify-center gap-2 w-full bg-[#fbbf24] text-[#0b3828] font-semibold py-2.5 rounded-lg hover:bg-[#f59e0b] mb-4 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Post a Shift
          </Link>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 w-full text-sm text-[#a9dac9] hover:bg-white/5 hover:text-white rounded-lg transition-colors"
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
  )
}

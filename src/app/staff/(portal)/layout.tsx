'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LogOut, Calendar, FileText, UserCircle, Globe } from 'lucide-react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'

export default function StaffPortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const [userName, setUserName] = useState('Loading...')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return router.push('/login')

      const { data, error } = await supabase
        .from('staff_profiles')
        .select('first_name, last_name')
        .eq('user_id', user.id)
      
      if (data && data.length > 0) {
        setUserName(`${data[0].first_name} ${data[0].last_name}`)
      } else {
        setUserName(user.email?.split('@')[0] || 'Educator')
      }
      setLoading(false)
    }

    loadUser()
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  const NAVIGATION = [
    { name: 'My Centers', href: '/staff/centers', icon: Globe },
    { name: 'Available Shifts', href: '/staff/shifts', icon: Calendar },
    { name: 'My Documents', href: '/staff/documents', icon: FileText },
    { name: 'My Profile', href: '/staff/profile', icon: UserCircle },
  ]

  if (loading) {
     return <div className="min-h-screen bg-[#f8faf9] flex items-center justify-center">Loading...</div>
  }

  return (
    <div className="staff-shell min-h-screen bg-[#f8faf9] flex flex-col font-sans">
      {/* ── Top Navigation (Mobile friendly for staff) ── */}
      <header className="h-16 bg-[#0b3828] text-white flex items-center justify-between px-6 sticky top-0 z-20">
        <Link href="/staff/shifts" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-[#157354] flex items-center justify-center">
              <span className="text-white font-bold text-xs">CL</span>
            </div>
            <span className="font-semibold text-lg tracking-tight truncate hidden sm:block">CareLocal</span>
        </Link>
        <div className="flex items-center gap-4">
            <span className="text-[#a9dac9] text-sm font-medium">{userName}</span>
            <button
                onClick={handleSignOut}
                className="text-[#d4ede4] hover:text-white transition-colors"
                title="Sign out"
            >
                <LogOut className="w-5 h-5" />
            </button>
        </div>
      </header>

      {/* ── Main Layout ── */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
          {/* Desktop sidebar */}
          <aside className="w-64 hidden md:block shrink-0 py-8 pr-8">
             <nav className="space-y-2 sticky top-24">
                {NAVIGATION.map((item) => {
                    const isActive = pathname === item.href
                    return (
                    <Link
                        key={item.name}
                        href={item.href}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors ${
                        isActive 
                            ? 'bg-[#157354] text-white font-medium shadow-sm' 
                            : 'text-[#6b7a73] hover:bg-white hover:text-[#0b3828]'
                        }`}
                    >
                        <item.icon className={`w-5 h-5 ${isActive ? 'text-[#a9dac9]' : 'text-[#6b7a73]'}`} />
                        {item.name}
                    </Link>
                    )
                })}
             </nav>
          </aside>

          {/* Main Content */}
          <main className="flex-1 py-8 px-4 md:px-0">
            {children}
          </main>
      </div>

       {/* Mobile bottom nav */}
       <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-[#e2e8e4] flex justify-around p-2 z-20 pb-safe">
            {NAVIGATION.map((item) => {
                const isActive = pathname === item.href
                return (
                <Link
                    key={item.name}
                    href={item.href}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg text-xs transition-colors ${
                    isActive 
                        ? 'text-[#157354] font-medium' 
                        : 'text-[#6b7a73]'
                    }`}
                >
                    <item.icon className="w-6 h-6" />
                    {item.name.replace('My ', '')}
                </Link>
                )
            })}
       </nav>
    </div>
  )
}

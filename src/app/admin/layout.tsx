'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { 
  LayoutDashboard, 
  Building2, 
  Users, 
  Settings, 
  LogOut, 
  Menu, 
  X,
  ShieldCheck,
  CreditCard,
  Bell,
  MapPin
} from 'lucide-react'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUserEmail(user.email || null)
      }
    }
    getUser()
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navItems = [
    { name: 'Overview', href: '/admin/dashboard', icon: LayoutDashboard },
    { name: 'Centers', href: '/admin/centers', icon: Building2 },
    { name: 'Metro Areas', href: '/admin/metros', icon: MapPin },
    { name: 'Global Staff', href: '/admin/staff', icon: Users },
    { name: 'Subscriptions', href: '/admin/billing', icon: CreditCard },
    { name: 'System Settings', href: '/admin/settings', icon: Settings },
  ]

  return (
    <div className="min-h-screen bg-[#f1f5f9] flex">
      {/* Mobile Sidebar Toggle */}
      <button 
        className="lg:hidden fixed bottom-6 right-6 z-50 p-4 bg-[#0f172a] text-white rounded-full shadow-xl"
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
      >
        {isSidebarOpen ? <X /> : <Menu />}
      </button>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-72 bg-[#0f172a] text-white transition-transform duration-300 ease-in-out transform
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full">
          {/* Logo Section */}
          <div className="p-8">
            <Link href="/admin/dashboard" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <ShieldCheck className="text-white w-6 h-6" />
              </div>
              <div>
                <span className="font-black text-xl tracking-tight block">CareLocal</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400 opacity-80">Super Admin</span>
              </div>
            </Link>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto mt-4">
            {navItems.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200
                    ${isActive 
                      ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-sm' 
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}
                  `}
                >
                  <item.icon className={`w-5 h-5 ${isActive ? 'text-blue-400' : 'text-slate-500'}`} />
                  {item.name}
                </Link>
              )
            })}
          </nav>

          {/* User Section (Bottom) */}
          <div className="p-6 mt-auto border-t border-slate-800/50">
            <div className="bg-slate-800/40 rounded-2xl p-4 mb-4">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center font-bold text-xs">SA</div>
                <div className="truncate">
                  <div className="text-sm font-bold truncate">{userEmail?.split('@')[0]}</div>
                  <div className="text-[10px] text-slate-500 truncate">{userEmail}</div>
                </div>
              </div>
            </div>
            <button 
              onClick={handleSignOut}
              className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/5 font-semibold text-sm transition-all"
            >
              <LogOut className="w-5 h-5" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 lg:ml-72 min-h-screen">
        {/* Top Header */}
        <header className="h-20 bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30 px-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
             <div className="h-10 w-[2px] bg-slate-200 hidden md:block"></div>
             <div className="text-sm font-medium text-slate-500">
               {navItems.find(i => i.href === pathname)?.name || 'Admin Console'}
             </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors relative">
               <Bell className="w-5 h-5" />
               <span className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full border-2 border-white"></span>
            </button>
            <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-600 text-xs">
              SA
            </div>
          </div>
        </header>

        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  )
}

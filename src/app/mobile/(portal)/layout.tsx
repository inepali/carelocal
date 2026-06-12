'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Calendar, Clock, FileText, User } from 'lucide-react'

export default function MobilePortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

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
  ]

  return (
    <div className="flex-1 flex flex-col min-h-screen relative pb-16">
      {/* Main tab content */}
      <main className="flex-grow p-6 overflow-y-auto max-h-[calc(100vh-4rem)]">
        {children}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-white/95 backdrop-blur-md border-t border-[#e2e8e4] flex justify-around items-center z-50 max-w-md mx-auto shadow-lg">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = pathname === tab.href

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center justify-center flex-1 h-full select-none active:scale-95 transition-all ${
                isActive ? 'text-[#157354]' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <Icon className="w-5 h-5 mb-1" />
              <span className="text-[10px] font-bold uppercase tracking-wider">{tab.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

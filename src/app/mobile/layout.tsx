'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      const isLoginRoute = pathname === '/mobile/login'

      if (!user) {
        if (!isLoginRoute) {
          router.replace('/mobile/login')
        }
      } else {
        if (isLoginRoute) {
          router.replace('/mobile/shifts')
        }
      }
      setLoading(false)
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => console.log('Service Worker registered scope:', reg.scope))
        .catch((err) => console.error('Service Worker registration error:', err))
    }

    checkAuth()
  }, [pathname, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f8faf9]">
        <div className="w-8 h-8 rounded-full border-4 border-[#157354]/30 border-t-[#157354] animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex justify-center min-h-screen bg-[#f1f5f3]">
      <div className="w-full max-w-md bg-[#f8faf9] min-h-screen flex flex-col relative shadow-2xl border-x border-slate-100 pb-safe">
        {children}
      </div>
    </div>
  )
}

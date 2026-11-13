'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LogIn } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

/** Sign out here and come back to this review link after signing in with another account */
export function SwitchAccountButton({ code, label = 'Use a different account' }: { code: string; label?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function go() {
    setBusy(true)
    await createClient().auth.signOut()
    router.push(`/login?redirect=${encodeURIComponent(`/r/${code}`)}`)
  }

  return (
    <button type="button" onClick={go} disabled={busy}
      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-50">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} {label}
    </button>
  )
}

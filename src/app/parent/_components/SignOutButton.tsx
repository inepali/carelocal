'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { parentSignOut } from '@/app/actions/parent-portal.actions'

export function SignOutButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => { await parentSignOut(); router.refresh() })}
      className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-medium text-text-muted hover:bg-white disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" /> Sign out
    </button>
  )
}

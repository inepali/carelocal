'use client'

import { useState, useTransition } from 'react'
import { CheckCheck, Loader2 } from 'lucide-react'
import { acknowledgeFromLink } from '@/app/actions/announcement-link.actions'

/** "I've read this", on an announcement that asked for it */
export function AckButton({ token, acknowledgedAt }: { token: string; acknowledgedAt: string | null }) {
  const [at, setAt] = useState(acknowledgedAt)
  const [error, setError] = useState(false)
  const [pending, start] = useTransition()

  if (at) {
    return (
      <p className="flex items-center justify-center gap-2 rounded-2xl bg-[#e2f2ea] py-3 text-sm font-semibold text-[#17603f]">
        <CheckCheck className="h-4 w-4" /> Acknowledged {new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </p>
    )
  }
  return (
    <div>
      <button disabled={pending} onClick={() => start(async () => {
        const res = await acknowledgeFromLink(token)
        if (res.ok) setAt(res.at)
        else setError(true)
      })}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />} I’ve read this
      </button>
      {error && <p role="alert" className="mt-2 text-center text-sm text-[#a3221b]">Could not save that. Please try again.</p>}
    </div>
  )
}

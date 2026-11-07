'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Loader2 } from 'lucide-react'
import { parentSignIn } from '@/app/actions/parent-portal.actions'

/** Code entry. The code is formatted as it is typed (K7QF-29XM); the server decides whether it works. */
export function SignInForm({ expired }: { expired: boolean }) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(expired ? 'Please enter your access code again.' : null)
  const [pending, startTransition] = useTransition()

  function onChange(raw: string) {
    const clean = raw.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8)
    setValue(clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    setError(null)
    startTransition(async () => {
      const res = await parentSignIn(value)
      if (res.ok) router.refresh()
      else setError(res.error)
    })
  }

  const ready = value.replace('-', '').length === 8

  return (
    <div className="flex min-h-[80dvh] flex-col justify-center">
      <div className="rounded-3xl border border-border bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold">See your child’s day</h1>
        <p className="mt-1.5 text-sm text-text-muted">Enter the access code from your child care center. You stay signed in on this device.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label htmlFor="parent-code" className="block text-sm font-semibold">Access code</label>
          <input
            id="parent-code"
            value={value}
            onChange={e => onChange(e.target.value)}
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="K7QF-29XM"
            aria-invalid={!!error}
            aria-describedby={error ? 'parent-code-error' : undefined}
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3.5 text-center font-mono text-2xl font-bold tracking-[0.2em] outline-none placeholder:text-subtle focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
          />
          {error && <p id="parent-code-error" role="alert" className="text-sm font-medium text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={!ready || pending}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-3.5 text-base font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending && <Loader2 className="h-5 w-5 animate-spin" />} Continue
          </button>
        </form>
      </div>
      <p className="mt-6 text-center text-xs text-muted">No code yet? Ask your center’s director. Keep your code private.</p>
    </div>
  )
}

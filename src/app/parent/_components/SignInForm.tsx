'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Link2Off, Loader2 } from 'lucide-react'
import { parentSignIn } from '@/app/actions/parent-portal.actions'

/** PIN entry on a center's link. Six digits; it submits by itself once all six are in. */
export function SignInForm({ centerKey, centerName, expired, next = '/parent' }: { centerKey: string; centerName: string; expired: boolean; next?: '/parent' | '/parent/review' }) {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(expired ? 'Please enter your PIN again.' : null)
  const [pending, startTransition] = useTransition()
  const input = useRef<HTMLInputElement>(null)

  function submit(value: string) {
    if (pending || value.length !== 6) return
    setError(null)
    startTransition(async () => {
      const res = await parentSignIn(centerKey, value)
      if (res.ok) { router.push(next); router.refresh(); return }
      setError(res.error)
      setPin('')
      input.current?.focus()
    })
  }

  function onChange(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 6)
    setPin(digits)
    if (digits.length === 6) submit(digits)
  }

  return (
    <div className="flex min-h-[80dvh] flex-col justify-center">
      <div className="rounded-3xl border border-border bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <KeyRound className="h-6 w-6" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{centerName}</p>
        <h1 className="mt-1 text-2xl font-bold">See your child’s day</h1>
        <p className="mt-1.5 text-sm text-text-muted">Enter the 6-digit PIN your center gave you. You stay signed in on this phone.</p>

        <form onSubmit={e => { e.preventDefault(); submit(pin) }} className="mt-6 space-y-4">
          <label htmlFor="parent-pin" className="block text-sm font-semibold">PIN</label>
          <input
            ref={input}
            id="parent-pin"
            value={pin}
            onChange={e => onChange(e.target.value)}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            placeholder="••••••"
            aria-invalid={!!error}
            aria-describedby={error ? 'parent-pin-error' : undefined}
            disabled={pending}
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3.5 text-center font-mono text-3xl font-bold tracking-[0.5em] outline-none placeholder:text-subtle focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:opacity-60"
          />
          {error && <p id="parent-pin-error" role="alert" className="text-sm font-medium text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={pin.length !== 6 || pending}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-3.5 text-base font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending && <Loader2 className="h-5 w-5 animate-spin" />} Continue
          </button>
        </form>
      </div>
      <p className="mt-6 text-center text-xs text-muted">Forgot your PIN? Ask the director for a new one. Keep it private.</p>
    </div>
  )
}

/** /parent with no session and no remembered center: the parent needs their center's link */
export function NoCenterLink({ broken = false }: { broken?: boolean }) {
  return (
    <div className="flex min-h-[80dvh] flex-col justify-center">
      <div className="rounded-3xl border border-border bg-white p-6 text-center shadow-sm">
        <Link2Off className="mx-auto h-10 w-10 text-subtle" />
        <h1 className="mt-3 text-xl font-bold">{broken ? 'This link is not working' : 'Open your center’s link'}</h1>
        <p className="mt-1.5 text-sm text-text-muted">
          {broken
            ? 'Check that the link is complete, or ask your center for it again. The parent page may also be turned off for now.'
            : 'Your child care center sent you a link and a 6-digit PIN by email or on a card. Open that link to sign in.'}
        </p>
      </div>
    </div>
  )
}

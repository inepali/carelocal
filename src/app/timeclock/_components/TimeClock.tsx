'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarOff, CheckCircle2, Delete, LayoutGrid, Loader2, LogIn, LogOut, TriangleAlert, X } from 'lucide-react'
import {
  clockCancelOff, clockCloseRoom, clockIdentify, clockOpenRoom, clockPunch, clockRequestOff, type ClockFail,
} from '@/app/actions/time-clock-kiosk.actions'
import type { ClockPerson } from '@/lib/server/timeclock'
import { TIME_OFF_LABEL, addDays, fmtHours, formatMinutes, timeInZone, type TimeOffKind } from '@/lib/timeclock'

type Screen =
  | { kind: 'pad' }
  | { kind: 'person'; person: ClockPerson }
  | { kind: 'timeoff'; person: ClockPerson }
  | { kind: 'done'; title: string; detail: string }

const IDLE_MS = 30_000
const DONE_MS = 4_000

/** A long date like "Tuesday, November 17" in the center's zone */
function longDate(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(now)
}

function shortDay(day: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T00:00:00Z`))
}

export function TimeClock({ centerName, timeZone, today, deviceName }: { centerName: string; timeZone: string; today: string; deviceName: string }) {
  const router = useRouter()
  const [screen, setScreen] = useState<Screen>({ kind: 'pad' })
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const [pending, startTransition] = useTransition()
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    setPin('')
    setError(null)
    setScreen({ kind: 'pad' })
  }, [])

  // Nobody stays signed in on the Time Clock (a My Room left open, an admin who set it up)
  useEffect(() => { clockCloseRoom().catch(() => {}) }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Back to the PIN pad after a while; the PIN is forgotten then
  const touch = useCallback(() => {
    if (idle.current) clearTimeout(idle.current)
    if (screen.kind === 'pad') return
    idle.current = setTimeout(reset, screen.kind === 'done' ? DONE_MS : IDLE_MS)
  }, [screen.kind, reset])
  useEffect(() => { touch(); return () => { if (idle.current) clearTimeout(idle.current) } }, [touch])

  const failed = (res: ClockFail) => {
    if (res.noDevice) { router.refresh(); return }
    if (res.retryAfter) setLockedUntil(Date.now() + res.retryAfter * 1000)
    setError(res.error)
  }

  function identify(value: string) {
    setError(null)
    startTransition(async () => {
      const res = await clockIdentify(value)
      if (res.ok) { setScreen({ kind: 'person', person: res.person }); return }
      setPin('')
      failed(res)
    })
  }

  function press(d: string) {
    if (pending || Date.now() < lockedUntil) return
    setError(null)
    const next = (pin + d).slice(0, 4)
    setPin(next)
    if (next.length === 4) identify(next)
  }

  function punch(action: 'in' | 'out') {
    setError(null)
    startTransition(async () => {
      const res = await clockPunch(pin, action)
      if (!res.ok) { failed(res); return }
      const at = timeInZone(res.at, timeZone)
      setPin('')
      setScreen({
        kind: 'done',
        title: action === 'in' ? `Clocked in at ${at}` : `Clocked out at ${at}`,
        detail: action === 'in'
          ? `Have a great day, ${res.person.first_name}!`
          : `${res.minutes != null ? `That was ${formatMinutes(res.minutes)} hours. ` : ''}Today: ${formatMinutes(res.person.today_minutes)} hours. Thank you, ${res.person.first_name}!`,
      })
    })
  }

  function openRoom() {
    setError(null)
    startTransition(async () => {
      const res = await clockOpenRoom(pin)
      if (!res.ok) { failed(res); return }
      setPin('')
      router.push('/timeclock/room')
    })
  }

  const locked = Date.now() < lockedUntil

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl select-none flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]" onPointerDown={touch}>
      <header className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">{centerName}</p>
          <p className="text-xs text-subtle">Time Clock · {deviceName}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-4xl font-bold tabular-nums" suppressHydrationWarning>{timeInZone(now.toISOString(), timeZone)}</p>
          <p className="text-sm text-text-muted" suppressHydrationWarning>{longDate(now, timeZone)}</p>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center py-6">
        {screen.kind === 'pad' && (
          <div className="w-full max-w-sm">
            <h1 className="text-center text-2xl font-bold">Enter your Time Card PIN</h1>
            <div className="mt-6 flex justify-center gap-4" aria-label={`${pin.length} of 4 digits`}>
              {[0, 1, 2, 3].map(i => (
                <span key={i} className={`h-5 w-5 rounded-full border-2 ${i < pin.length ? 'border-brand-600 bg-brand-600' : 'border-border bg-white'}`} />
              ))}
            </div>
            <p role="alert" className="mt-4 min-h-6 text-center text-base font-medium text-red-600">{error}</p>
            <div className="mt-2 grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                <PadKey key={d} onClick={() => press(d)} disabled={pending || locked}>{d}</PadKey>
              ))}
              <PadKey onClick={() => { setPin(''); setError(null) }} disabled={pending || !pin} label="Clear"><X className="h-7 w-7" /></PadKey>
              <PadKey onClick={() => press('0')} disabled={pending || locked}>0</PadKey>
              <PadKey onClick={() => setPin(p => p.slice(0, -1))} disabled={pending || !pin} label="Delete"><Delete className="h-7 w-7" /></PadKey>
            </div>
            {pending && <p className="mt-4 flex items-center justify-center gap-2 text-text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Checking…</p>}
            <p className="mt-6 text-center text-xs text-muted">Forgot your PIN? Ask the office. Only an admin can set it.</p>
          </div>
        )}

        {screen.kind === 'person' && (
          <PersonScreen person={screen.person} timeZone={timeZone} pending={pending} error={error}
            onPunch={punch} onTimeOff={() => { setError(null); setScreen({ kind: 'timeoff', person: screen.person }) }}
            onRoom={openRoom} onDone={reset} />
        )}

        {screen.kind === 'timeoff' && (
          <TimeOffScreen person={screen.person} today={today} pin={pin} onBack={p => { setError(null); setScreen({ kind: 'person', person: p ?? screen.person }) }}
            onSent={() => { setPin(''); setScreen({ kind: 'done', title: 'Request sent', detail: 'The office will answer it. You can see it here or in your CareLocal account.' }) }}
            onFail={failed} />
        )}

        {screen.kind === 'done' && (
          <button type="button" onClick={reset} className="flex flex-col items-center text-center">
            <CheckCircle2 className="h-24 w-24 text-emerald-600" />
            <h1 className="mt-4 text-3xl font-bold">{screen.title}</h1>
            <p className="mt-2 max-w-md text-lg text-text-muted">{screen.detail}</p>
            <span className="mt-8 text-sm text-muted">Tap to close</span>
          </button>
        )}
      </main>
    </div>
  )
}

function PadKey({ children, onClick, disabled, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
      className="flex h-20 items-center justify-center rounded-2xl border border-border bg-white text-3xl font-semibold shadow-sm transition active:scale-95 active:bg-brand-50 disabled:opacity-40">
      {children}
    </button>
  )
}

function PersonScreen({ person, timeZone, pending, error, onPunch, onTimeOff, onRoom, onDone }: {
  person: ClockPerson; timeZone: string; pending: boolean; error: string | null
  onPunch: (a: 'in' | 'out') => void; onTimeOff: () => void; onRoom: () => void; onDone: () => void
}) {
  const inNow = !!person.clocked_in_at
  return (
    <div className="w-full max-w-lg">
      <div className="flex items-center gap-4">
        {person.photo_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={person.photo_url} alt="" className="h-20 w-20 rounded-full object-cover" />
          : <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-50 text-3xl font-bold text-brand-700">{person.first_name.slice(0, 1)}</span>}
        <div>
          <h1 className="text-3xl font-bold">Hi, {person.first_name}</h1>
          <p className="text-lg text-text-muted">
            {inNow ? `Clocked in since ${timeInZone(person.clocked_in_at!, timeZone)}` : 'You are not clocked in'}
            {person.today_minutes > 0 && ` · today ${formatMinutes(person.today_minutes)} h`}
          </p>
        </div>
      </div>

      {person.missed && (
        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> You have a missed clock-out from an earlier day. Please tell the office the time you left.
        </p>
      )}

      <button type="button" onClick={() => onPunch(inNow ? 'out' : 'in')} disabled={pending}
        className={`mt-6 flex w-full items-center justify-center gap-3 rounded-3xl px-6 py-7 text-3xl font-bold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60 ${inNow ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
        {pending ? <Loader2 className="h-8 w-8 animate-spin" /> : inNow ? <LogOut className="h-8 w-8" /> : <LogIn className="h-8 w-8" />}
        {inNow ? 'Clock out' : 'Clock in'}
      </button>
      <p role="alert" className="mt-3 min-h-6 text-center font-medium text-red-600">{error}</p>

      <div className={`mt-2 grid gap-3 ${person.room ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <SideButton onClick={onTimeOff} disabled={pending}><CalendarOff className="h-6 w-6" /> Time off</SideButton>
        {person.room && <SideButton onClick={onRoom} disabled={pending}><LayoutGrid className="h-6 w-6" /> My Room</SideButton>}
        <SideButton onClick={onDone} disabled={pending}><X className="h-6 w-6" /> Done</SideButton>
      </div>

      {person.pto && (person.pto.yearly > 0 || person.pto.used > 0) && (
        <p className="mt-5 text-center text-sm text-text-muted">
          PTO left this year: <strong>{fmtHours(person.pto.remaining)} h</strong>
          {person.pto.pending > 0 && ` (${fmtHours(person.pto.pending)} h waiting for an answer)`}
        </p>
      )}
    </div>
  )
}

function SideButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-white px-3 py-4 text-base font-semibold shadow-sm transition active:scale-95 disabled:opacity-50">
      {children}
    </button>
  )
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800', approved: 'bg-emerald-50 text-emerald-800', denied: 'bg-red-50 text-red-700', cancelled: 'bg-surface text-muted',
}
const STATUS_LABEL: Record<string, string> = { pending: 'Waiting', approved: 'Approved', denied: 'Denied', cancelled: 'Cancelled' }

function TimeOffScreen({ person, today, pin, onBack, onSent, onFail }: {
  person: ClockPerson; today: string; pin: string
  onBack: (p?: ClockPerson) => void; onSent: () => void; onFail: (r: ClockFail) => void
}) {
  const [kind, setKind] = useState<TimeOffKind>('pto')
  const [start, setStart] = useState(addDays(today, 1))
  const [end, setEnd] = useState(addDays(today, 1))
  const [halfDay, setHalfDay] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const oneDay = start === end

  function send() {
    setError(null)
    startTransition(async () => {
      const res = await clockRequestOff(pin, { kind, start, end: end < start ? start : end, fullDay: !(halfDay && oneDay), reason })
      if (res.ok) { onSent(); return }
      if (res.noDevice || res.retryAfter) { onFail(res); return }
      setError(res.error)
    })
  }

  function cancel(id: string) {
    setError(null)
    startTransition(async () => {
      const res = await clockCancelOff(pin, id)
      if (res.ok) { onBack(res.person); return }
      setError(res.error)
    })
  }

  return (
    <div className="w-full max-w-lg">
      <h1 className="text-2xl font-bold">Ask for time off</h1>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {(['pto', 'sick', 'unpaid'] as TimeOffKind[]).map(k => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`rounded-2xl border px-3 py-3 text-base font-semibold ${kind === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-border bg-white'}`}>
            {TIME_OFF_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">First day
          <input type="date" value={start} min={addDays(today, -7)} onChange={e => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value) }}
            className="mt-1 w-full rounded-xl border border-border bg-white px-3 py-3 text-base font-normal" />
        </label>
        <label className="text-sm font-semibold">Last day
          <input type="date" value={end} min={start} max={addDays(start, 30)} onChange={e => setEnd(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-white px-3 py-3 text-base font-normal" />
        </label>
      </div>
      {oneDay && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[false, true].map(h => (
            <button key={String(h)} type="button" onClick={() => setHalfDay(h)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold ${halfDay === h ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-border bg-white'}`}>
              {h ? 'Half day' : 'Full day'}
            </button>
          ))}
        </div>
      )}
      <label className="mt-3 block text-sm font-semibold">Note (optional)
        <input value={reason} onChange={e => setReason(e.target.value.slice(0, 300))} placeholder="For the office"
          className="mt-1 w-full rounded-xl border border-border bg-white px-3 py-3 text-base font-normal" />
      </label>
      {kind === 'pto' && person.pto && (
        <p className="mt-2 text-sm text-text-muted">PTO left this year: {fmtHours(person.pto.remaining)} h. Hours count Monday to Friday.</p>
      )}
      <p role="alert" className="mt-2 min-h-5 text-sm font-medium text-red-600">{error}</p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => onBack()} disabled={pending} className="rounded-2xl border border-border bg-white px-4 py-4 text-base font-semibold">Back</button>
        <button type="button" onClick={send} disabled={pending}
          className="flex items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-4 text-base font-semibold text-white disabled:opacity-60">
          {pending && <Loader2 className="h-5 w-5 animate-spin" />} Send request
        </button>
      </div>

      {person.requests.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Your requests</h2>
          <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-white">
            {person.requests.map(r => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-semibold">{TIME_OFF_LABEL[r.kind]} · {shortDay(r.start_date)}{r.end_date !== r.start_date ? ` – ${shortDay(r.end_date)}` : ''}</p>
                  <p className="text-text-muted">{fmtHours(r.hours)} h{!r.full_day ? ' (half day)' : ''}{r.decision_note ? ` · ${r.decision_note}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  {r.status === 'pending' && (
                    <button type="button" onClick={() => cancel(r.id)} disabled={pending} className="text-xs font-semibold text-red-600 underline">Cancel</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

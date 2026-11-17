'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarOff, Clock, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { showAlert, showConfirm } from '@/lib/dialog'
import {
  TIME_OFF_LABEL, addDays, dayInZone, fmtHours, formatMinutes, periodFor, shiftPeriod, timeInZone,
  type PayPeriodKind, type PtoBalance, type TimeOff, type TimeOffKind,
} from '@/lib/timeclock'

interface MyCenter {
  center_id: string
  center_name: string
  center_staff_id: string
  today: string
  timezone: string
  settings: { pay_period: PayPeriodKind; period_anchor: string; full_day_hours: number }
  pto: PtoBalance | null
  requests: TimeOff[]
  entries: { id: string; clock_in: string; clock_out: string | null; missed_out: boolean; edited: boolean }[]
}

const fmtDay = (day: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T00:00:00Z`))
const STATUS: Record<string, [string, string]> = {
  pending: ['Waiting', 'bg-amber-50 text-amber-800'], approved: ['Approved', 'bg-emerald-50 text-emerald-800'],
  denied: ['Denied', 'bg-red-50 text-red-700'], cancelled: ['Cancelled', 'bg-surface text-muted'],
}

/** Staff: hours from the Time Clock, PTO left, and time off requests (also possible on the Time Clock tablet) */
export default function MyTimePage() {
  const [centers, setCenters] = useState<MyCenter[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('timeclock_mine', { p_from: null })
    if (error) { setError(error.message); return }
    setCenters(data as MyCenter[])
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-4xl pb-20">
      <h1 className="mb-2 flex items-center gap-3 text-3xl font-extrabold text-heading"><Clock className="h-8 w-8 text-brand-600" /> My Time</h1>
      <p className="mb-6 text-muted">Your hours come from clocking in and out on your center&apos;s Time Clock with your Time Card PIN. Ask the office if something looks wrong, or for a new PIN.</p>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!centers ? (
        <div className="flex items-center gap-2 p-8 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
      ) : centers.length === 0 ? (
        <div className="rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">None of your centers use the Time Clock yet.</div>
      ) : centers.map(c => <CenterTime key={c.center_id} c={c} multi={centers.length > 1} onChanged={load} />)}
    </div>
  )
}

function CenterTime({ c, multi, onChanged }: { c: MyCenter; multi: boolean; onChanged: () => void }) {
  const current = periodFor(c.today, c.settings.period_anchor, c.settings.pay_period)
  const previous = shiftPeriod(current, c.settings.pay_period, -1)
  const minutesIn = (p: { start: string; end: string }) => c.entries.reduce((sum, e) => {
    const day = dayInZone(e.clock_in, c.timezone)
    if (!e.clock_out || e.missed_out || day < p.start || day > p.end) return sum
    return sum + (Date.parse(e.clock_out) - Date.parse(e.clock_in)) / 60000
  }, 0)

  async function cancel(r: TimeOff) {
    if (!await showConfirm(`Cancel your ${TIME_OFF_LABEL[r.kind]} request for ${fmtDay(r.start_date)}?`, { title: 'Cancel request', confirmLabel: 'Cancel request', tone: 'danger' })) return
    const { error } = await createClient().rpc('timeclock_my_cancel', { p_center_id: c.center_id, p_request_id: r.id })
    if (error) { showAlert(error.message); return }
    onChanged()
  }

  return (
    <div className="mb-8 space-y-5">
      {multi && <h2 className="text-xl font-bold text-heading">{c.center_name}</h2>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="This pay period" value={`${formatMinutes(minutesIn(current))} h`} sub={`${fmtDay(current.start)} – ${fmtDay(current.end)}`} />
        <Stat label="Last pay period" value={`${formatMinutes(minutesIn(previous))} h`} sub={`${fmtDay(previous.start)} – ${fmtDay(previous.end)}`} />
        <Stat label="PTO left this year" value={c.pto ? `${fmtHours(c.pto.remaining)} h` : '—'}
          sub={c.pto ? `${fmtHours(c.pto.used)} used${c.pto.pending ? ` · ${fmtHours(c.pto.pending)} waiting` : ''}${c.pto.carry_over ? ` · ${fmtHours(c.pto.carry_over)} carried over` : ''}` : ''} />
      </div>

      <RequestForm c={c} onSent={onChanged} />

      <section className="rounded-2xl border border-border bg-white shadow-sm">
        <h3 className="border-b border-border px-5 py-3 font-bold text-heading">My requests</h3>
        {c.requests.length === 0 ? <p className="p-5 text-sm text-muted">No requests yet.</p> : (
          <ul className="divide-y divide-border">
            {c.requests.map(r => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-semibold">{TIME_OFF_LABEL[r.kind]} · {fmtDay(r.start_date)}{r.end_date !== r.start_date ? ` – ${fmtDay(r.end_date)}` : ''}</p>
                  <p className="text-muted">{fmtHours(r.hours)} h{!r.full_day ? ' (half day)' : ''}{r.decision_note ? ` · ${r.decision_note}` : ''}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
                  {r.status === 'pending' && <button className="text-xs font-semibold text-red-600 hover:underline" onClick={() => cancel(r)}>Cancel</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-white shadow-sm">
        <h3 className="border-b border-border px-5 py-3 font-bold text-heading">Punches (last month)</h3>
        {c.entries.length === 0 ? <p className="p-5 text-sm text-muted">No punches yet.</p> : (
          <ul className="divide-y divide-border">
            {c.entries.map(e => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5 text-sm">
                <span><span className="inline-block w-28 font-medium">{fmtDay(dayInZone(e.clock_in, c.timezone))}</span>
                  {timeInZone(e.clock_in, c.timezone)} – {e.clock_out ? timeInZone(e.clock_out, c.timezone) : e.missed_out ? <em className="text-amber-700">missed clock-out (tell the office)</em> : <em>clocked in</em>}
                  {e.edited && <span className="ml-2 text-xs text-muted">(fixed by the office)</span>}
                </span>
                {e.clock_out && <span className="tabular-nums text-muted">{formatMinutes((Date.parse(e.clock_out) - Date.parse(e.clock_in)) / 60000)} h</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-heading">{value}</p>
      <p className="text-xs text-muted">{sub}</p>
    </div>
  )
}

function RequestForm({ c, onSent }: { c: MyCenter; onSent: () => void }) {
  const [kind, setKind] = useState<TimeOffKind>('pto')
  const [start, setStart] = useState(addDays(c.today, 1))
  const [end, setEnd] = useState(addDays(c.today, 1))
  const [halfDay, setHalfDay] = useState(false)
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function send() {
    setMsg(null)
    setSending(true)
    const { error } = await createClient().rpc('timeclock_my_request', {
      p_center_id: c.center_id, p_kind: kind, p_start: start, p_end: end < start ? start : end,
      p_full_day: !(halfDay && start === end), p_reason: reason || null,
    })
    setSending(false)
    if (error) { setMsg({ ok: false, text: error.message }); return }
    setMsg({ ok: true, text: 'Sent. The office will answer it.' })
    setReason('')
    onSent()
  }

  const btn = (on: boolean) => `rounded-xl border px-3 py-2 text-sm font-bold ${on ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-border bg-white text-muted'}`
  return (
    <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <h3 className="flex items-center gap-2 font-bold text-heading"><CalendarOff className="h-5 w-5 text-brand-600" /> Ask for time off</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['pto', 'sick', 'unpaid'] as TimeOffKind[]).map(k => <button key={k} type="button" className={btn(kind === k)} onClick={() => setKind(k)}>{TIME_OFF_LABEL[k]}</button>)}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <label className="text-sm font-medium">First day
          <input type="date" value={start} min={addDays(c.today, -7)} onChange={e => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value) }}
            className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium">Last day
          <input type="date" value={end} min={start} max={addDays(start, 30)} onChange={e => setEnd(e.target.value)} className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium sm:col-span-2">Note (optional)
          <input value={reason} maxLength={300} onChange={e => setReason(e.target.value)} className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm" />
        </label>
      </div>
      {start === end && (
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={halfDay} onChange={e => setHalfDay(e.target.checked)} /> Half day ({fmtHours(c.settings.full_day_hours / 2)} h)</label>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50" onClick={send} disabled={sending}>
          {sending && <Loader2 className="h-4 w-4 animate-spin" />} Send request
        </button>
        <span className="text-xs text-muted">A full day is {fmtHours(c.settings.full_day_hours)} h; hours count Monday to Friday.</span>
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </section>
  )
}

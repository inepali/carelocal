'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, Moon, Sun } from 'lucide-react'
import { clockTime, duration, nextCheck, nowHHMM, SLEEP_STATUSES, timeToIso, type Medication, type OpenNap, type SleepStatus } from '@/lib/daily'
import { Choices, FIELD } from './DailyForms'

/** The time row every form shares: now unless the teacher changes it */
function useTime() {
  const [time, setTime] = useState(nowHHMM())
  const [touched, setTouched] = useState(false)
  const field = (
    <label className="flex items-center gap-2 text-sm font-semibold text-text-main">
      Time
      <input type="time" value={time} onChange={e => { setTime(e.target.value); setTouched(true) }} className={`${FIELD} w-auto`} />
      {!touched && <span className="text-xs font-normal text-muted">now</span>}
    </label>
  )
  return { at: touched ? timeToIso(time) : null, field }
}

function Buttons({ busy, disabled, label, onCancel }: { busy: boolean; disabled?: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={onCancel} className="min-h-12 rounded-xl border border-border bg-white text-sm font-bold text-text-main hover:bg-surface">Cancel</button>
      <button type="submit" disabled={disabled || busy}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {label}
      </button>
    </div>
  )
}

const ErrorLine = ({ error }: { error: string | null }) =>
  error ? <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{error}</p> : null

const FORM = 'flex flex-col gap-4 rounded-2xl border border-border bg-surface/40 p-3'

/** "Sleeping since 12:30 · next check in 6 min", amber when a required check is due */
export function NapBanner({ nap, minutes, required, now, busy, onCheck, onWake }: {
  nap: OpenNap
  minutes: number
  required: boolean
  now: Date
  busy: boolean
  onCheck: () => void
  onWake: () => void
}) {
  const next = nextCheck(nap, minutes, now)
  const status = SLEEP_STATUSES.find(s => s.value === nap.last_status)?.label
  const due = required && next.overdue
  return (
    <div className={`mb-3 rounded-2xl border p-3 ${due ? 'border-[#e8a33d] bg-[#fff0d1]' : 'border-[#c7d4f0] bg-[#eef3fc]'}`} role="status">
      <p className="flex items-center gap-2 text-base font-bold text-heading">
        <Moon className="h-5 w-5 text-[#3b5bab]" /> Sleeping since {clockTime(nap.at)}
        <span className="text-sm font-normal text-muted">· {duration(nap.at, now.toISOString())}</span>
      </p>
      <p className={`mt-1 text-sm ${due ? 'font-bold text-[#7a4b00]' : 'text-text-main'}`}>
        {nap.last_check_at ? `Last check ${clockTime(nap.last_check_at)}${status ? ` · ${status}` : ''}` : 'No sleep check yet'}
        {' · '}
        {required
          ? (next.overdue ? `Sleep check due now (every ${minutes} min)` : `Next check in ${next.minutesLeft} min`)
          : 'Checks optional at this age'}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onCheck} disabled={busy}
          className={`min-h-12 rounded-xl text-sm font-bold disabled:opacity-50 ${due ? 'bg-[#b56a00] text-white' : 'border border-border bg-white text-heading'}`}>
          Sleep check
        </button>
        <button type="button" onClick={onWake} disabled={busy}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-white text-sm font-bold text-heading disabled:opacity-50">
          <Sun className="h-4 w-4 text-[#b56a00]" /> Woke up
        </button>
      </div>
    </div>
  )
}

/** Fell asleep / Woke up: a time and a button */
export function NapTimeForm({ mode, busy, error, onSave, onCancel }: {
  mode: 'start' | 'wake'
  busy: boolean
  error: string | null
  onSave: (at: string | null) => void
  onCancel: () => void
}) {
  const t = useTime()
  return (
    <form className={FORM} onSubmit={e => { e.preventDefault(); onSave(t.at) }}>
      <p className="text-base font-bold text-heading">{mode === 'start' ? 'Nap: fell asleep' : 'Woke up'}</p>
      {t.field}
      <ErrorLine error={error} />
      <Buttons busy={busy} label={mode === 'start' ? 'Start nap' : 'Woke up'} onCancel={onCancel} />
    </form>
  )
}

/** One sleep check. For infants, "other position" reminds the teacher to place the baby on their back. */
export function SleepCheckForm({ required, busy, error, onSave, onCancel }: {
  required: boolean
  busy: boolean
  error: string | null
  onSave: (status: SleepStatus, note: string | null, at: string | null) => void
  onCancel: () => void
}) {
  const [status, setStatus] = useState<SleepStatus | null>(null)
  const [note, setNote] = useState('')
  const t = useTime()
  return (
    <form className={FORM} onSubmit={e => { e.preventDefault(); if (status) onSave(status, note.trim() || null, t.at) }}>
      <p className="text-base font-bold text-heading">Sleep check</p>
      <Choices label="How is the child sleeping" options={SLEEP_STATUSES} value={status} onChange={setStatus} cols={2} />
      {status === 'other' && required && (
        <p className="flex items-start gap-2 rounded-xl bg-[#fff0d1] px-3 py-2 text-sm font-bold text-[#7a4b00]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Place the baby on their back to sleep, then save.
        </p>
      )}
      <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} className={FIELD}
        placeholder={status === 'other' ? 'Note, for example: turned onto back' : 'Note (optional)'} />
      {t.field}
      <ErrorLine error={error} />
      <Buttons busy={busy} disabled={!status} label="Save check" onCancel={onCancel} />
    </form>
  )
}

/** Medicine from the child's authorized list (entered by a director from the medical form) */
export function MedicineForm({ medications, busy, error, onSave, onCancel }: {
  medications: Medication[]
  busy: boolean
  error: string | null
  onSave: (medicationId: string, dose: string, note: string | null, at: string | null) => void
  onCancel: () => void
}) {
  const [picked, setPicked] = useState<Medication | null>(medications.length === 1 ? medications[0] : null)
  const [dose, setDose] = useState(medications.length === 1 ? medications[0].dose : '')
  const [note, setNote] = useState('')
  const t = useTime()
  return (
    <form className={FORM} onSubmit={e => { e.preventDefault(); if (picked && dose.trim()) onSave(picked.id, dose.trim(), note.trim() || null, t.at) }}>
      <p className="text-base font-bold text-heading">Medicine</p>
      <div role="radiogroup" aria-label="Medicine" className="flex flex-col gap-2">
        {medications.map(m => {
          const on = picked?.id === m.id
          return (
            <button key={m.id} type="button" role="radio" aria-checked={on} onClick={() => { setPicked(m); setDose(m.dose) }}
              className={`rounded-xl border p-3 text-left ${on ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-border bg-white hover:bg-surface'}`}>
              <p className="text-sm font-bold text-heading">{m.name} <span className="font-semibold text-text-main">· {m.dose}</span></p>
              {m.schedule && <p className="text-xs text-text-main">{m.schedule}</p>}
              {m.instructions && <p className="mt-0.5 text-xs text-muted">{m.instructions}</p>}
            </button>
          )
        })}
      </div>
      {picked && (
        <label className="text-sm font-semibold text-text-main">Dose given
          <input value={dose} onChange={e => setDose(e.target.value)} maxLength={60} className={`${FIELD} mt-1`} />
        </label>
      )}
      <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} className={FIELD} placeholder="Note (optional)" />
      {t.field}
      <ErrorLine error={error} />
      <Buttons busy={busy} disabled={!picked || !dose.trim()} label="Given" onCancel={onCancel} />
    </form>
  )
}

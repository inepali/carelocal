'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  AMOUNTS, BATHROOM_RESULTS, BATHROOM_TYPES, BOTTLE_CONTENTS, BOTTLE_OUNCES, DIAPER_RESULTS, KIND_LABEL, MEALS,
  mealForTime, nowHHMM, timeToIso,
  type BathroomResult, type BottleContents, type DailyDetails, type DailyKind, type DiaperResult, type MealAmount, type MealName,
} from '@/lib/daily'

/** The kinds the card can log in this phase */
export type RoutineKind = Extract<DailyKind, 'meal' | 'bottle' | 'diaper' | 'bathroom' | 'activity' | 'note'>

export const FIELD = 'min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-text-main'

/** A row of big choice buttons; one is picked */
export function Choices<T extends string | number>({ label, options, value, onChange, cols }: {
  label: string
  options: { value: T; label: string }[]
  value: T | null
  onChange: (v: T) => void
  cols?: number
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
      <div role="radiogroup" aria-label={label} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols ?? Math.min(options.length, 4)}, minmax(0, 1fr))` }}>
        {options.map(o => {
          const on = o.value === value
          return (
            <button key={String(o.value)} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
              className={`min-h-11 rounded-xl border px-2 text-sm font-bold ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-text-main hover:bg-surface'}`}>
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The short form for one entry, inside the child card. The time is now unless the teacher changes it;
 * the database checks everything again.
 */
export function EntryForm({ kind, busy, error, onSave, onCancel }: {
  kind: RoutineKind
  busy: boolean
  error: string | null
  onSave: (details: DailyDetails, at: string | null) => void
  onCancel: () => void
}) {
  const [meal, setMeal] = useState<MealName>(mealForTime())
  const [amount, setAmount] = useState<MealAmount | null>(null)
  const [oz, setOz] = useState<number | null>(null)
  const [contents, setContents] = useState<BottleContents>('formula')
  const [diaper, setDiaper] = useState<DiaperResult | null>(null)
  const [cream, setCream] = useState(false)
  const [potty, setPotty] = useState<BathroomResult | null>(null)
  const [pottyType, setPottyType] = useState<'wet' | 'bm' | 'wet_bm' | null>(null)
  const [other, setOther] = useState('')
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [time, setTime] = useState(nowHHMM())
  const [timeTouched, setTimeTouched] = useState(false)

  let details: DailyDetails | null = null
  const n = note.trim() ? { note: note.trim() } : {}
  if (kind === 'meal' && amount && (amount !== 'other' || other.trim())) details = { meal, amount, ...(amount === 'other' ? { other: other.trim() } : {}), ...n }
  if (kind === 'bottle' && oz && (contents !== 'other' || other.trim())) details = { oz, contents, ...(contents === 'other' ? { other: other.trim() } : {}), ...n }
  if (kind === 'diaper' && diaper) details = { result: diaper, cream, ...n }
  if (kind === 'bathroom' && potty) details = { result: potty, ...(potty !== 'tried' && pottyType ? { type: pottyType } : {}), ...n }
  if ((kind === 'activity' || kind === 'note') && text.trim()) details = { text: text.trim() }

  return (
    <form className="flex flex-col gap-4 rounded-2xl border border-border bg-surface/40 p-3"
      onSubmit={e => { e.preventDefault(); if (details) onSave(details, timeTouched ? timeToIso(time) : null) }}>
      <p className="text-base font-bold text-heading">{KIND_LABEL[kind]}</p>

      {kind === 'meal' && (
        <>
          <Choices label="Meal" options={MEALS} value={meal} onChange={setMeal} cols={3} />
          <Choices label="How much" options={AMOUNTS} value={amount} onChange={setAmount} cols={5} />
          {amount === 'other' && <input value={other} onChange={e => setOther(e.target.value)} maxLength={100} className={FIELD} placeholder="For example: only the fruit" autoFocus />}
        </>
      )}

      {kind === 'bottle' && (
        <>
          <Choices label="Ounces" options={BOTTLE_OUNCES.map(v => ({ value: v, label: String(v) }))} value={oz} onChange={setOz} cols={6} />
          <Choices label="What was in it" options={BOTTLE_CONTENTS} value={contents} onChange={setContents} cols={4} />
          {contents === 'other' && <input value={other} onChange={e => setOther(e.target.value)} maxLength={100} className={FIELD} placeholder="What was in the bottle" autoFocus />}
        </>
      )}

      {kind === 'diaper' && (
        <>
          <Choices label="Diaper" options={DIAPER_RESULTS} value={diaper} onChange={setDiaper} />
          <Choices label="Cream" options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} value={cream ? 'yes' : 'no'} onChange={v => setCream(v === 'yes')} cols={2} />
        </>
      )}

      {kind === 'bathroom' && (
        <>
          <Choices label="Bathroom" options={BATHROOM_RESULTS} value={potty} onChange={setPotty} cols={3} />
          {potty && potty !== 'tried' && <Choices label="Wet or BM" options={BATHROOM_TYPES} value={pottyType} onChange={setPottyType} cols={3} />}
        </>
      )}

      {kind === 'activity' && (
        <div>
          <input value={text} onChange={e => setText(e.target.value)} maxLength={200} className={FIELD} placeholder="For example: painting with sponges" autoFocus />
          <p className="mt-1 text-xs text-muted">Picking from the weekly lesson plan is coming soon.</p>
        </div>
      )}
      {kind === 'note' && (
        <textarea value={text} onChange={e => setText(e.target.value)} maxLength={500} rows={3} className={`${FIELD} resize-none py-2`}
          placeholder="Mood, what they enjoyed, anything parents should know" autoFocus />
      )}

      {kind !== 'activity' && kind !== 'note' && (
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} className={FIELD} placeholder="Note (optional)" />
      )}

      <label className="flex items-center gap-2 text-sm font-semibold text-text-main">
        Time
        <input type="time" value={time} onChange={e => { setTime(e.target.value); setTimeTouched(true) }} className={`${FIELD} w-auto`} />
        {!timeTouched && <span className="text-xs font-normal text-muted">now</span>}
      </label>

      {error && <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-12 rounded-xl border border-border bg-white text-sm font-bold text-text-main hover:bg-surface">Cancel</button>
        <button type="submit" disabled={!details || busy}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
      </div>
    </form>
  )
}

const QUICK_REASONS = ['Wrong child', 'Entered twice', 'Wrong details']

/** Removing an entry asks why; the entry stays in the record, struck through */
export function VoidForm({ busy, error, onConfirm, onCancel }: {
  busy: boolean
  error: string | null
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl bg-[#fce4e2]/60 p-2">
      <div className="flex flex-wrap gap-1.5">
        {QUICK_REASONS.map(r => (
          <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r}
            className={`min-h-9 rounded-full border px-3 text-xs font-bold ${reason === r ? 'border-[#a3221b] bg-[#a3221b] text-white' : 'border-border bg-white text-text-main'}`}>{r}</button>
        ))}
      </div>
      <input value={reason} onChange={e => setReason(e.target.value)} maxLength={200} className={FIELD} placeholder="Why is it being removed?" />
      {error && <p role="alert" className="text-xs font-semibold text-[#a3221b]">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-border bg-white text-sm font-bold">Keep</button>
        <button type="button" disabled={!reason.trim() || busy} onClick={() => onConfirm(reason.trim())}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#b42318] text-sm font-bold text-white disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Remove
        </button>
      </div>
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RosterPerson, RosterRoom } from '@/lib/roster-ratio'
import { addClassEntry, AMOUNTS, MEALS, mealForTime, newKey, type MealAmount, type MealName } from '@/lib/daily'
import { Face } from './PersonAvatar'
import { Choices, FIELD } from './DailyForms'

const QUICK_AMOUNTS = AMOUNTS.filter(a => a.value !== 'other')

/**
 * Class actions: one entry per child present in the room right now (Classroom, Playground or Lobby).
 *  - Meal served: pick the meal, then one tap per child for how much they ate. Children left blank are skipped.
 *  - Activity with class: type it once; everyone ticked gets it.
 * Saved all at once; a retried Save is a no-op (one key per dialog).
 */
export function ClassEntryDialog({ supabase, centerId, room, kind, children, photos, tintOf, onClose, onDone }: {
  supabase: SupabaseClient
  centerId: string
  room: RosterRoom
  kind: 'meal' | 'activity'
  children: RosterPerson[]
  photos: Record<string, string>
  tintOf: (p: RosterPerson) => string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [key] = useState(newKey)
  const [meal, setMeal] = useState<MealName>(mealForTime())
  const [amounts, setAmounts] = useState<Record<string, MealAmount>>({})
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(children.map(c => c.person_id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items = useMemo(() => kind === 'meal'
    ? children.filter(c => amounts[c.person_id]).map(c => ({ child_id: c.person_id, details: { meal, amount: amounts[c.person_id] } }))
    : text.trim() ? children.filter(c => picked.has(c.person_id)).map(c => ({ child_id: c.person_id, details: { text: text.trim() } })) : [],
  [kind, children, amounts, meal, text, picked])

  async function save() {
    setBusy(true)
    setError(null)
    const res = await addClassEntry(supabase, centerId, kind, items, { key })
    setBusy(false)
    if (!res.success) { setError(res.error); return }
    const what = kind === 'meal' ? MEALS.find(m => m.value === meal)?.label : 'Activity'
    onDone(`${what} saved for ${res.count} ${res.count === 1 ? 'child' : 'children'}.`)
  }

  const title = kind === 'meal' ? 'Meal served' : 'Activity with class'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-900/40 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="class-h"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl border border-border bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id="class-h" className="text-xl font-black text-heading">{title}</h2>
            <p className="mt-0.5 text-[13px] text-muted">{room.name} · {children.length} {children.length === 1 ? 'child' : 'children'} here now</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-muted hover:bg-surface-2"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          {children.length === 0 ? (
            <p className="text-sm text-muted">No children are checked in to {room.name} right now.</p>
          ) : kind === 'meal' ? (
            <>
              <Choices label="Meal" options={MEALS} value={meal} onChange={setMeal} cols={3} />
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">How much each child ate</p>
                <button type="button" onClick={() => setAmounts(Object.fromEntries(children.map(c => [c.person_id, 'all' as MealAmount])))}
                  className="min-h-9 rounded-full border border-border px-3 text-xs font-bold text-brand-600 hover:bg-surface">Everyone: All</button>
              </div>
              <ul className="flex flex-col gap-2">
                {children.map(c => (
                  <li key={c.person_id} className="flex items-center gap-2">
                    <Face person={c} url={photos[c.person_id]} tint={tintOf(c)} size={36} border="2px solid #ffffff" />
                    <span className="w-24 shrink-0 truncate text-sm font-semibold text-heading">{c.first_name} {c.last_initial}.</span>
                    <div className="grid flex-1 grid-cols-4 gap-1">
                      {QUICK_AMOUNTS.map(a => {
                        const on = amounts[c.person_id] === a.value
                        return (
                          <button key={a.value} type="button" aria-pressed={on}
                            onClick={() => setAmounts(prev => { const next = { ...prev }; if (on) delete next[c.person_id]; else next[c.person_id] = a.value; return next })}
                            className={`min-h-10 rounded-lg border text-xs font-bold ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-text-main'}`}>
                            {a.label}
                          </button>
                        )
                      })}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">Children left blank are skipped. Use the child&apos;s card for anything else.</p>
            </>
          ) : (
            <>
              <div>
                <input value={text} onChange={e => setText(e.target.value)} maxLength={200} className={FIELD} placeholder="For example: circle time, counting songs" autoFocus />
                <p className="mt-1 text-xs text-muted">Picking from the weekly lesson plan is coming soon.</p>
              </div>
              <ul className="flex flex-col gap-1.5">
                {children.map(c => (
                  <li key={c.person_id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1 hover:bg-surface">
                      <input type="checkbox" checked={picked.has(c.person_id)} className="h-5 w-5 accent-brand-600"
                        onChange={e => setPicked(prev => { const next = new Set(prev); if (e.target.checked) next.add(c.person_id); else next.delete(c.person_id); return next })} />
                      <Face person={c} url={photos[c.person_id]} tint={tintOf(c)} size={32} border="2px solid #ffffff" />
                      <span className="text-sm font-semibold text-heading">{c.first_name} {c.last_initial}.</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{error}</p>}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-border text-sm font-bold text-text-main hover:bg-surface">Cancel</button>
          <button type="button" disabled={busy || items.length === 0} onClick={save}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save for {items.length}
          </button>
        </div>
      </div>
    </div>
  )
}

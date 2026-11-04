'use client'

import { useEffect, useState } from 'react'
import { BookOpen, Check, Clock, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { LESSON_RATINGS, loadTodayPlanItems, type LessonRating, type TodayPlanItem } from '@/lib/daily'

// Same field style as DailyForms (kept here so DailyForms can import this file without a cycle)
const FIELD = 'min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-text-main'

/** Today's activities from the room's approved lesson plan (empty while loading, or when there is no approved plan) */
export function useTodayPlanItems(centerId: string, roomId: string | null | undefined) {
  const [items, setItems] = useState<TodayPlanItem[]>([])
  const [loading, setLoading] = useState(!!roomId)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!roomId) { setItems([]); setLoading(false); setError(null); return }
    let ignore = false
    setLoading(true)
    loadTodayPlanItems(createClient(), centerId, roomId).then(res => {
      if (ignore) return
      // No approved plan is an empty list, not an error; a real failure (e.g. migration not applied) is shown
      setItems(res.success ? res.items : [])
      setError(res.success ? null : res.error)
      if (!res.success) console.error('[lesson-plan] daily_plan_items failed:', res.error)
      setLoading(false)
    })
    return () => { ignore = true }
  }, [centerId, roomId])
  return { items, loading, error }
}

/** Tap one of today's lesson activities; "Something else" (null) keeps the free-text path */
export function LessonChoices({ items, loading, error, value, onChange, otherLabel = 'Something else' }: {
  items: TodayPlanItem[]
  loading: boolean
  error?: string | null
  value: string | null
  onChange: (id: string | null) => void
  otherLabel?: string
}) {
  if (loading) return <p className="flex items-center gap-2 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking today&apos;s lesson plan…</p>
  if (error) return <p className="rounded-lg bg-[#fce4e2] px-3 py-2 text-xs font-semibold text-[#a3221b]">Today&apos;s lesson plan could not load: {error}</p>
  if (items.length === 0) return null
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
        <BookOpen className="h-3.5 w-3.5" /> Today&apos;s lesson plan{items[0]?.theme ? ` · ${items[0].theme}` : ''}
      </p>
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Lesson activity">
        {items.map(item => {
          const on = value === item.id
          return (
            <button key={item.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(on ? null : item.id)}
              className={`flex min-h-12 items-start gap-2 rounded-xl border px-3 py-2 text-left ${on ? 'border-brand-600 bg-brand-50' : 'border-border bg-white hover:bg-surface'}`}>
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-border'}`}>
                {on && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                {item.block && <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-700"><Clock className="h-3 w-3" /> {item.block}</span>}
                <span className="block text-sm font-bold text-heading">{item.title}</span>
                {(item.goals.length > 0 || item.children > 0) && (
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    {item.goals.map(g => <span key={g} className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-brand-700 ring-1 ring-brand-200">{g}</span>)}
                    {item.children > 0 && <span className="text-[11px] text-muted">· {item.children} logged today</span>}
                  </span>
                )}
              </span>
            </button>
          )
        })}
        <button type="button" role="radio" aria-checked={value === null} onClick={() => onChange(null)}
          className={`min-h-11 rounded-xl border px-3 text-left text-sm font-semibold ${value === null ? 'border-brand-600 bg-brand-50 text-heading' : 'border-border bg-white text-muted hover:bg-surface'}`}>
          {otherLabel}
        </button>
      </div>
    </div>
  )
}

/** Compact optional picker for photos: which lesson activity this photo shows */
export function LessonSelect({ items, value, onChange }: { items: TodayPlanItem[]; value: string | null; onChange: (id: string | null) => void }) {
  if (items.length === 0) return null
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted"><BookOpen className="h-3.5 w-3.5" /> Lesson activity (optional)</span>
      <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} className={FIELD}>
        <option value="">Not part of a lesson</option>
        {items.map(i => <option key={i.id} value={i.id}>{i.block ? `${i.block}: ` : ''}{i.title}</option>)}
      </select>
    </label>
  )
}

/** Class-level feedback on how a lesson activity went */
export function LessonFeedbackFields({ rating, note, onRating, onNote }: {
  rating: LessonRating | null
  note: string
  onRating: (r: LessonRating | null) => void
  onNote: (n: string) => void
}) {
  return (
    <div className="rounded-xl border border-border bg-surface/50 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">How did it go with the class? (optional)</p>
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        {LESSON_RATINGS.map(r => {
          const on = rating === r.value
          return (
            <button key={r.value} type="button" aria-pressed={on} onClick={() => onRating(on ? null : r.value)}
              className={`min-h-10 rounded-lg border text-xs font-bold ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-text-main'}`}>
              {r.label}
            </button>
          )
        })}
      </div>
      <textarea value={note} onChange={e => onNote(e.target.value)} maxLength={1000} rows={2} className={`${FIELD} resize-none py-2`}
        placeholder="What worked, what to change next time" />
    </div>
  )
}

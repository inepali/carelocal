'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RosterPerson, RosterRoom } from '@/lib/roster-ratio'
import {
  clockTime, endNaps, newKey, nextCheck, nowHHMM, recordSleepChecks, sleepChecksRequired, startNaps, timeToIso,
  type RoomNap, type SleepStatus,
} from '@/lib/daily'
import { Face } from './PersonAvatar'
import { FIELD } from './DailyForms'

export type RoomNapMode = 'start' | 'check' | 'wake'

const SHORT: { value: SleepStatus; label: string }[] = [
  { value: 'back', label: 'On back' },
  { value: 'other', label: 'Other' },
  { value: 'restless', label: 'Restless' },
  { value: 'awake', label: 'Awake' },
]

/**
 * Room nap actions for the children checked in to the room:
 *  - Nap time: start a nap for everyone ticked (children already asleep are not listed).
 *  - Sleep check: one status per sleeping child on one screen, with each child's due time.
 *  - Everyone up: end the naps of everyone ticked.
 */
export function RoomNapDialog({ supabase, centerId, room, mode, children, naps, photos, tintOf, onClose, onDone }: {
  supabase: SupabaseClient
  centerId: string
  room: RosterRoom
  mode: RoomNapMode
  /** Children checked in to the room now */
  children: RosterPerson[]
  naps: RoomNap[]
  photos: Record<string, string>
  tintOf: (p: RosterPerson) => string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const napOf = useMemo(() => new Map(naps.map(n => [n.child_id, n])), [naps])
  const list = mode === 'start' ? children.filter(c => !napOf.has(c.person_id)) : children.filter(c => napOf.has(c.person_id))
  const [key] = useState(newKey)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(list.map(c => c.person_id)))
  const [statuses, setStatuses] = useState<Record<string, SleepStatus>>({})
  const [time, setTime] = useState(nowHHMM())
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = new Date()

  const count = mode === 'check' ? list.filter(c => statuses[c.person_id]).length : list.filter(c => picked.has(c.person_id)).length
  const infantOther = mode === 'check' && list.some(c => statuses[c.person_id] === 'other' && sleepChecksRequired(c.age_months))

  async function save() {
    setBusy(true)
    setError(null)
    const at = touched ? timeToIso(time) : null
    const ids = list.filter(c => picked.has(c.person_id)).map(c => c.person_id)
    const res = mode === 'start' ? await startNaps(supabase, centerId, ids, { at, key })
      : mode === 'wake' ? await endNaps(supabase, centerId, ids, at)
      : await recordSleepChecks(supabase, centerId, list.filter(c => statuses[c.person_id]).map(c => ({ child_id: c.person_id, status: statuses[c.person_id] })), { at, key })
    setBusy(false)
    if (!res.success) { setError(res.error); return }
    const n = res.count
    const kids = `${n} ${n === 1 ? 'child' : 'children'}`
    onDone(mode === 'start' ? `Nap started for ${kids}.` : mode === 'wake' ? `${kids} up from nap.` : `Sleep check saved for ${kids}.`)
  }

  const title = mode === 'start' ? 'Nap time' : mode === 'check' ? 'Sleep check' : 'Everyone up'
  const empty = mode === 'start' ? `Everyone checked in to ${room.name} is already napping, or no one is checked in.` : `No one in ${room.name} is napping.`

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-900/40 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="nap-h"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl border border-border bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id="nap-h" className="text-xl font-black text-heading">{title}</h2>
            <p className="mt-0.5 text-[13px] text-muted">{room.name} · {list.length} {list.length === 1 ? 'child' : 'children'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-muted hover:bg-surface-2"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          {list.length === 0 ? <p className="text-sm text-muted">{empty}</p> : mode === 'check' ? (
            <>
              <div className="flex justify-end">
                <button type="button" onClick={() => setStatuses(Object.fromEntries(list.map(c => [c.person_id, 'back' as SleepStatus])))}
                  className="min-h-9 rounded-full border border-border px-3 text-xs font-bold text-brand-600 hover:bg-surface">Everyone: On back</button>
              </div>
              <ul className="flex flex-col gap-3">
                {list.map(c => {
                  const nap = napOf.get(c.person_id)!
                  const req = sleepChecksRequired(c.age_months)
                  const next = nextCheck({ at: nap.started_at, last_check_at: nap.last_check_at }, nap.check_minutes, now)
                  return (
                    <li key={c.person_id} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <Face person={c} url={photos[c.person_id]} tint={tintOf(c)} size={32} border="2px solid #ffffff" />
                        <span className="text-sm font-semibold text-heading">{c.first_name} {c.last_initial}.</span>
                        <span className={`ml-auto text-xs ${req && next.overdue ? 'font-bold text-[#7a4b00]' : 'text-muted'}`}>
                          {req ? (next.overdue ? 'Due now' : `Due in ${next.minutesLeft} min`) : 'Optional'}
                          {nap.last_check_at ? ` · last ${clockTime(nap.last_check_at)}` : ''}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {SHORT.map(s => {
                          const on = statuses[c.person_id] === s.value
                          return (
                            <button key={s.value} type="button" aria-pressed={on}
                              onClick={() => setStatuses(prev => { const next = { ...prev }; if (on) delete next[c.person_id]; else next[c.person_id] = s.value; return next })}
                              className={`min-h-10 rounded-lg border text-xs font-bold ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-text-main'}`}>
                              {s.label}
                            </button>
                          )
                        })}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {infantOther && (
                <p className="flex items-start gap-2 rounded-xl bg-[#fff0d1] px-3 py-2 text-sm font-bold text-[#7a4b00]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Place babies 12 months and under on their backs to sleep.
                </p>
              )}
            </>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {list.map(c => {
                const nap = napOf.get(c.person_id)
                return (
                  <li key={c.person_id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1 hover:bg-surface">
                      <input type="checkbox" checked={picked.has(c.person_id)} className="h-5 w-5 accent-brand-600"
                        onChange={e => setPicked(prev => { const next = new Set(prev); if (e.target.checked) next.add(c.person_id); else next.delete(c.person_id); return next })} />
                      <Face person={c} url={photos[c.person_id]} tint={tintOf(c)} size={32} border="2px solid #ffffff" />
                      <span className="text-sm font-semibold text-heading">{c.first_name} {c.last_initial}.</span>
                      {nap && <span className="ml-auto text-xs text-muted">asleep {clockTime(nap.started_at)}</span>}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          {list.length > 0 && (
            <label className="flex items-center gap-2 text-sm font-semibold text-text-main">
              Time
              <input type="time" value={time} onChange={e => { setTime(e.target.value); setTouched(true) }} className={`${FIELD} w-auto`} />
              {!touched && <span className="text-xs font-normal text-muted">now</span>}
            </label>
          )}
          {error && <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{error}</p>}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-border text-sm font-bold text-text-main hover:bg-surface">Cancel</button>
          <button type="button" disabled={busy || count === 0} onClick={save}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save for {count}
          </button>
        </div>
      </div>
    </div>
  )
}

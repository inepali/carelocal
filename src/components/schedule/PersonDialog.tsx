'use client'

import { useState } from 'react'
import { Loader2, RotateCcw, Undo2, UserX, X } from 'lucide-react'
import { showConfirm } from '@/lib/dialog'
import {
  ABSENCE_LABELS, formatRange, formatTime, shortName, timeOptions, toMinutes,
  type AbsenceKind, type DayPayload, type DayPerson,
} from '@/lib/schedule'

const FIELD = 'min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-text-main'
const KINDS = Object.keys(ABSENCE_LABELS) as AbsenceKind[]

/** One person on the day: their boxes, a call-out (whole day or from/until), undoing it, or a reset to their fixed schedule */
export function PersonDialog({ person, data, onCallOut, onUndo, onReset, onClose }: {
  person: DayPerson
  data: DayPayload
  onCallOut: (kind: AbsenceKind, start: string | null, end: string | null, note: string | null) => Promise<string | null>
  onUndo: () => Promise<string | null>
  onReset: () => Promise<string | null>
  onClose: () => void
}) {
  const s = data.settings
  const sub = person.kind === 'sub'
  const mine = data.blocks.filter(b => b.staff_id === person.staff_id)
  const roomName = (id: string | null) => (id ? data.rooms.find(r => r.id === id)?.name ?? 'Floaters' : 'Floaters')
  const times = timeOptions(s.day_start, s.day_end, s.slot_minutes)
  const a = person.absence
  const [kind, setKind] = useState<AbsenceKind>(a?.kind ?? 'called_out')
  const [whole, setWhole] = useState(a ? a.start === null : true)
  const [from, setFrom] = useState(a?.start ?? times[0])
  const [until, setUntil] = useState(a?.end ?? times.at(-1)!)
  const [note, setNote] = useState(a?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const invalid = !whole && toMinutes(until) <= toMinutes(from)

  async function run(fn: () => Promise<string | null>) {
    setBusy(true)
    setError('')
    const err = await fn()
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-900/40 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="person-h"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="max-h-[95vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id="person-h" className="text-xl font-black text-heading">{shortName(person)}</h2>
            <p className="mt-1 text-[13px] text-muted">
              {mine.length ? mine.map(b => `${b.kind === 'break' ? 'Break' : b.kind === 'cover' ? `Break cover · ${roomName(b.room_id)}` : roomName(b.room_id)} ${formatRange(b.start, b.end)}`).join(' · ') : 'Not on the board today'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-surface"><X className="h-5 w-5" /></button>
        </div>

        {sub ? (
          <div className="px-6 py-5 text-sm text-muted">
            {shortName(person)} is here on a substitute shift. Their hours come from the shift; change or cancel it on the Shifts page.
            You can still drag their box to another room.
          </div>
        ) : (
          <div className="space-y-4 px-6 py-5">
            {a && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#f5b5ae] bg-[#fdf0ee] px-3 py-2">
                <span className="text-sm font-semibold text-[#a3221b]">
                  {ABSENCE_LABELS[a.kind]} {a.start ? `${formatTime(a.start)} to ${formatTime(a.end!)}` : 'all day'}{a.note ? ` · ${a.note}` : ''}
                </span>
                <button type="button" disabled={busy} onClick={() => run(onUndo)}
                  className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[13px] font-bold text-text-main hover:bg-surface disabled:opacity-50">
                  <Undo2 className="h-4 w-4" /> Undo
                </button>
              </div>
            )}

            <fieldset className="space-y-3 rounded-2xl border border-border p-3">
              <legend className="flex items-center gap-1.5 px-1 text-sm font-bold text-heading"><UserX className="h-4 w-4 text-[#a3221b]" /> {a ? 'Change the call-out' : 'Call out'}</legend>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map(k => (
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                    className={`min-h-9 rounded-full border px-3 text-[13px] font-semibold ${kind === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-text-main hover:bg-surface'}`}>
                    {ABSENCE_LABELS[k]}
                  </button>
                ))}
              </div>
              <div className="flex gap-4 text-sm text-text-main">
                <label className="flex items-center gap-2"><input type="radio" checked={whole} onChange={() => setWhole(true)} className="accent-brand-600" /> Whole day</label>
                <label className="flex items-center gap-2"><input type="radio" checked={!whole} onChange={() => setWhole(false)} className="accent-brand-600" /> Part of the day</label>
              </div>
              {!whole && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[12px] font-semibold text-muted">Out from
                    <select value={from} onChange={e => setFrom(e.target.value)} className={`${FIELD} mt-1`}>
                      {times.slice(0, -1).map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                    </select>
                  </label>
                  <label className="text-[12px] font-semibold text-muted">Until
                    <select value={until} onChange={e => setUntil(e.target.value)} className={`${FIELD} mt-1`}>
                      {times.slice(1).map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                    </select>
                  </label>
                </div>
              )}
              <input value={note} maxLength={200} onChange={e => setNote(e.target.value)} placeholder="Note (optional, admins only)" className={FIELD} />
              <p className="text-[12px] text-muted">Their boxes in that time come off the board and the room shows the gap. Undo puts their fixed schedule back.</p>
              <button type="button" disabled={busy || invalid} onClick={() => run(() => onCallOut(kind, whole ? null : from, whole ? null : until, note.trim() || null))}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#b42318] px-4 text-sm font-bold text-white hover:bg-[#912018] disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} {a ? 'Update call-out' : `Call out ${shortName(person)}`}
              </button>
            </fieldset>

            <button type="button" disabled={busy} onClick={async () => {
              if (await showConfirm(`Replace ${shortName(person)}'s boxes today with their fixed schedule?`, { title: 'Reset to fixed schedule', confirmLabel: 'Reset' })) run(onReset)
            }}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm font-bold text-text-main hover:bg-surface disabled:opacity-50">
              <RotateCcw className="h-4 w-4" /> Reset to fixed schedule
            </button>
            {(invalid || error) && <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{invalid ? 'Until has to be after out from.' : error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

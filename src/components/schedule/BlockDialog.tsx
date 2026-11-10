'use client'

import { useState } from 'react'
import { ArrowRightLeft, Loader2, Trash2, UserCog, X } from 'lucide-react'
import {
  formatTime, overlapsOwn, shortName, timeOptions, toMinutes,
  type DayBlock, type DayPayload, type DayPerson,
} from '@/lib/schedule'
import type { DayOp } from './useScheduleDay'

const FIELD = 'min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-text-main disabled:bg-surface disabled:text-muted'

/** One box: change its hours, room or note; move the rest of the day to another room; or take it off the board */
export function BlockDialog({ block, person, data, onApply, onPerson, onClose }: {
  block: DayBlock
  person: DayPerson
  data: DayPayload
  onApply: (ops: DayOp[]) => Promise<string | null>
  /** Opens the person (call-out, reset) */
  onPerson: () => void
  onClose: () => void
}) {
  const s = data.settings
  const sub = !!block.shift_claim_id
  const [start, setStart] = useState(block.start)
  const [end, setEnd] = useState(block.end)
  const [room, setRoom] = useState(block.room_id ?? '')
  const [note, setNote] = useState(block.note ?? '')
  const splitChoices = timeOptions(block.start, block.end, s.slot_minutes).filter(t => t !== block.start && t !== block.end)
  const [at, setAt] = useState(splitChoices[Math.floor(splitChoices.length / 2)] ?? '')
  const [moveTo, setMoveTo] = useState(() => data.rooms.find(r => r.id !== block.room_id)?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const options = (keep: string) => timeOptions(s.day_start, s.day_end, s.slot_minutes, [keep])
  const changed = start !== block.start || end !== block.end || (room || null) !== block.room_id || (note.trim() || null) !== (block.note ?? null)
  const problem = toMinutes(end) <= toMinutes(start) ? 'The box has to end after it starts.'
    : overlapsOwn(data.blocks, block.staff_id, start, end, block.id) ? `${shortName(person)} already has another box in those hours.` : ''

  async function run(ops: DayOp[]) {
    setBusy(true)
    setError('')
    const err = await onApply(ops)
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  const save = () => run([sub
    ? { op: 'update', id: block.id, room_id: room || null, note: note.trim() || null }
    : { op: 'update', id: block.id, start, end, room_id: room || null, note: note.trim() || null }])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-900/40 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="block-h"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="max-h-[95vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id="block-h" className="text-xl font-black text-heading">{shortName(person)}{sub && <span className="ml-2 rounded bg-[#ede9fe] px-1.5 py-0.5 align-middle text-[11px] font-bold uppercase text-[#4c1d95]">Substitute</span>}</h2>
            <p className="mt-1 text-[13px] text-muted">{formatTime(block.start)} to {formatTime(block.end)}{block.source === 'fixed' ? ' · from their fixed schedule' : block.source === 'added' ? ' · added for today' : ' · from their shift'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-surface"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[13px] font-semibold text-text-main">From
              <select value={start} disabled={sub} onChange={e => setStart(e.target.value)} className={`${FIELD} mt-1`}>
                {options(start).filter(t => toMinutes(t) < toMinutes(s.day_end)).map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
              </select>
            </label>
            <label className="text-[13px] font-semibold text-text-main">Until
              <select value={end} disabled={sub} onChange={e => setEnd(e.target.value)} className={`${FIELD} mt-1`}>
                {options(end).filter(t => toMinutes(t) > toMinutes(s.day_start)).map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
              </select>
            </label>
          </div>
          {sub && <p className="-mt-2 text-[12px] text-muted">A substitute&apos;s hours come from their shift. You can move them to another room.</p>}
          <label className="block text-[13px] font-semibold text-text-main">Room
            <select value={room} onChange={e => setRoom(e.target.value)} className={`${FIELD} mt-1`}>
              <option value="">Floaters (no room yet)</option>
              {data.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="block text-[13px] font-semibold text-text-main">Note
            <input value={note} maxLength={200} onChange={e => setNote(e.target.value)} placeholder="e.g. lunch cover" className={`${FIELD} mt-1`} />
          </label>
          <button type="button" disabled={busy || !changed || !!problem} onClick={save}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
          </button>

          {splitChoices.length > 0 && (
            <div className="rounded-2xl border border-border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-heading"><ArrowRightLeft className="h-4 w-4 text-brand-600" /> Move to another room partway</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[12px] font-semibold text-muted">From
                  <select value={at} onChange={e => setAt(e.target.value)} className={`${FIELD} mt-1`}>
                    {splitChoices.map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                  </select>
                </label>
                <label className="text-[12px] font-semibold text-muted">To
                  <select value={moveTo} onChange={e => setMoveTo(e.target.value)} className={`${FIELD} mt-1`}>
                    <option value="">Floaters</option>
                    {data.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>
              </div>
              <button type="button" disabled={busy || !at || (moveTo || null) === block.room_id} onClick={() => run([{ op: 'split', id: block.id, at, room_id: moveTo || null }])}
                className="mt-2 inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-border px-3 text-sm font-bold text-text-main hover:bg-surface disabled:opacity-50">
                Move from {at ? formatTime(at) : '…'} until {formatTime(block.end)}
              </button>
            </div>
          )}

          {(problem || error) && <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{problem || error}</p>}
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-between">
          {!sub && (
            <button type="button" disabled={busy} onClick={() => run([{ op: 'remove', id: block.id }])}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-[#a3221b] hover:bg-[#fce4e2] disabled:opacity-50">
              <Trash2 className="h-4 w-4" /> Take off the board
            </button>
          )}
          {!sub && (
            <button type="button" onClick={onPerson}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm font-bold text-text-main hover:bg-surface">
              <UserCog className="h-4 w-4" /> Call out or reset {shortName(person)}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


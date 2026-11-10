'use client'

import { useMemo, useState } from 'react'
import { Coffee, Loader2, Trash2, X } from 'lucide-react'
import { formatTime, shortName, timeOptions, toMinutes, type DayBlock, type DayPayload } from '@/lib/schedule'
import type { DayOp } from './useScheduleDay'

const FIELD = 'min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-text-main'

/**
 * A break box (move it in time, or remove it and give the time back) or a break cover box (who is on it, its room
 * and hours, or remove it). Someone on a cover is a regular teacher or a substitute here today; the database checks
 * they are free then (Floaters time is taken for it) and not on a break or off.
 */
export function BreakCoverDialog({ block, data, onApply, onClose }: {
  block: DayBlock
  data: DayPayload
  onApply: (ops: DayOp[]) => Promise<string | null>
  onClose: () => void
}) {
  const s = data.settings
  const isCover = block.kind === 'cover'
  const owner = data.people.find(p => p.staff_id === block.staff_id) ?? null
  const [start, setStart] = useState(block.start)
  const [end, setEnd] = useState(block.end)
  const [room, setRoom] = useState(block.room_id ?? data.rooms[0]?.id ?? '')
  const [who, setWho] = useState(block.staff_id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const times = timeOptions(s.day_start, s.day_end, s.slot_minutes, [block.start, block.end])
  const roomName = (id: string | null) => (id ? data.rooms.find(r => r.id === id)?.name ?? 'a room' : 'Floaters')

  // Who could cover: regular teachers not off all day, and substitutes here today; with a hint of where they are then
  const choices = useMemo(() => data.people
    .filter(p => !(p.absence && p.absence.start === null))
    .map(p => {
      const busyThen = data.blocks.filter(b => b.staff_id === p.staff_id && b.id !== block.id
        && toMinutes(b.start) < toMinutes(end) && toMinutes(b.end) > toMinutes(start))
      const hint = p.staff_id === block.staff_id ? 'on it now'
        : busyThen.length === 0 ? (p.kind === 'sub' ? 'substitute' : 'free')
        : busyThen.some(b => b.kind === 'break') ? 'on a break then'
        : busyThen.some(b => b.kind === 'cover') ? 'covering then'
        : busyThen.every(b => b.room_id === null) ? 'floater'
        : `in ${roomName(busyThen[0].room_id)}`
      return { p, hint, order: hint === 'floater' || hint === 'free' ? 0 : hint === 'substitute' ? 1 : 2 }
    })
    .sort((a, b) => a.order - b.order || shortName(a.p).localeCompare(shortName(b.p))), [data, block, start, end]) // eslint-disable-line react-hooks/exhaustive-deps

  const invalid = toMinutes(end) <= toMinutes(start)
  const changed = start !== block.start || end !== block.end || (isCover && (room !== block.room_id || (who || null) !== block.staff_id))

  async function run(ops: DayOp[]) {
    setBusy(true)
    setError('')
    const err = await onApply(ops)
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  function save() {
    if (!isCover) return run([{ op: 'update', id: block.id, start, end }])
    const ops: DayOp[] = []
    if (start !== block.start || end !== block.end || room !== block.room_id) ops.push({ op: 'update', id: block.id, start, end, room_id: room })
    if ((who || null) !== block.staff_id) ops.push({ op: 'assign', id: block.id, staff_id: who || null })
    return run(ops)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-900/40 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="bc-h"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className={`max-h-[95vh] w-full max-w-md overflow-y-auto rounded-t-3xl border bg-white shadow-2xl sm:rounded-3xl ${isCover ? 'border-2 border-[#dc2626]' : 'border-border'}`}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id="bc-h" className={`flex items-center gap-2 text-xl font-black ${isCover ? 'text-[#a3221b]' : 'text-heading'}`}>
              <Coffee className="h-5 w-5" /> {isCover ? 'Break cover' : `${owner ? shortName(owner) : 'Staff'} · break`}
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              {isCover
                ? `${roomName(block.room_id)} · ${formatTime(block.start)} to ${formatTime(block.end)} · ${owner ? shortName(owner) : 'needs someone'}`
                : `${formatTime(block.start)} to ${formatTime(block.end)} in ${roomName(block.room_id)}. Breaks don't count toward the room's ratio.`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-surface"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {isCover && (
            <label className="block text-[13px] font-semibold text-text-main">Who covers
              <select value={who} onChange={e => setWho(e.target.value)} className={`${FIELD} mt-1`}>
                <option value="">Needs someone</option>
                {choices.map(({ p, hint }) => <option key={p.staff_id} value={p.staff_id}>{shortName(p)} ({hint})</option>)}
              </select>
              <span className="mt-1 block text-[12px] font-normal text-muted">A floater&apos;s time is taken for it, and given back if they come off it.</span>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[13px] font-semibold text-text-main">From
              <select value={start} onChange={e => setStart(e.target.value)} className={`${FIELD} mt-1`}>
                {times.filter(t => toMinutes(t) < toMinutes(s.day_end)).map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
              </select>
            </label>
            <label className="text-[13px] font-semibold text-text-main">Until
              <select value={end} onChange={e => setEnd(e.target.value)} className={`${FIELD} mt-1`}>
                {times.filter(t => toMinutes(t) > toMinutes(s.day_start)).map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
              </select>
            </label>
          </div>
          {isCover && (
            <label className="block text-[13px] font-semibold text-text-main">Room
              <select value={room} onChange={e => setRoom(e.target.value)} className={`${FIELD} mt-1`}>
                {data.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          )}
          <button type="button" disabled={busy || invalid || !changed} onClick={save}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
          {(invalid || error) && <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{invalid ? 'It has to end after it starts.' : error}</p>}
        </div>

        <div className="border-t border-border px-6 py-4">
          <button type="button" disabled={busy} onClick={() => run([{ op: 'remove', id: block.id }])}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-[#a3221b] hover:bg-[#fce4e2] disabled:opacity-50">
            <Trash2 className="h-4 w-4" /> {isCover ? 'Remove this break cover' : 'Remove the break (the time goes back to them)'}
          </button>
        </div>
      </div>
    </div>
  )
}

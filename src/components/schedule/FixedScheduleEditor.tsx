'use client'

import { useMemo, useState } from 'react'
import { CalendarClock, Copy, Loader2, Plus, Trash2, X } from 'lucide-react'
import {
  WEEKDAY_NAMES, blockHours, checkPattern, copyDay, formatDate, formatHours, formatTime, fromMinutes, scheduleWeekdays,
  shortName, sortBlocks, timeOptions, toMinutes,
  type FixedBlock, type FixedStaff, type ScheduleRoom, type ScheduleSettings, type Weekday,
} from '@/lib/schedule'

const FIELD = 'min-h-10 rounded-xl border border-border bg-white px-2.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30'

/**
 * One teacher's fixed weekly schedule: blocks per weekday with a room (or Floater), saved from a start date on.
 * Saving with no blocks makes them a floater from that date.
 */
export function FixedScheduleEditor({ person, rooms, settings, viewingOn, onSave, onClose }: {
  person: FixedStaff
  rooms: ScheduleRoom[]
  settings: ScheduleSettings
  /** The day the page is showing; the start date defaults to it */
  viewingOn: string
  onSave: (effectiveFrom: string, blocks: FixedBlock[], effectiveTo: string | null) => Promise<string | null>
  onClose: () => void
}) {
  const days = scheduleWeekdays(settings.weekends)
  const [blocks, setBlocks] = useState<FixedBlock[]>(() =>
    person.blocks.map(b => ({ weekday: b.weekday, start: b.start, end: b.end, room_id: b.room_id, notes: b.notes ?? '' })))
  const [from, setFrom] = useState(viewingOn < settings.today ? settings.today : viewingOn)
  const [until, setUntil] = useState('')
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState('')

  const untilProblem = until && until < from ? 'The end date has to be on or after the start date.' : null
  const problem = useMemo(() => checkPattern(blocks, settings), [blocks, settings]) ?? untilProblem
  const replacesLater = !until && person.next_change && person.next_change > from ? person.next_change : null
  const currentEnds = person.blocks.find(b => b.to)?.to ?? null
  const weekHours = blockHours(blocks)
  const defaultRoom = person.home_room_id && rooms.some(r => r.id === person.home_room_id) ? person.home_room_id : null

  const update = (i: number, patch: Partial<FixedBlock>) => setBlocks(prev => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  const remove = (i: number) => setBlocks(prev => prev.filter((_, j) => j !== i))

  function addBlock(day: Weekday) {
    setBlocks(prev => {
      const mine = prev.filter(b => b.weekday === day)
      const dayEnd = toMinutes(settings.day_end)
      const start = mine.length ? Math.max(...mine.map(b => toMinutes(b.end))) : toMinutes(settings.day_start)
      if (start >= dayEnd) return prev
      // A new day starts as a full 8-hour shift; a second block fills 2 hours after the last one
      const end = Math.min(dayEnd, start + (mine.length ? 120 : 480))
      return sortBlocks([...prev, { weekday: day, start: fromMinutes(start), end: fromMinutes(end), room_id: mine.at(-1)?.room_id ?? defaultRoom, notes: '' }])
    })
  }

  async function save() {
    if (problem) return
    setBusy(true)
    setServerError('')
    const err = await onSave(from, sortBlocks(blocks), until || null)
    setBusy(false)
    if (err) setServerError(err)
    else onClose()
  }

  const firstDay = days.find(d => blocks.some(b => b.weekday === d))
  const options = (keep: string[]) => timeOptions(settings.day_start, settings.day_end, settings.slot_minutes, keep)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="fixed-h"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="flex max-h-[95vh] w-full max-w-3xl flex-col rounded-t-3xl border border-border bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="fixed-h" className="flex items-center gap-2 text-xl font-black text-heading"><CalendarClock className="h-5 w-5 shrink-0 text-brand-600" /> {shortName(person)} · fixed schedule</h2>
            <p className="mt-1 text-[13px] text-muted">Their usual week. Leave a day empty and they come in as a floater that day.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-surface"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[13px] font-semibold text-text-main">Starts on
              <input type="date" value={from} min={settings.today} onChange={e => setFrom(e.target.value || settings.today)} className={`${FIELD} mt-1 block`} />
            </label>
            <label className="text-[13px] font-semibold text-text-main">Until <span className="font-normal text-muted">(optional)</span>
              <span className="mt-1 flex items-center gap-1">
                <input type="date" value={until} min={from} onChange={e => setUntil(e.target.value)} className={`${FIELD} block`} />
                {until && <button type="button" onClick={() => setUntil('')} aria-label="No end date" className="rounded-lg p-2 text-muted hover:bg-surface"><X className="h-4 w-4" /></button>}
              </span>
            </label>
            {firstDay !== undefined && (
              <button type="button" onClick={() => setBlocks(prev => copyDay(prev, firstDay, days))}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold text-text-main hover:bg-surface">
                <Copy className="h-4 w-4" /> Copy {WEEKDAY_NAMES[firstDay]} to every day
              </button>
            )}
            <span className="ml-auto text-sm font-bold text-text-main">{formatHours(weekHours)} a week</span>
          </div>
          <p className="text-[13px] text-muted">
            {until
              ? <>Applies {formatDate(from)} to {formatDate(until)} only. Before and after, the schedule they have stays (if there is none after, they&apos;re a floater from then).</>
              : <>Applies from {formatDate(from)} on, with no end date. Days before keep the schedule they had.</>}
            {replacesLater && <strong className="text-[#8a5a00]"> A change already saved for {formatDate(replacesLater)} will be replaced.</strong>}
            {currentEnds && !until && <> Their current schedule runs until {formatDate(currentEnds)}.</>}
          </p>

          <ul className="divide-y divide-border rounded-2xl border border-border">
            {days.map(day => {
              const list = blocks.map((b, i) => ({ b, i })).filter(x => x.b.weekday === day)
              return (
                <li key={day} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:px-4">
                  <div className="flex w-full items-center justify-between sm:w-28 sm:flex-col sm:items-start sm:pt-2">
                    <span className="text-sm font-bold text-heading">{WEEKDAY_NAMES[day]}</span>
                    <span className="text-xs text-muted">{list.length ? formatHours(blockHours(list.map(x => x.b))) : 'Floater'}</span>
                  </div>
                  <div className="flex-1 space-y-2">
                    {list.map(({ b, i }) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <select aria-label={`${WEEKDAY_NAMES[day]} start`} value={b.start} onChange={e => update(i, { start: e.target.value })} className={FIELD}>
                          {options([b.start]).filter(t => toMinutes(t) < toMinutes(settings.day_end)).map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                        </select>
                        <span className="text-sm text-muted">to</span>
                        <select aria-label={`${WEEKDAY_NAMES[day]} end`} value={b.end} onChange={e => update(i, { end: e.target.value })} className={FIELD}>
                          {options([b.end]).filter(t => toMinutes(t) > toMinutes(settings.day_start)).map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                        </select>
                        <select aria-label={`${WEEKDAY_NAMES[day]} room`} value={b.room_id ?? ''} onChange={e => update(i, { room_id: e.target.value || null })} className={`${FIELD} min-w-36 flex-1`}>
                          <option value="">Floater (room picked each day)</option>
                          {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        <input aria-label={`${WEEKDAY_NAMES[day]} note`} value={b.notes ?? ''} maxLength={200} placeholder="Note (optional)"
                          onChange={e => update(i, { notes: e.target.value })} className={`${FIELD} w-full sm:w-40`} />
                        <button type="button" onClick={() => remove(i)} aria-label={`Remove ${WEEKDAY_NAMES[day]} ${formatTime(b.start)} block`}
                          className="rounded-lg p-2 text-muted hover:bg-[#fce4e2] hover:text-[#a3221b]"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                    {list.length < 6 && (
                      <button type="button" onClick={() => addBlock(day)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-bold text-brand-700 hover:bg-brand-50">
                        <Plus className="h-4 w-4" /> {list.length ? 'Add another block' : 'Add hours'}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {(problem || serverError) && (
            <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{problem ?? serverError}</p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <button type="button" disabled={busy || blocks.length === 0} onClick={() => setBlocks([])}
            className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold text-muted hover:bg-surface disabled:opacity-40">
            Clear the week (floater)
          </button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-bold text-text-main hover:bg-surface">Cancel</button>
            <button type="button" disabled={busy || !!problem} onClick={save}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save {until ? `${formatDate(from)} – ${formatDate(until)}` : `from ${formatDate(from)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

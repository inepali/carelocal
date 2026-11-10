'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, ChevronLeft, ChevronRight, Loader2, Send, UserX, X } from 'lucide-react'
import {
  ABSENCE_LABELS, addDays, applyDrag, boxPosition, coverage, coverageTone, dragMinutes, dropBlock, formatDate, formatRange,
  formatTime, hourMarks, minutesAt, overlapsOwn, packLanes, shortName, teachersNeeded,
  type DayBlock, type DayPayload, type DayPerson, type DragMode,
} from '@/lib/schedule'
import { useScheduleDay, type DayOp } from './useScheduleDay'
import { notifySchedule } from '@/app/actions/schedule.actions'
import { BlockDialog } from './BlockDialog'
import { PersonDialog } from './PersonDialog'

const LANE_H = 40
const ROW_PAD = 8
const STRIP_H = 5
const MOVE_PX = 4                     // below this a press is a tap (opens the box), not a drag
const FLOATER = 'floater'

type Preview = { start: string; end: string; rowKey: string }
type Drag =
  | { kind: 'block'; block: DayBlock; mode: DragMode; x0: number; y0: number; moved: boolean; preview: Preview }
  | { kind: 'person'; person: DayPerson; x0: number; y0: number; x: number; y: number; moved: boolean; preview: Preview | null }

const rowKeyOf = (roomId: string | null) => roomId ?? FLOATER
const roomOfKey = (key: string) => (key === FLOATER ? null : key)

/** The row under a screen point, and that row's timeline box */
function rowAt(x: number, y: number): { key: string; rect: DOMRect } | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-row-key]') as HTMLElement | null
  return el ? { key: el.dataset.rowKey!, rect: el.getBoundingClientRect() } : null
}

/**
 * Owner/admin: one day's schedule. Rooms top to bottom (plus Floaters), the day left to right, one box per person
 * block. Drag a box to move it (another room and/or time), drag an edge to change its hours, drag someone from
 * Available onto a room to add them. Tap a box or a person for times, moves, call-outs and resets.
 */
export default function DailyBoard({ centerId }: { centerId: string }) {
  const [date, setDate] = useState<string | null>(null)
  const { data, loading, error, busy, reload, apply, callOut, undoCallOut, resetPerson, publish } = useScheduleDay(centerId, date)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [notifying, setNotifying] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const [pending, setPending] = useState<{ blockId?: string; preview: Preview; staffId: string } | null>(null)
  const [openBlockId, setOpenBlockId] = useState<string | null>(null)
  const [openStaffId, setOpenStaffId] = useState<string | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)

  const report = useCallback((err: string | null) => { setMessage(err ?? ''); if (err) setNotice('') }, [])

  /** Tell everyone whose day changed since their last notice (on the first publish: everyone on the day) */
  const notify = useCallback(async (day: string, after?: string) => {
    setNotifying(true)
    const res = await notifySchedule(centerId, day)
    setNotifying(false)
    if (!res.success) { setMessage(res.error); return }
    setMessage('')
    setNotice(`${after ? `${after} ` : ''}${res.count === 0 ? 'Nobody needed a notice.' : `${res.count} ${res.count === 1 ? 'person was' : 'people were'} notified.`}`)
    await reload()
  }, [centerId, reload])

  /** One change from a drag; the box stays where it was dropped until the answer comes back */
  const commit = useCallback(async (ops: DayOp[], shown: { blockId?: string; preview: Preview; staffId: string }) => {
    setPending(shown)
    const err = await apply(ops)
    setPending(null)
    report(err)
  }, [apply, report])

  // Pointer moves and the drop, while a drag is on
  useEffect(() => {
    if (!drag || !data) return
    const s = data.settings
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const moved = d.moved || Math.abs(e.clientX - d.x0) > MOVE_PX || Math.abs(e.clientY - d.y0) > MOVE_PX
      if (d.kind === 'block') {
        const width = timelineRef.current?.getBoundingClientRect().width ?? 0
        const sub = !!d.block.shift_claim_id
        const times = sub ? { start: d.block.start, end: d.block.end }
          : applyDrag(d.block, d.mode, dragMinutes(e.clientX - d.x0, width, s.day_start, s.day_end), s.slot_minutes, s.day_start, s.day_end)
        const row = d.mode === 'move' ? rowAt(e.clientX, e.clientY)?.key ?? d.preview.rowKey : rowKeyOf(d.block.room_id)
        setDrag({ ...d, moved, preview: { ...times, rowKey: row } })
      } else {
        const row = rowAt(e.clientX, e.clientY)
        const preview = row ? { ...dropBlock(minutesAt(e.clientX - row.rect.left, row.rect.width, s.day_start, s.day_end, s.slot_minutes), s.slot_minutes, s.day_start, s.day_end), rowKey: row.key } : null
        setDrag({ ...d, moved, x: e.clientX, y: e.clientY, preview })
      }
    }
    const onUp = () => {
      const d = dragRef.current
      setDrag(null)
      if (!d) return
      if (!d.moved) {
        if (d.kind === 'block') setOpenBlockId(d.block.id)
        else setOpenStaffId(d.person.staff_id)
        return
      }
      if (d.kind === 'block') {
        const b = d.block, p = d.preview
        const room = roomOfKey(p.rowKey)
        if (p.start === b.start && p.end === b.end && room === b.room_id) return
        if (overlapsOwn(data.blocks, b.staff_id, p.start, p.end, b.id)) { report('That would overlap another of their boxes.'); return }
        const op: DayOp = b.shift_claim_id ? { op: 'update', id: b.id, room_id: room } : { op: 'update', id: b.id, room_id: room, start: p.start, end: p.end }
        commit([op], { blockId: b.id, preview: p, staffId: b.staff_id })
      } else if (d.preview && d.person.center_staff_id) {
        const p = d.preview
        if (overlapsOwn(data.blocks, d.person.staff_id, p.start, p.end)) { report('That would overlap another of their boxes.'); return }
        commit([{ op: 'add', center_staff_id: d.person.center_staff_id, room_id: roomOfKey(p.rowKey), start: p.start, end: p.end }],
          { preview: p, staffId: d.person.staff_id })
      }
    }
    const onCancel = () => setDrag(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrag(null) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
    }
  }, [drag !== null, data, commit, report]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <div className="flex items-center gap-2 py-16 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading the day…</div>
  if (!data) return <div className="rounded-2xl border border-border bg-white p-8 text-center text-[#a3221b]">{error || 'Could not load the day.'}</div>

  const s = data.settings
  const day = data.day
  const isToday = day.date === s.today

  const startBlockDrag = (e: React.PointerEvent, block: DayBlock, mode: DragMode) => {
    if (e.button !== 0 || busy) return
    e.preventDefault()
    e.stopPropagation()
    setDrag({ kind: 'block', block, mode, x0: e.clientX, y0: e.clientY, moved: false, preview: { start: block.start, end: block.end, rowKey: rowKeyOf(block.room_id) } })
  }
  const startPersonDrag = (e: React.PointerEvent, person: DayPerson) => {
    if (e.button !== 0 || busy) return
    e.preventDefault()
    setDrag({ kind: 'person', person, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, preview: null })
  }

  return (
    <div className="space-y-3">
      {/* Day bar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Previous day" onClick={() => setDate(addDays(day.date, -1))} className="rounded-xl border border-border bg-white p-2 hover:bg-surface"><ChevronLeft className="h-5 w-5" /></button>
          <input type="date" aria-label="Day" value={day.date} onChange={e => e.target.value && setDate(e.target.value)} className="min-h-10 rounded-xl border border-border bg-white px-2.5 text-sm font-semibold" />
          <button type="button" aria-label="Next day" onClick={() => setDate(addDays(day.date, 1))} className="rounded-xl border border-border bg-white p-2 hover:bg-surface"><ChevronRight className="h-5 w-5" /></button>
          <span className="text-lg font-black text-heading">{isToday ? 'Today' : formatDate(day.date)}</span>
          {!isToday && <button type="button" onClick={() => setDate(s.today)} className="min-h-9 rounded-xl px-2 text-[13px] font-bold text-brand-700 hover:bg-brand-50">Go to today</button>}
          {(busy || loading) && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label="Saving" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {day.status === 'published'
            ? <span className="rounded-full bg-[#e2f2ea] px-3 py-1 text-[12px] font-bold text-[#17603f]">Published · changes go live</span>
            : <span className="rounded-full bg-[#fff3d6] px-3 py-1 text-[12px] font-bold text-[#7a4b00]">Draft · teachers can&apos;t see it yet</span>}
          
          {day.status === 'published' && (data.unnotified?.length ?? 0) > 0 && (
            <button type="button" disabled={busy || notifying} onClick={() => notify(day.date)}
              title="Send a notice to everyone whose boxes changed since their last notice"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-brand-600 bg-white px-3 text-sm font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-50">
              {notifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
              Notify {data.unnotified!.length} {data.unnotified!.length === 1 ? 'person' : 'people'} of changes
            </button>
          )}
          {day.status === 'draft' && (
            <button type="button" disabled={busy || notifying} onClick={async () => {
              const err = await publish()
              report(err)
              if (!err) await notify(day.date, 'Published.')
            }}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
              <Send className="h-4 w-4" /> Publish day
            </button>
          )}
        </div>
      </div>

      {notice && !message && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-xl bg-[#e2f2ea] px-3 py-2 text-sm font-semibold text-[#17603f]">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice('')} className="rounded p-0.5 hover:bg-white/50"><X className="h-4 w-4" /></button>
        </div>
      )}
      {(message || (error && data)) && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-xl bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">
          <span>{message || error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setMessage('')} className="rounded p-0.5 hover:bg-white/50"><X className="h-4 w-4" /></button>
        </div>
      )}

      <Board data={data} drag={drag} pending={pending} timelineRef={timelineRef} onBlockPointerDown={startBlockDrag}
        onBlockKey={id => setOpenBlockId(id)} />

      <Tray data={data} drag={drag} onPersonPointerDown={startPersonDrag} onOpen={id => setOpenStaffId(id)} />

      <p className="text-[12px] text-muted">
        Drag a box to move it, drag its edge to change the hours, or drag someone from Available onto a room. Tap a box or a name for more.
        The strip under each room is green when the ratio is covered for its enrolled children, amber when short, red when no one is there.
      </p>

      {drag?.kind === 'person' && drag.moved && (
        <div aria-hidden className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand-600 bg-white px-3 py-1 text-[13px] font-bold text-brand-800 shadow-lg"
          style={{ left: drag.x, top: drag.y }}>
          {shortName(drag.person)}{drag.preview ? ` · ${formatRange(drag.preview.start, drag.preview.end)}` : ''}
        </div>
      )}

      {openBlockId && (() => {
        const block = data.blocks.find(b => b.id === openBlockId)
        const person = block && data.people.find(p => p.staff_id === block.staff_id)
        if (!block || !person) return null
        return (
          <BlockDialog key={block.id} block={block} person={person} data={data}
            onApply={apply}
            onPerson={() => { setOpenBlockId(null); setOpenStaffId(person.staff_id) }}
            onClose={() => setOpenBlockId(null)} />
        )
      })()}
      {openStaffId && (() => {
        const person = data.people.find(p => p.staff_id === openStaffId)
        if (!person) return null
        return (
          <PersonDialog key={person.staff_id} person={person} data={data}
            onCallOut={(kind, start, end, note) => callOut(person.center_staff_id!, kind, start, end, note)}
            onUndo={() => undoCallOut(person.center_staff_id!)}
            onReset={() => resetPerson(person.center_staff_id!)}
            onClose={() => setOpenStaffId(null)} />
        )
      })()}
    </div>
  )
}

/**
 * The day as a board. Editable for the admin (drag handlers passed in); read-only for teachers (`readOnly`): no
 * dragging, no ratio strip, and the viewer's own boxes highlighted.
 */
export function Board({ data, drag = null, pending = null, timelineRef, onBlockPointerDown, onBlockKey, readOnly = false, highlightStaffId = null }: {
  data: DayPayload
  drag?: Drag | null
  pending?: { blockId?: string; preview: Preview; staffId: string } | null
  timelineRef?: React.MutableRefObject<HTMLDivElement | null>
  onBlockPointerDown?: (e: React.PointerEvent, block: DayBlock, mode: DragMode) => void
  onBlockKey?: (id: string) => void
  readOnly?: boolean
  highlightStaffId?: string | null
}) {
  const s = data.settings
  const marks = hourMarks(s.day_start, s.day_end)
  const people = useMemo(() => new Map(data.people.map(p => [p.staff_id, p])), [data.people])

  // Where each box is drawn right now: being dragged, waiting for the save, or where it is saved
  const shown = useMemo(() => {
    const dragged = drag?.kind === 'block' && drag.moved ? drag : null
    return data.blocks.map(b => {
      if (dragged && dragged.block.id === b.id) return { ...b, start: dragged.preview.start, end: dragged.preview.end, rowKey: dragged.preview.rowKey, ghost: true }
      if (pending?.blockId === b.id) return { ...b, start: pending.preview.start, end: pending.preview.end, rowKey: pending.preview.rowKey, ghost: true }
      return { ...b, rowKey: rowKeyOf(b.room_id), ghost: false }
    })
  }, [data.blocks, drag, pending])
  const known = new Set(data.rooms.map(r => r.id))
  const rows = [
    ...data.rooms.map(r => ({ key: r.id, name: r.name, room: r, floater: false })),
    { key: FLOATER, name: 'Floaters', room: null, floater: true },
  ]
  const dropping = drag?.kind === 'person' ? drag.preview : !pending?.blockId && pending ? pending.preview : null

  return (
    <div className="rounded-2xl border border-border bg-white shadow-sm">
      <div className="overflow-x-auto">
        <div className="min-w-[760px] select-none">
          <div className="flex border-b border-border">
            <div className="w-40 shrink-0" />
            <div className="relative h-8 flex-1">
              {marks.map(m => (
                <span key={m} className="absolute top-2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold text-muted"
                  style={{ left: `${boxPosition(m, m, s.day_start, s.day_end).left}%` }}>{formatTime(m).replace(':00', '')}</span>
              ))}
            </div>
          </div>

          {rows.map((row, i) => {
            const mine = shown.filter(b => (row.floater ? b.rowKey === FLOATER || (b.rowKey !== FLOATER && !known.has(b.rowKey)) : b.rowKey === row.key))
            const { lanes, placed } = packLanes(mine)
            const needed = row.room ? teachersNeeded(row.room) : 0
            const runs = row.room ? coverage(mine.filter(b => !b.ghost || b.rowKey === row.key), s.day_start, s.day_end) : []
            const hover = (drag?.kind === 'block' && drag.moved && drag.mode === 'move' && drag.preview.rowKey === row.key) || (dropping?.rowKey === row.key)
            return (
              <div key={row.key} className={`flex border-b border-border last:border-b-0 ${row.floater ? 'bg-[#fffaf0]' : ''}`}>
                <div className="w-40 shrink-0 border-r border-border px-3 py-2">
                  <div className="truncate text-sm font-bold text-heading" title={row.name}>{row.name}</div>
                  {!readOnly && <div className="text-[11px] leading-tight text-muted">
                    {row.floater ? 'No room yet'
                      : needed ? `Needs ${needed} · ${row.room!.enrolled} ${row.room!.enrolled === 1 ? 'child' : 'children'} · 1:${row.room!.ratio}`
                      : row.room!.ratio ? `1:${row.room!.ratio} · no children yet` : 'No ratio set'}
                  </div>}
                </div>
                <div ref={i === 0 ? timelineRef : undefined} data-row-key={row.key}
                  className={`relative flex-1 transition-colors ${hover ? 'bg-brand-50/70' : ''}`}
                  style={{ height: Math.max(1, lanes + (dropping?.rowKey === row.key ? 1 : 0)) * LANE_H + ROW_PAD * 2 + STRIP_H }}>
                  {marks.map(m => <span key={m} aria-hidden className="absolute inset-y-0 w-px bg-border/70" style={{ left: `${boxPosition(m, m, s.day_start, s.day_end).left}%` }} />)}

                  {placed.map(({ item: b, lane }) => {
                    const person = people.get(b.staff_id)
                    const { left, width } = boxPosition(b.start, b.end, s.day_start, s.day_end)
                    const sub = !!b.shift_claim_id
                    const name = person ? shortName(person) : 'Staff'
                    const label = `${name}${sub ? ' (substitute)' : ''}, ${formatTime(b.start)} to ${formatTime(b.end)}${b.note ? `, ${b.note}` : ''}`
                    const mine = highlightStaffId === b.staff_id
                    const tone = mine ? 'border-brand-700 bg-brand-600 text-white'
                      : sub ? 'border-[#c4b5fd] bg-[#f3efff] text-[#4c1d95]'
                      : row.floater ? 'border-dashed border-amber-500 bg-[#fff3d6] text-[#7a4b00]'
                      : 'border-brand-200 bg-brand-50 text-brand-800'
                    const editable = !readOnly && !!onBlockPointerDown
                    if (!editable) {
                      return (
                        <div key={b.id} title={label} aria-label={`${mine ? 'You' : name}, ${formatTime(b.start)} to ${formatTime(b.end)}`}
                          className={`absolute flex items-center gap-1.5 overflow-hidden rounded-lg border px-2 text-[12px] font-bold shadow-sm ${tone}`}
                          style={{ left: `${left}%`, width: `calc(${width}% - 2px)`, top: ROW_PAD + lane * LANE_H, height: LANE_H - 6 }}>
                          <span className="truncate">{mine ? 'You' : name}</span>
                          <span className="shrink-0 font-semibold opacity-80">{formatRange(b.start, b.end)}</span>
                          {sub && !mine && <span className="shrink-0 rounded bg-[#ddd6fe] px-1 text-[10px] uppercase">Sub</span>}
                        </div>
                      )
                    }
                    return (
                      <div key={b.id} role="button" tabIndex={0} aria-label={label} title={label}
                        onPointerDown={e => onBlockPointerDown(e, b, 'move')}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBlockKey?.(b.id) } }}
                        className={`group absolute flex touch-none items-center gap-1.5 overflow-hidden rounded-lg border px-2 text-[12px] font-bold shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tone} ${b.ghost ? 'z-10 opacity-80 shadow-lg ring-2 ring-brand-500' : 'cursor-grab hover:shadow-md'}`}
                        style={{ left: `${left}%`, width: `calc(${width}% - 2px)`, top: ROW_PAD + lane * LANE_H, height: LANE_H - 6 }}>
                        {!sub && <span aria-hidden onPointerDown={e => onBlockPointerDown(e, b, 'start')} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-lg group-hover:bg-black/10" />}
                        <span className="truncate pl-0.5">{name}</span>
                        <span className="shrink-0 font-semibold opacity-70">{formatRange(b.start, b.end)}</span>
                        {sub && <span className="shrink-0 rounded bg-[#ddd6fe] px-1 text-[10px] uppercase">Sub</span>}
                        {!sub && <span aria-hidden onPointerDown={e => onBlockPointerDown(e, b, 'end')} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-lg group-hover:bg-black/10" />}
                      </div>
                    )
                  })}

                  {dropping?.rowKey === row.key && (() => {
                    const { left, width } = boxPosition(dropping.start, dropping.end, s.day_start, s.day_end)
                    return <div aria-hidden className="absolute rounded-lg border-2 border-dashed border-brand-500 bg-brand-50/60"
                      style={{ left: `${left}%`, width: `calc(${width}% - 2px)`, top: ROW_PAD + lanes * LANE_H, height: LANE_H - 6 }} />
                  })()}

                  {!readOnly && row.room && runs.map(r => {
                    const tone = coverageTone(r.count, needed)
                    if (tone === 'none') return null
                    const { left, width } = boxPosition(r.start, r.end, s.day_start, s.day_end)
                    const color = tone === 'empty' ? 'bg-[#dc2626]' : tone === 'short' ? 'bg-amber-500' : 'bg-[#16a34a]'
                    return <span key={r.start} title={`${formatTime(r.start)}–${formatTime(r.end)}: ${r.count} scheduled${needed ? `, ${needed} needed` : ''}`}
                      className={`absolute bottom-0 ${color}`} style={{ left: `${left}%`, width: `${width}%`, height: STRIP_H }} />
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Tray({ data, drag, onPersonPointerDown, onOpen }: {
  data: DayPayload
  drag: Drag | null
  onPersonPointerDown: (e: React.PointerEvent, p: DayPerson) => void
  onOpen: (staffId: string) => void
}) {
  const onBoard = new Set(data.blocks.map(b => b.staff_id))
  const regulars = data.people.filter(p => p.kind === 'regular')
  const available = regulars.filter(p => !onBoard.has(p.staff_id) && !(p.absence && p.absence.start === null))
  const out = regulars.filter(p => p.absence)
  const subs = data.people.filter(p => p.kind === 'sub')
  const subTimes = (p: DayPerson) => data.blocks.filter(b => b.staff_id === p.staff_id).map(b => formatRange(b.start, b.end)).join(', ')

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <section className="rounded-2xl border border-border bg-white p-3 shadow-sm">
        <h3 className="mb-2 text-[11px] font-black uppercase tracking-widest text-muted">Available · drag onto a room</h3>
        <div className="flex flex-wrap gap-1.5">
          {available.length === 0 && <span className="text-sm text-muted">Everyone is on the board.</span>}
          {available.map(p => (
            <button key={p.staff_id} type="button" onPointerDown={e => onPersonPointerDown(e, p)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p.staff_id) } }}
              className={`min-h-9 touch-none cursor-grab rounded-full border border-dashed border-amber-500 bg-[#fffaf0] px-3 text-[13px] font-semibold text-[#7a4b00] hover:bg-[#fff3d6] ${drag?.kind === 'person' && drag.person.staff_id === p.staff_id ? 'opacity-40' : ''}`}>
              {shortName(p)}
            </button>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-white p-3 shadow-sm">
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-muted"><UserX className="h-3.5 w-3.5" /> Called out</h3>
        <div className="flex flex-wrap gap-1.5">
          {out.length === 0 && <span className="text-sm text-muted">No one. Tap a name or box to record a call-out.</span>}
          {out.map(p => (
            <button key={p.staff_id} type="button" onClick={() => onOpen(p.staff_id)}
              className="min-h-9 rounded-full border border-[#f5b5ae] bg-[#fdf0ee] px-3 text-[13px] font-semibold text-[#a3221b] hover:bg-[#fce4e2]">
              {shortName(p)} · {ABSENCE_LABELS[p.absence!.kind]}{p.absence!.start ? ` ${formatRange(p.absence!.start, p.absence!.end!)}` : ''}
            </button>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-white p-3 shadow-sm">
        <h3 className="mb-2 text-[11px] font-black uppercase tracking-widest text-muted">Substitutes today</h3>
        <div className="flex flex-wrap gap-1.5">
          {subs.length === 0 && <span className="text-sm text-muted">No confirmed substitute shifts.</span>}
          {subs.map(p => (
            <span key={p.staff_id} className="rounded-full border border-[#c4b5fd] bg-[#f3efff] px-3 py-1.5 text-[13px] font-semibold text-[#4c1d95]">
              {shortName(p)} · {subTimes(p)}
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}

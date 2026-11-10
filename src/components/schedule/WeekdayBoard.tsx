'use client'

import { useMemo } from 'react'
import {
  WEEKDAY_NAMES, boxPosition, formatRange, formatTime, hourMarks, packLanes, shortName,
  type FixedBlock, type FixedList, type FixedStaff, type Weekday,
} from '@/lib/schedule'

const LANE_H = 40   // px per stacked box
const ROW_PAD = 8

type Box = { person: FixedStaff; block: FixedBlock; start: string; end: string }

/**
 * The fixed schedule of one weekday as a board: rooms top to bottom, the day left to right, one box per teacher
 * block. Read-only (the daily board in phase 2 adds drag and drop); a box opens that teacher's schedule.
 */
export function WeekdayBoard({ data, weekday, onPick }: {
  data: FixedList
  weekday: Weekday
  onPick: (person: FixedStaff) => void
}) {
  const { settings, rooms, staff } = data
  const marks = hourMarks(settings.day_start, settings.day_end)

  const { rows, unscheduled } = useMemo(() => {
    const boxes: Box[] = staff.flatMap(p => p.blocks.filter(b => b.weekday === weekday).map(b => ({ person: p, block: b, start: b.start, end: b.end })))
    const known = new Set(rooms.map(r => r.id))
    const byRoom = (id: string | null) => boxes.filter(b => (id === null ? b.block.room_id === null || !known.has(b.block.room_id) : b.block.room_id === id))
    return {
      rows: [
        ...rooms.map(r => ({ key: r.id, name: r.name, floater: false, ...packLanes(byRoom(r.id)) })),
        { key: 'floater', name: 'Floaters', floater: true, ...packLanes(byRoom(null)) },
      ],
      unscheduled: staff.filter(p => !p.blocks.some(b => b.weekday === weekday)),
    }
  }, [rooms, staff, weekday])

  return (
    <div className="rounded-2xl border border-border bg-white shadow-sm">
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          {/* Hour scale */}
          <div className="flex border-b border-border">
            <div className="w-36 shrink-0 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-muted">{WEEKDAY_NAMES[weekday]}</div>
            <div className="relative h-8 flex-1">
              {marks.map(m => {
                const { left } = boxPosition(m, m, settings.day_start, settings.day_end)
                return (
                  <span key={m} className="absolute top-2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold text-muted first:translate-x-0" style={{ left: `${left}%` }}>
                    {formatTime(m).replace(':00', '')}
                  </span>
                )
              })}
            </div>
          </div>

          {rows.map(row => (
            <div key={row.key} className={`flex border-b border-border last:border-b-0 ${row.floater ? 'bg-[#fffaf0]' : ''}`}>
              <div className="w-36 shrink-0 border-r border-border px-3 py-2">
                <div className="truncate text-sm font-bold text-heading" title={row.name}>{row.name}</div>
                <div className="text-[11px] text-muted">{row.placed.length ? `${new Set(row.placed.map(p => p.item.person.center_staff_id)).size} scheduled` : row.floater ? 'Fixed hours, no room' : 'No one yet'}</div>
              </div>
              <div className="relative flex-1" style={{ height: Math.max(1, row.lanes) * LANE_H + ROW_PAD * 2 }}>
                {marks.map(m => {
                  const { left } = boxPosition(m, m, settings.day_start, settings.day_end)
                  return <span key={m} aria-hidden className="absolute inset-y-0 w-px bg-border/70" style={{ left: `${left}%` }} />
                })}
                {row.placed.map(({ item, lane }) => {
                  const { left, width } = boxPosition(item.start, item.end, settings.day_start, settings.day_end)
                  const label = `${shortName(item.person)}, ${formatTime(item.start)} to ${formatTime(item.end)}${item.block.notes ? ` (${item.block.notes})` : ''}`
                  return (
                    <button key={`${item.person.center_staff_id}-${item.start}`} type="button" onClick={() => onPick(item.person)} title={label} aria-label={label}
                      className={`absolute flex items-center gap-1.5 overflow-hidden rounded-lg border px-2 text-left text-[12px] font-bold shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${row.floater ? 'border-dashed border-amber-500 bg-[#fff3d6] text-[#7a4b00]' : 'border-brand-200 bg-brand-50 text-brand-800'}`}
                      style={{ left: `${left}%`, width: `calc(${width}% - 2px)`, top: ROW_PAD + lane * LANE_H, height: LANE_H - 6 }}>
                      <span className="truncate">{shortName(item.person)}</span>
                      <span className="shrink-0 font-semibold opacity-70">{formatRange(item.start, item.end)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-3">
        <span className="text-[11px] font-black uppercase tracking-widest text-muted">No fixed hours on {WEEKDAY_NAMES[weekday]}</span>
        {unscheduled.length === 0 && <span className="text-sm text-muted">Everyone has hours.</span>}
        {unscheduled.map(p => (
          <button key={p.center_staff_id} type="button" onClick={() => onPick(p)}
            className="min-h-8 rounded-full border border-dashed border-amber-500 bg-[#fffaf0] px-3 text-[13px] font-semibold text-[#7a4b00] hover:bg-[#fff3d6]">
            {shortName(p)}
          </button>
        ))}
      </div>
    </div>
  )
}

'use client'

import { ChevronRight } from 'lucide-react'
import {
  WEEKDAY_SHORT, blockHours, boxPosition, formatDate, formatHours, formatRange, scheduleWeekdays, shortName,
  type FixedList, type FixedStaff,
} from '@/lib/schedule'

/** Every regular teacher with a small bar per weekday; a row opens that teacher's schedule */
export function FixedScheduleList({ data, onPick }: { data: FixedList; onPick: (person: FixedStaff) => void }) {
  const { settings, rooms, staff } = data
  const days = scheduleWeekdays(settings.weekends)
  const roomName = (id: string | null) => (id ? rooms.find(r => r.id === id)?.name ?? 'Floater' : 'Floater')

  if (staff.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">
        No regular staff yet. Mark team members as regular employees on their team page, and they show up here.
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-white shadow-sm">
      {staff.map(p => {
        const none = p.blocks.length === 0
        return (
          <li key={p.center_staff_id}>
            <button type="button" onClick={() => onPick(p)}
              className="flex w-full flex-col gap-3 px-4 py-3 text-left hover:bg-surface focus:outline-none focus-visible:bg-surface lg:flex-row lg:items-center">
              <div className="min-w-0 lg:w-56">
                <div className="truncate text-sm font-bold text-heading">{shortName(p)}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <span>Home room: {p.home_room_id ? roomName(p.home_room_id) : 'none'}</span>
                  {none
                    ? <span className="rounded-full border border-dashed border-amber-500 bg-[#fffaf0] px-2 py-0.5 font-semibold text-[#7a4b00]">No fixed schedule · floater</span>
                    : <span className="font-semibold text-text-main">{formatHours(blockHours(p.blocks))}/week</span>}
                  {p.next_change && <span className="rounded-full bg-[#eef2ff] px-2 py-0.5 font-semibold text-[#3730a3]">Changes {formatDate(p.next_change)}</span>}
                </div>
              </div>
              <div className="grid flex-1 gap-1.5" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
                {days.map(d => {
                  const list = p.blocks.filter(b => b.weekday === d)
                  const title = list.length ? list.map(b => `${formatRange(b.start, b.end)} ${roomName(b.room_id)}`).join(', ') : 'Floater'
                  return (
                    <div key={d} title={`${WEEKDAY_SHORT[d]}: ${title}`}>
                      <div className="mb-0.5 text-[10px] font-black uppercase tracking-widest text-muted">{WEEKDAY_SHORT[d]}</div>
                      <div className="relative h-5 overflow-hidden rounded-md bg-surface">
                        {list.map(b => {
                          const { left, width } = boxPosition(b.start, b.end, settings.day_start, settings.day_end)
                          return <span key={b.start} className={`absolute inset-y-0 rounded ${b.room_id ? 'bg-brand-400' : 'bg-amber-400'}`} style={{ left: `${left}%`, width: `${width}%` }} />
                        })}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted">{list.length ? `${formatRange(list[0].start, list.at(-1)!.end)} · ${roomName(list[0].room_id)}` : '—'}</div>
                    </div>
                  )
                })}
              </div>
              <ChevronRight className="hidden h-5 w-5 shrink-0 text-muted lg:block" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

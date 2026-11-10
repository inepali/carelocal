'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CalendarClock, Loader2, Pencil } from 'lucide-react'
import { blockHours, formatDate, formatHours } from '@/lib/schedule'
import { useFixedSchedule } from './useFixedSchedule'
import { FixedScheduleEditor } from './FixedScheduleEditor'
import { WeekBars } from './FixedScheduleList'

/**
 * Team member page (owner/admin, schedule on, regular employee): their fixed weekly schedule as it stands today,
 * the dates it runs, and an editor (hours and room per day, from and optional until). The daily board fills each day
 * from it automatically.
 */
export function FixedScheduleCard({ centerId, centerStaffId }: { centerId: string; centerStaffId: string }) {
  const { data, loading, error, save } = useFixedSchedule(centerId, null)
  const [editing, setEditing] = useState(false)
  const person = data?.staff.find(p => p.center_staff_id === centerStaffId) ?? null

  return (
    <div className="bg-white border-2 border-border rounded-[2rem] p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-black text-heading flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-brand-600" /> Fixed schedule
        </h2>
        {person && data && (
          <button type="button" onClick={() => setEditing(true)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-800">
            <Pencil className="h-4 w-4" /> {person.blocks.length ? 'Edit schedule' : 'Set schedule'}
          </button>
        )}
      </div>

      {loading && <div className="flex items-center gap-2 text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {!loading && (error || !data) && <p className="text-sm text-[#a3221b]">{error || 'Could not load the schedule.'}</p>}
      {!loading && data && !person && (
        <p className="text-sm text-muted">Fixed schedules are for active regular employees. Once they&apos;re active here, set their usual week.</p>
      )}
      {person && data && (() => {
        const from = person.blocks.map(b => b.from).filter(Boolean).sort()[0] ?? null
        const until = person.blocks.map(b => b.to).filter(Boolean).sort()[0] ?? null
        return (
          <>
            {person.blocks.length === 0 ? (
              <p className="mb-3 text-sm text-muted">
                No fixed hours today, so they come in as a <strong className="text-[#7a4b00]">floater</strong> (Available on the daily board).
                Set their usual week and each day&apos;s schedule fills in by itself.
              </p>
            ) : (
              <p className="mb-3 text-sm text-text-main">
                <strong>{formatHours(blockHours(person.blocks))} a week</strong>
                {from && <> · since {formatDate(from)}</>}
                {until ? <> · until {formatDate(until)}</> : <> · no end date</>}
              </p>
            )}
            <WeekBars person={person} data={data} />
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              {person.next_change && <span className="font-semibold text-[#3730a3]">Changes on {formatDate(person.next_change)}</span>}
              <Link href="/center/schedule" className="font-bold text-brand-700 hover:underline">Open the daily board</Link>
            </div>
          </>
        )
      })()}

      {editing && person && data && (
        <FixedScheduleEditor person={person} rooms={data.rooms} settings={data.settings} viewingOn={data.on}
          onSave={(from, blocks, until) => save(person.center_staff_id, from, blocks, until)} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { currentBlockIndex, formatRange, formatTime, fromMinutes, myBlockLabel, type MyScheduleDay } from '@/lib/schedule'

/**
 * Regular teachers, on the Live Roster: today's rooms and hours in order, the current one highlighted, with an
 * "Updated" badge when the day changed since they last looked. Hidden when the center has no staff schedule.
 * Showing it counts as having looked.
 */
export function MyDayStrip({ centerId, inline = false }: {
  centerId: string
  /** Drop the card chrome so the strip can sit inside another header (the Live Roster's) */
  inline?: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const [state, setState] = useState<{ today: string; day: MyScheduleDay | null } | null>(null)
  const [updated, setUpdated] = useState(false)
  const [now, setNow] = useState(() => { const d = new Date(); return fromMinutes(d.getHours() * 60 + d.getMinutes()) })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: s } = await supabase.rpc('schedule_settings', { p_center_id: centerId })
      const settings = s as { enabled?: boolean; today?: string } | null
      if (cancelled || !settings?.enabled || !settings.today) return
      const { data: rows } = await supabase.rpc('my_schedule', { p_from: settings.today, p_to: settings.today })
      if (cancelled) return
      const day = ((rows ?? []) as MyScheduleDay[]).find(d => d.center_id === centerId) ?? null
      setState({ today: settings.today, day })
      if (day && !day.seen) {
        setUpdated(true)
        await supabase.rpc('my_schedule_seen', { p_center_id: centerId, p_date: settings.today })
      }
    })()
    const timer = window.setInterval(() => { const d = new Date(); setNow(fromMinutes(d.getHours() * 60 + d.getMinutes())) }, 60_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [centerId, supabase])

  if (!state) return null
  const day = state.day
  const current = day ? currentBlockIndex(day.blocks, now) : -1

  return (
    <div className={inline
      ? 'flex flex-col gap-2 sm:flex-row sm:items-center sm:border-l sm:border-border sm:pl-5'
      : 'mb-4 flex flex-col gap-2 rounded-2xl border border-border bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center'}>
      <div className="flex items-center gap-2 text-sm text-heading">
        <CalendarClock className="h-5 w-5 text-brand-600" /> My day
        {updated && <span className="rounded-full bg-[#eef2ff] px-2 py-0.5 text-[11px] text-[#3730a3]">Updated</span>}
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {!day && <span className="text-sm text-muted">Today&apos;s schedule isn&apos;t published yet.</span>}
        {day && day.blocks.length === 0 && (
          <span className="text-sm text-muted">{day.off ? 'You’re marked off today.' : 'You’re not on today’s schedule.'}</span>
        )}
        {day?.blocks.map((b, i) => (
          <span key={b.start}
            className={`rounded-full border px-3 py-1 text-[13px] ${i === current ? 'border-brand-700 bg-brand-600 text-white'
              : b.kind === 'cover' ? 'border-2 border-[#dc2626] bg-[#fdecec] text-[#a3221b]'
              : b.kind === 'break' ? 'border-dashed border-[#a1a1aa] bg-white text-[#52525b]'
              : 'border-border bg-surface text-text-main'}`}
            title={`${myBlockLabel(b)}, ${formatTime(b.start)} to ${formatTime(b.end)}${b.note ? ` · ${b.note}` : ''}`}>
            {myBlockLabel(b)} {formatRange(b.start, b.end)}{i === current && <span className="sr-only"> (now)</span>}
          </span>
        ))}
        {day?.off && day.off.start && day.blocks.length > 0 && <span className="text-[12px] text-muted">Off {formatRange(day.off.start, day.off.end!)}</span>}
      </div>
      <Link href="/staff/schedule" className="inline-flex items-center gap-1 text-[13px] text-brand-700 hover:underline">
        Full schedule <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

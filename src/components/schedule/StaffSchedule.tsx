'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  WEEKDAY_SHORT, addDays, describeMyDay, formatDate, formatRange, weekdayOf,
  type DayPayload, type MyScheduleDay, type ScheduleSettings,
} from '@/lib/schedule'
import { Board } from './DailyBoard'

type BoardAnswer = ({ published: true; me: string | null } & DayPayload) | { published: false; settings: ScheduleSettings; date: string }

/**
 * Regular teachers: their own week (published days only, "Updated" when a day changed since they looked), and any
 * day's whole board, read-only, with their own boxes highlighted. Opening a day counts as having looked at it.
 */
export default function StaffSchedule({ centerId, initialDate }: { centerId: string; initialDate?: string | null }) {
  const supabase = useMemo(() => createClient(), [])
  const [settings, setSettings] = useState<ScheduleSettings | null>(null)
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const [days, setDays] = useState<MyScheduleDay[]>([])
  const [selected, setSelected] = useState<string | null>(initialDate ?? null)
  const [board, setBoard] = useState<BoardAnswer | null>(null)
  const [loadingBoard, setLoadingBoard] = useState(false)
  const [error, setError] = useState('')

  // The center's today and settings, then the week that holds the picked day
  useEffect(() => {
    let cancelled = false
    supabase.rpc('schedule_settings', { p_center_id: centerId }).then(({ data, error: err }) => {
      if (cancelled) return
      if (err) { setError(err.message); return }
      const s = data as ScheduleSettings
      setSettings(s)
      const first = selected && /^\d{4}-\d{2}-\d{2}$/.test(selected) ? selected : s.today
      setSelected(first)
      // Weeks start on Monday
      setWeekStart(addDays(first, -((weekdayOf(first) + 6) % 7)))
    })
    return () => { cancelled = true }
  }, [centerId, supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadWeek = useCallback(async (from: string) => {
    const { data, error: err } = await supabase.rpc('my_schedule', { p_from: from, p_to: addDays(from, 6) })
    if (err) { setError(err.message); return }
    setDays(((data ?? []) as MyScheduleDay[]).filter(d => d.center_id === centerId))
  }, [centerId, supabase])
  useEffect(() => { if (weekStart) loadWeek(weekStart) }, [weekStart, loadWeek])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setLoadingBoard(true)
    ;(async () => {
      const { data, error: err } = await supabase.rpc('schedule_board', { p_center_id: centerId, p_date: selected })
      if (cancelled) return
      setLoadingBoard(false)
      if (err) { setError(err.message); return }
      setBoard(data as BoardAnswer)
      if ((data as BoardAnswer).published) {
        await supabase.rpc('my_schedule_seen', { p_center_id: centerId, p_date: selected })
        setDays(prev => prev.map(d => (d.date === selected ? { ...d, seen: true } : d)))
      }
    })()
    return () => { cancelled = true }
  }, [centerId, selected, supabase])

  if (error) return <div className="rounded-2xl border border-border bg-white p-8 text-center text-[#a3221b]">{error}</div>
  if (!settings || !weekStart || !selected) return <div className="flex items-center gap-2 p-10 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading your schedule…</div>

  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter(d => settings.weekends || (weekdayOf(d) !== 0 && weekdayOf(d) !== 6))
  const pick = (d: string) => setSelected(d)
  const moveWeek = (n: number) => { const next = addDays(weekStart, 7 * n); setWeekStart(next); setSelected(next) }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous week" onClick={() => moveWeek(-1)} className="rounded-xl border border-border bg-white p-2 hover:bg-surface"><ChevronLeft className="h-5 w-5" /></button>
        <span className="text-sm font-bold text-heading">Week of {formatDate(weekStart)}</span>
        <button type="button" aria-label="Next week" onClick={() => moveWeek(1)} className="rounded-xl border border-border bg-white p-2 hover:bg-surface"><ChevronRight className="h-5 w-5" /></button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {week.map(d => {
          const mine = days.find(x => x.date === d)
          const on = d === selected
          return (
            <button key={d} type="button" onClick={() => pick(d)} aria-pressed={on}
              className={`min-h-20 rounded-2xl border px-3 py-2 text-left shadow-sm transition ${on ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500/30' : 'border-border bg-white hover:bg-surface'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-black uppercase tracking-widest text-muted">{WEEKDAY_SHORT[weekdayOf(d)]} {d.slice(8).replace(/^0/, '')}{d === settings.today ? ' · Today' : ''}</span>
                {mine && !mine.seen && <span className="rounded-full bg-[#eef2ff] px-1.5 py-0.5 text-[10px] font-bold text-[#3730a3]">Updated</span>}
              </div>
              <div className="mt-1 text-[13px] font-semibold text-text-main">
                {!mine ? <span className="text-muted">Not published yet</span>
                  : mine.blocks.length === 0 ? <span className="text-muted">{mine.off ? 'Off' : 'Not scheduled'}</span>
                  : describeMyDay(mine)}
              </div>
              {mine?.off?.start && mine.blocks.length > 0 && <div className="text-[11px] text-muted">Off {formatRange(mine.off.start, mine.off.end!)}</div>}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black text-heading">{selected === settings.today ? 'Today' : formatDate(selected)} · everyone</h2>
        {loadingBoard && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
      </div>
      {board && !board.published && (
        <div className="rounded-2xl border border-border bg-white p-8 text-center text-muted shadow-sm">This day isn&apos;t published yet. Check back later.</div>
      )}
      {board && board.published && <Board data={board} readOnly highlightStaffId={board.me} />}
      {board && board.published && (
        <p className="text-[12px] text-muted">Your boxes are highlighted. Questions about your schedule? Ask your director.</p>
      )}
    </div>
  )
}

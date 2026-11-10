'use client'

import { useState } from 'react'
import { CalendarDays, LayoutGrid, Loader2, Settings2, Users } from 'lucide-react'
import { WEEKDAY_SHORT, formatTime, scheduleWeekdays, weekdayOf, type Weekday } from '@/lib/schedule'
import { useFixedSchedule } from './useFixedSchedule'
import { FixedScheduleList } from './FixedScheduleList'
import { FixedScheduleEditor } from './FixedScheduleEditor'
import { WeekdayBoard } from './WeekdayBoard'
import { ScheduleSettingsDialog } from './ScheduleSettingsDialog'
import DailyBoard from './DailyBoard'

type View = 'day' | 'teachers' | 'board'

/**
 * Owner/admin: the daily board (each day, built from fixed schedules, then adjusted by drag and drop), and the fixed
 * weekly schedules it builds from: by teacher (edit a week) and by room for one weekday. A teacher with no fixed hours
 * on a day is available that day, not in a room.
 */
export default function ScheduleAdmin({ centerId }: { centerId: string }) {
  const [on, setOn] = useState<string | null>(null)
  const { data, loading, error, save, saveSettings } = useFixedSchedule(centerId, on)
  const [view, setView] = useState<View>('day')
  const [weekday, setWeekday] = useState<Weekday | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  if (loading) return <div className="flex items-center gap-2 py-16 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading schedules…</div>
  if (error || !data) return <div className="rounded-2xl border border-border bg-white p-8 text-center text-[#a3221b]">{error || 'Could not load the schedule.'}</div>

  const { settings } = data
  const days = scheduleWeekdays(settings.weekends)
  const shownDay: Weekday = weekday !== null && days.includes(weekday) ? weekday
    : days.includes(weekdayOf(data.on)) ? weekdayOf(data.on) : days[0]
  const editing = editingId ? data.staff.find(p => p.center_staff_id === editingId) ?? null : null
  const floaters = data.staff.filter(p => p.blocks.length === 0).length

  const TAB = (v: View, label: string, Icon: typeof Users) => (
    <button type="button" onClick={() => setView(v)} aria-pressed={view === v}
      className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold ${view === v ? 'bg-white text-heading shadow-sm' : 'text-muted hover:text-heading'}`}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex w-fit flex-wrap rounded-2xl bg-surface p-1">
          {TAB('day', 'Daily board', CalendarDays)}
          {TAB('teachers', 'Fixed: by teacher', Users)}
          {TAB('board', 'Fixed: by room', LayoutGrid)}
        </div>
        <div className={`flex flex-wrap items-center gap-2 ${view === 'day' ? 'hidden' : ''}`}>
          <label className="flex items-center gap-2 text-[13px] font-semibold text-text-main">
            In effect on
            <input type="date" value={data.on} onChange={e => setOn(e.target.value || null)}
              className="min-h-10 rounded-xl border border-border bg-white px-2.5 text-sm" />
          </label>
          {data.on !== settings.today && (
            <button type="button" onClick={() => setOn(null)} className="min-h-10 rounded-xl px-2 text-[13px] font-bold text-brand-700 hover:bg-brand-50">Today</button>
          )}
          <button type="button" onClick={() => setSettingsOpen(true)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-text-main hover:bg-surface">
            <Settings2 className="h-4 w-4" /> {formatTime(settings.day_start)}–{formatTime(settings.day_end)}{settings.weekends ? ', 7 days' : ', Mon–Fri'}
          </button>
        </div>
      </div>

      {view === 'day' && <DailyBoard centerId={centerId} />}

      {view !== 'day' && <p className="text-sm text-muted">
        {data.staff.length} regular {data.staff.length === 1 ? 'teacher' : 'teachers'}
        {floaters > 0 && <> · <strong className="text-[#7a4b00]">{floaters} with no fixed schedule</strong> (they come in as floaters)</>}
      </p>}

      {view === 'day' ? null : view === 'teachers' ? (
        <FixedScheduleList data={data} onPick={p => setEditingId(p.center_staff_id)} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Weekday">
            {days.map(d => (
              <button key={d} type="button" role="tab" aria-selected={d === shownDay} onClick={() => setWeekday(d)}
                className={`min-h-9 rounded-full border px-4 text-[13px] font-bold ${d === shownDay ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-text-main hover:bg-surface'}`}>
                {WEEKDAY_SHORT[d]}
              </button>
            ))}
          </div>
          <WeekdayBoard data={data} weekday={shownDay} onPick={p => setEditingId(p.center_staff_id)} />
        </>
      )}

      {editing && (
        <FixedScheduleEditor key={editing.center_staff_id} person={editing} rooms={data.rooms} settings={settings} viewingOn={data.on}
          onSave={(from, blocks) => save(editing.center_staff_id, from, blocks)} onClose={() => setEditingId(null)} />
      )}
      {settingsOpen && <ScheduleSettingsDialog settings={settings} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

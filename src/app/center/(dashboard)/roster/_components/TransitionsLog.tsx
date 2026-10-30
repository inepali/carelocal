'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, History, Loader2, LogIn, LogOut, Shuffle } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadRosterEvents, type RosterEvent } from '@/lib/roster'
import type { RosterPerson } from '@/lib/roster-ratio'
import { ZONE_LABEL } from './SelectedPanel'

const ACTION: Record<RosterEvent['action'], { label: string; icon: typeof LogIn; tone: string }> = {
  check_in: { label: 'Checked in', icon: LogIn, tone: 'bg-[#e2f2ea] text-[#17603f]' },
  check_out: { label: 'Checked out', icon: LogOut, tone: 'bg-[#fce4e2] text-[#a3221b]' },
  move_room: { label: 'Changed room', icon: Shuffle, tone: 'bg-[#e6edfb] text-[#1d3f6e]' },
  move_zone: { label: 'Moved', icon: ArrowRight, tone: 'bg-[#fff0d1] text-[#7a4b00]' },
}

/**
 * Every check-in, check-out and move for one day, newest first, each with its date and time.
 * This is the day's attendance record (roster_events cannot be edited or deleted from the app).
 */
export function TransitionsLog({
  supabase,
  centerId,
  today,
  refreshKey,
  people,
  roomName,
}: {
  supabase: SupabaseClient
  centerId: string
  /** The center's current day (YYYY-MM-DD) */
  today: string
  /** Bumped whenever the board changes, so today's log reloads */
  refreshKey: number
  people: RosterPerson[]
  roomName: Record<string, string>
}) {
  const [picked, setPicked] = useState<string | null>(null)        // null = follow today
  const day = picked ?? today
  const [events, setEvents] = useState<RosterEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reloadToken = picked == null ? refreshKey : 0               // past days do not change; only today follows the board
  useEffect(() => {
    if (!day) return
    let cancelled = false
    loadRosterEvents(supabase, centerId, day).then(res => {
      if (cancelled) return
      if (res.success) { setEvents(res.events); setError(null) } else setError(res.error)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [supabase, centerId, day, reloadToken])

  const nameOf = useMemo(() => {
    const m = new Map(people.map(p => [p.person_id, `${p.first_name} ${p.last_initial}.`]))
    return (e: RosterEvent) => m.get((e.child_id ?? e.staff_id)!) ?? (e.child_id ? 'A child no longer enrolled' : 'A former staff member')
  }, [people])
  const isStaff = (e: RosterEvent) => !!e.staff_id
  const room = (id: string | null) => (id ? roomName[id] ?? 'a removed room' : 'no room')

  const detail = (e: RosterEvent) => {
    switch (e.action) {
      case 'check_in': return `${room(e.to_area_id)} · ${ZONE_LABEL[e.to_zone]}`
      case 'check_out': return `from ${room(e.from_area_id)}${e.from_zone !== 'home' ? ` · ${ZONE_LABEL[e.from_zone]}` : ''}`
      case 'move_room': return `${room(e.from_area_id)} → ${room(e.to_area_id)} · ${ZONE_LABEL[e.to_zone]}`
      case 'move_zone': return `${room(e.to_area_id)} · ${ZONE_LABEL[e.from_zone]} → ${ZONE_LABEL[e.to_zone]}`
    }
  }

  const counts = useMemo(() => ({
    in: events.filter(e => e.action === 'check_in').length,
    out: events.filter(e => e.action === 'check_out').length,
  }), [events])

  return (
    <section aria-labelledby="transitions-h" className="rounded-3xl border border-border bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="transitions-h" className="flex items-center gap-2 text-lg font-bold text-heading"><History className="h-5 w-5 text-brand-600" /> Transitions</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {events.length} {events.length === 1 ? 'entry' : 'entries'} · {counts.in} check-ins · {counts.out} check-outs
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[13px] font-semibold text-text-main">
            Day
            <input
              type="date"
              value={day}
              max={today}
              onChange={e => { setLoading(true); setPicked(e.target.value && e.target.value !== today ? e.target.value : null) }}
              className="min-h-10 rounded-xl border border-border bg-white px-3 text-sm text-text-main"
            />
          </label>
          {picked && (
            <button type="button" onClick={() => { setLoading(true); setPicked(null) }} className="min-h-10 rounded-xl border border-border px-3 text-[13px] font-bold text-brand-600 hover:bg-brand-50">
              Today
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : error ? (
        <p className="mt-5 text-sm text-[#a3221b]">{error}</p>
      ) : events.length === 0 ? (
        <p className="mt-5 text-sm text-muted">No check-ins or moves on {fullDate(day)}.</p>
      ) : (
        <ol className="mt-4 divide-y divide-border">
          {events.map(e => {
            const a = ACTION[e.action]
            const Icon = a.icon
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <time dateTime={e.at} className="w-[172px] shrink-0 text-[13px] tabular-nums text-text-main">
                  <span className="font-semibold text-heading">{shortDate(e.at)}</span> · {clock(e.at)}
                </time>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${a.tone}`}>
                  <Icon className="h-3 w-3" /> {a.label}
                </span>
                <span className="min-w-0 flex-1 basis-56 text-sm text-text-main">
                  <span className="font-semibold text-heading">{nameOf(e)}</span>
                  {isStaff(e) && <span className="text-muted"> (teacher)</span>}
                  <span className="text-muted"> · {detail(e)}</span>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const fullDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })

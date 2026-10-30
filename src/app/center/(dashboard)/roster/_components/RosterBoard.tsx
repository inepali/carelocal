'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Radio, RefreshCw, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { applyPresence, loadRoster, type PresenceRow } from '@/lib/roster'
import { allRoomStatuses, centerTotals, peopleInRoom, type RosterPerson, type RosterRoom } from '@/lib/roster-ratio'
import { getRosterPhotoUrls } from '@/app/actions/roster.actions'
import { RoomStage } from './RoomStage'
import { RoomTile, StatusPill } from './RoomTile'

/** One soft tint per room, in the center's room order; a child wears their home room's tint */
const TINTS = ['#f8dccb', '#d6e4fa', '#d9efd3', '#e7daf7', '#f8e6b0', '#cbedee', '#f6d5e5', '#e3e8ee']
const PHOTO_REFRESH_MS = 50 * 60 * 1000
const FOCUS_KEY = 'carelocal.roster.focus'

type Live = 'connecting' | 'live' | 'offline'

/**
 * The Live Roster for owners and administrators (phase 2: read-only).
 * Loads rooms and today's presence once, then follows roster_presence through Supabase Realtime: a change for
 * someone already on the board is applied in place; anything else (a new person, a new day, a reconnect)
 * reloads the snapshot.
 */
export function RosterBoard({ centerId }: { centerId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [day, setDay] = useState('')
  const [rooms, setRooms] = useState<RosterRoom[]>([])
  const [people, setPeople] = useState<RosterPerson[]>([])
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [live, setLive] = useState<Live>('connecting')
  const [focus, setFocus] = useState<string | null>(null)
  const dayRef = useRef('')
  const peopleRef = useRef<RosterPerson[]>([])
  useEffect(() => { peopleRef.current = people }, [people])

  const reload = useCallback(async () => {
    const res = await loadRoster(supabase, centerId)
    if (!res.success) { setError(res.error); setLoading(false); return }
    setError(null)
    setDay(res.day); dayRef.current = res.day
    setRooms(res.rooms); setPeople(res.people)
    setFocus(cur => {
      if (cur && res.rooms.some(r => r.id === cur)) return cur
      let saved: string | null = null
      try { saved = window.localStorage.getItem(`${FOCUS_KEY}.${centerId}`) } catch { /* storage blocked */ }
      return res.rooms.find(r => r.id === saved)?.id ?? res.rooms[0]?.id ?? null
    })
    setLoading(false)
  }, [supabase, centerId])

  const reloadPhotos = useCallback(async () => {
    const res = await getRosterPhotoUrls(centerId)
    if (res.success) setPhotos(res.urls)
  }, [centerId])

  // First load, photos, and a photo refresh before the signed links expire
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
    reloadPhotos()
    const t = window.setInterval(reloadPhotos, PHOTO_REFRESH_MS)
    return () => window.clearInterval(t)
  }, [reload, reloadPhotos])

  // Realtime: follow every presence change for this center
  useEffect(() => {
    let reloadTimer: number | undefined
    const reloadSoon = () => { window.clearTimeout(reloadTimer); reloadTimer = window.setTimeout(() => { reload(); reloadPhotos() }, 400) }

    const channel = supabase
      .channel(`roster:${centerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roster_presence', filter: `center_id=eq.${centerId}` }, payload => {
        const row = payload.new as PresenceRow | undefined
        if (!row || !('zone' in row)) { reloadSoon(); return }
        const next = applyPresence(peopleRef.current, row, dayRef.current)
        if (next) { peopleRef.current = next; setPeople(next) } else reloadSoon()
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') { setLive('live'); reloadSoon() }   // catch anything missed while connecting
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setLive('offline')
      })

    const onVisible = () => { if (document.visibilityState === 'visible') reloadSoon() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(reloadTimer)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [supabase, centerId, reload, reloadPhotos])

  const statuses = useMemo(() => allRoomStatuses(rooms, people), [rooms, people])
  const totals = useMemo(() => centerTotals(rooms, people, statuses), [rooms, people, statuses])
  const roomTint = useMemo(() => Object.fromEntries(rooms.map((r, i) => [r.id, TINTS[i % TINTS.length]])), [rooms])
  const roomName = useMemo(() => Object.fromEntries(rooms.map(r => [r.id, r.name])), [rooms])
  const tintOf = useCallback((p: RosterPerson) => (p.home_area_id && roomTint[p.home_area_id]) || '#e3e8ee', [roomTint])
  const visitingFrom = useCallback((p: RosterPerson) =>
    p.kind === 'child' && p.home_area_id && p.work_area_id && p.home_area_id !== p.work_area_id ? roomName[p.home_area_id] ?? 'another room' : null, [roomName])

  function openRoom(id: string) {
    setFocus(id)
    try { window.localStorage.setItem(`${FOCUS_KEY}.${centerId}`, id) } catch { /* storage blocked */ }
  }

  if (loading) {
    return <div className="flex items-center gap-2 p-10 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading the roster…</div>
  }
  if (error) {
    return (
      <div className="max-w-xl rounded-2xl border border-border bg-white p-8 shadow-sm">
        <p className="mb-4 text-text-main">{error}</p>
        <button type="button" onClick={() => { setLoading(true); reload() }} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-bold text-muted hover:bg-surface">
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      </div>
    )
  }
  if (rooms.length === 0) {
    return (
      <div className="max-w-xl rounded-2xl border border-border bg-white p-8 text-center shadow-sm">
        <Users className="mx-auto mb-3 h-10 w-10 text-brand-200" />
        <h2 className="mb-2 text-lg font-bold text-heading">No rooms on the roster yet</h2>
        <p className="text-muted">Add your classrooms under About → Manage Data, then give each one a teacher-to-child ratio.</p>
      </div>
    )
  }

  const focusRoom = rooms.find(r => r.id === focus) ?? rooms[0]
  const others = rooms.filter(r => r.id !== focusRoom.id)
  const rows = Math.ceil((others.length + 1) / 2)
  const slot = (i: number) => (i < rows ? { col: 1, row: i + 1 } : { col: 3, row: i - rows + 1 })
  const floaters = people.filter(p => p.kind === 'staff' && !p.work_area_id && !p.home_area_id)
  const floatersIn = floaters.filter(p => p.zone !== 'home')
  const alerts = rooms.filter(r => statuses[r.id].code === 'out')
  const fs = statuses[focusRoom.id]

  const describeAlert = (r: RosterRoom) => {
    const s = statuses[r.id]
    if (s.label === 'Over capacity') return `${r.name} is over capacity: ${s.childrenIn} children, capacity ${r.capacity}.`
    const parts = (['classroom', 'playground', 'lobby'] as const)
      .filter(z => s.groups[z].short > 0)
      .map(z => `${z} (${s.groups[z].children} children) needs ${s.groups[z].short} more teacher${s.groups[z].short > 1 ? 's' : ''}`)
    return `${r.name} is out of ratio at 1:${s.effectiveRatio}: ${parts.join(' and ')}.`
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">{formatDay(day)}</p>
          <h1 className="text-3xl font-bold tracking-tight text-heading">Live roster</h1>
        </div>
        <LiveBadge live={live} onRetry={() => { reload(); reloadPhotos() }} />
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Stat label="Children checked in" value={totals.childrenIn} of={totals.childrenTotal} />
        <Stat label="Staff checked in" value={totals.staffIn} of={totals.staffTotal} />
        <Stat label="Rooms in ratio" value={totals.roomsInRatio} of={totals.roomsTotal} />
        <Stat label="Open spots today" value={totals.openSpots} />
      </div>

      {alerts.map(r => (
        <div key={r.id} role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#f2b8b3] bg-[#fce4e2] px-4 py-3 text-[#7e1a14]">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="flex-1 basis-64 text-sm font-semibold">{describeAlert(r)}</span>
          {floatersIn.length > 0 && <span className="text-xs font-bold">{floatersIn.length} floater{floatersIn.length > 1 ? 's' : ''} available</span>}
        </div>
      ))}

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-[minmax(0,0.5fr)_minmax(0,3.1fr)_minmax(0,0.5fr)]">
        <section
          aria-label={`${focusRoom.name} room`}
          className="col-span-2 min-w-0 rounded-3xl border border-border bg-white px-4 pb-6 pt-5 sm:px-7 lg:[grid-column:2] lg:[grid-row:1/span_var(--rows)]"
          style={{ ['--rows' as string]: rows }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted">
                {focusRoom.min_age_months != null && focusRoom.max_age_months != null ? `${ageRange(focusRoom)} · ` : ''}1:{fs.effectiveRatio ?? '—'}
              </p>
              <h2 className="mt-1 text-[28px] font-bold tracking-tight text-heading">{focusRoom.name}</h2>
            </div>
            <StatusPill code={fs.code} label={fs.label} className="!px-3.5 !py-1.5 !text-sm" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Metric label="Children in" value={focusRoom.capacity != null ? `${fs.childrenIn} / ${focusRoom.capacity}` : `${fs.childrenIn}`} />
            <Metric label="Teachers in" value={`${fs.teachersIn}`} />
            <Metric label="Teachers required" value={`${fs.needed}`} />
            <Metric label="Ratio" value={fs.effectiveRatio ? `1 : ${fs.effectiveRatio}` : '—'} />
          </div>
          {fs.effectiveRatio != null && focusRoom.ratio_children != null && fs.effectiveRatio < focusRoom.ratio_children && (
            <p className="mt-3 rounded-lg bg-[#fff0d1] px-3 py-2 text-sm text-[#7a4b00]">
              Using 1:{fs.effectiveRatio} instead of 1:{focusRoom.ratio_children} because a younger child is here.
            </p>
          )}
          <RoomStage room={focusRoom} status={fs} seats={peopleInRoom(focusRoom.id, people)} photos={photos} tintOf={tintOf} visitingFrom={visitingFrom} />
          <Legend />
        </section>

        {others.map((r, i) => {
          const s = slot(i)
          return (
            <RoomTile
              key={r.id}
              room={r}
              status={statuses[r.id]}
              present={people.filter(p => p.work_area_id === r.id && p.zone !== 'home')}
              photos={photos}
              tintOf={tintOf}
              onOpen={() => openRoom(r.id)}
              style={{ ['--c' as string]: s.col, ['--r' as string]: s.row }}
            />
          )
        })}

        <div
          className="flex min-h-[150px] flex-col rounded-2xl border border-border bg-white p-2.5 lg:[grid-column:var(--c)] lg:[grid-row:var(--r)]"
          style={{ ['--c' as string]: slot(others.length).col, ['--r' as string]: slot(others.length).row }}
        >
          <span className="text-[15px] font-bold leading-tight text-heading">Floaters and office</span>
          <span className="mt-1 text-[11px] text-muted">{floatersIn.length} in</span>
          <ul className="mt-2 flex flex-col gap-1.5">
            {floaters.map(p => (
              <li key={p.person_id} className={`flex items-center gap-2 text-xs font-semibold text-heading ${p.zone === 'home' ? 'opacity-60' : ''}`}>
                <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-[#16202a] bg-[#dce3ea] text-[10px]">
                  {photos[p.person_id]
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                    ? <img src={photos[p.person_id]} alt="" className="h-full w-full object-cover" />
                    : `${p.first_name[0] ?? ''}${p.last_initial}`}
                </span>
                <span className="truncate">{p.first_name} {p.last_initial}.</span>
              </li>
            ))}
            {floaters.length === 0 && <li className="text-xs text-muted">Teachers without a home room show here</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}

function formatDay(day: string) {
  if (!day) return 'Today'
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

function ageRange(r: RosterRoom) {
  const f = (m: number) => (m < 24 ? `${m} mo` : `${Math.floor(m / 12)} y`)
  return `${f(r.min_age_months ?? 0)} – ${f(r.max_age_months ?? 0)}`
}

function Stat({ label, value, of }: { label: string; value: number; of?: number }) {
  return (
    <div className="rounded-2xl border border-border bg-white px-4 py-3.5">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-1 text-[26px] font-bold tracking-tight text-heading">
        {value}{of != null && <span className="text-sm font-medium text-muted"> of {of}</span>}
      </p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 basis-[120px] rounded-xl bg-surface px-3.5 py-2.5">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-heading">{value}</p>
    </div>
  )
}

function Legend() {
  const item = (swatch: React.ReactNode, text: string) => <span className="inline-flex items-center gap-2">{swatch}{text}</span>
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4 text-xs font-semibold text-text-main">
      {item(<span className="h-4 w-4 rounded border-[3px] border-[#b42318] bg-[#f3c6c1]" />, 'Home')}
      {item(<span className="h-4 w-4 rounded-full border-[3px] border-[#1e7a47] bg-[#bfe3cc]" />, 'Classroom')}
      {item(<span className="h-4 w-4 rounded border-[3px] border-[#a86b00] bg-[#f8e2a8]" />, 'Playground')}
      {item(<span className="h-4 w-4 rounded border-[3px] border-[#2c5c9a] bg-[#cfe0f5]" />, 'Lobby')}
      {item(<span className="h-3.5 w-3.5 rounded-full border-[3px] border-[#16202a] bg-[#dce3ea]" />, 'Teacher')}
      {item(<span className="h-3 w-3 rounded-full bg-amber-600" />, 'Visiting from another room')}
    </div>
  )
}

function LiveBadge({ live, onRetry }: { live: Live; onRetry: () => void }) {
  if (live === 'live') {
    return <span className="inline-flex items-center gap-2 rounded-full bg-[#e2f2ea] px-3 py-1.5 text-xs font-bold text-[#17603f]"><Radio className="h-3.5 w-3.5" /> Live</span>
  }
  if (live === 'connecting') {
    return <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-xs font-bold text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…</span>
  }
  return (
    <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-full bg-[#fff0d1] px-3 py-1.5 text-xs font-bold text-[#7a4b00]">
      <RefreshCw className="h-3.5 w-3.5" /> Reconnecting… tap to refresh
    </button>
  )
}

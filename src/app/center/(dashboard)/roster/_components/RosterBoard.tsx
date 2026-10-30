'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, Loader2, Radio, RefreshCw, Send, Users, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { applyPresence, loadRoster, moveOnRoster, type PresenceRow, type RosterMove } from '@/lib/roster'
import {
  allRoomStatuses, centerTotals, ON_SITE_ZONES, peopleInRoom, roomStatus, simulateMove, waitingForRoom,
  type RosterPerson, type RosterRoom, type StatusCode,
} from '@/lib/roster-ratio'
import { getRosterPhotoUrls } from '@/app/actions/roster.actions'
import { Face } from './PersonAvatar'
import { RoomStage } from './RoomStage'
import { RoomTile, StatusPill } from './RoomTile'
import { SelectedPanel, ZONE_LABEL } from './SelectedPanel'
import { TransitionsLog } from './TransitionsLog'
import { ExportDialog } from './ExportDialog'
import { useRosterDrag, type RosterInteract } from './useRosterDrag'

/** One soft tint per room, in the center's room order; a child wears their home room's tint */
const TINTS = ['#f8dccb', '#d6e4fa', '#d9efd3', '#e7daf7', '#f8e6b0', '#cbedee', '#f6d5e5', '#e3e8ee']
const PHOTO_REFRESH_MS = 50 * 60 * 1000
const FOCUS_KEY = 'carelocal.roster.focus'

type Live = 'connecting' | 'live' | 'offline'

/**
 * The Live Roster for owners and administrators.
 *
 * Loads rooms and today's presence once, then follows roster_presence through Supabase Realtime: a change for
 * someone already on the board is applied in place; anything else (a new person, a new day, a reconnect)
 * reloads the snapshot.
 *
 * Moves (drag and drop, the selected panel, "Send floater") go through roster_apply(). The board moves the
 * person at once and puts them back, with a message, if the database refuses.
 */
export function RosterBoard({ centerId, mode = 'admin', homeRoomId = null, viewerName }: {
  centerId: string
  /** 'teacher': the regular teacher's view (staff portal, phone app, room tablet) */
  mode?: 'admin' | 'teacher'
  /** Teacher view: the room it opens on and stays with; null for a floater, who picks a room */
  homeRoomId?: string | null
  viewerName?: string
}) {
  const teacher = mode === 'teacher'
  useWakeLock(teacher)
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [day, setDay] = useState('')
  const [rooms, setRooms] = useState<RosterRoom[]>([])
  const [people, setPeople] = useState<RosterPerson[]>([])
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [live, setLive] = useState<Live>('connecting')
  const [focus, setFocus] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [logKey, setLogKey] = useState(0)
  const [exporting, setExporting] = useState(false)
  const dayRef = useRef('')
  const peopleRef = useRef<RosterPerson[]>([])
  useEffect(() => { peopleRef.current = people }, [people])

  const reload = useCallback(async () => {
    const res = await loadRoster(supabase, centerId)
    if (!res.success) { setError(res.error); setLoading(false); return }
    setError(null)
    setDay(res.day); dayRef.current = res.day
    setRooms(res.rooms); setPeople(res.people); peopleRef.current = res.people
    setFocus(cur => {
      if (teacher && homeRoomId && res.rooms.some(r => r.id === homeRoomId)) return homeRoomId
      if (cur && res.rooms.some(r => r.id === cur)) return cur
      let saved: string | null = null
      try { saved = window.localStorage.getItem(`${FOCUS_KEY}.${centerId}`) } catch { /* storage blocked */ }
      return res.rooms.find(r => r.id === saved)?.id ?? res.rooms[0]?.id ?? null
    })
    setLoading(false)
  }, [supabase, centerId, teacher, homeRoomId])

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
    let logTimer: number | undefined
    const reloadSoon = () => { window.clearTimeout(reloadTimer); reloadTimer = window.setTimeout(() => { reload(); reloadPhotos() }, 400) }
    const logSoon = () => { window.clearTimeout(logTimer); logTimer = window.setTimeout(() => setLogKey(k => k + 1), 600) }

    const channel = supabase
      .channel(`roster:${centerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roster_presence', filter: `center_id=eq.${centerId}` }, payload => {
        logSoon()
        const row = payload.new as PresenceRow | undefined
        if (!row || !('zone' in row)) { reloadSoon(); return }
        const next = applyPresence(peopleRef.current, row, dayRef.current)
        if (next) { peopleRef.current = next; setPeople(next) } else reloadSoon()
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') { setLive('live'); reloadSoon(); logSoon() }   // catch anything missed while connecting
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setLive('offline')
      })

    const onVisible = () => { if (document.visibilityState === 'visible') { reloadSoon(); logSoon() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(reloadTimer)
      window.clearTimeout(logTimer)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [supabase, centerId, reload, reloadPhotos])

  // Messages fade on their own
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(t)
  }, [toast])

  /** Move one person: show it at once, then let the database confirm or refuse */
  const move = useCallback(async (person: RosterPerson, to: RosterMove) => {
    const cur = peopleRef.current.find(p => p.person_id === person.person_id)
    if (!cur) return
    if (to.zone !== 'home' && !to.work_area_id) return
    const area = to.zone === 'home' ? (to.work_area_id ?? cur.work_area_id) : to.work_area_id
    if (cur.zone === to.zone && cur.work_area_id === area) return               // already there
    if (cur.zone === 'home' && to.zone === 'home') return                       // already out

    const optimistic = simulateMove(peopleRef.current, person.person_id, to)
    peopleRef.current = optimistic
    setPeople(optimistic)
    setBusy(n => n + 1)
    const res = await moveOnRoster(supabase, centerId, person, to, crypto.randomUUID())
    setBusy(n => n - 1)
    if (!res.success) {
      setToast(`${person.first_name} ${person.last_initial}. was not moved: ${res.error}`)
      reload()
      return
    }
    if (res.row) {
      const next = applyPresence(peopleRef.current, res.row, dayRef.current)
      if (next) { peopleRef.current = next; setPeople(next) }
    }
    setLogKey(k => k + 1)
  }, [supabase, centerId, reload])

  const drag = useRosterDrag((person, target) => { move(person, target) })

  const select = useCallback((p: RosterPerson) => {
    if (!drag.clickAllowed()) return
    setSelectedId(cur => (cur === p.person_id ? null : p.person_id))
  }, [drag])

  const ix: RosterInteract = {
    bind: drag.bind,
    select,
    selectedId,
    draggingId: drag.dragging?.person.person_id ?? null,
    over: drag.over,
    isDragging: !!drag.dragging,
  }

  const statuses = useMemo(() => allRoomStatuses(rooms, people), [rooms, people])
  const totals = useMemo(() => centerTotals(rooms, people, statuses), [rooms, people, statuses])
  const roomTint = useMemo(() => Object.fromEntries(rooms.map((r, i) => [r.id, TINTS[i % TINTS.length]])), [rooms])
  const roomName = useMemo(() => Object.fromEntries(rooms.map(r => [r.id, r.name])), [rooms])
  const tintOf = useCallback((p: RosterPerson) => (p.home_area_id && roomTint[p.home_area_id]) || '#e3e8ee', [roomTint])
  const visitingFrom = useCallback((p: RosterPerson) =>
    p.kind === 'child' && p.home_area_id && p.work_area_id && p.home_area_id !== p.work_area_id ? roomName[p.home_area_id] ?? 'another room' : null, [roomName])

  function openRoom(id: string) {
    if (!drag.clickAllowed()) return
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
  const rows = Math.max(1, Math.ceil(others.length / 2))
  const slot = (i: number) => (i < rows ? { col: 1, row: i + 1 } : { col: 3, row: i - rows + 1 })
  // No home room and not checked in (floaters, children who still need a home room): they wait in the Lobby
  const waiting = waitingForRoom(people)
  const floatersFree = waiting.filter(p => p.kind === 'staff')
  // A teacher with a home room stays on it: other rooms are drop targets only, and alerts are about their room
  const locked = teacher && !!homeRoomId && rooms.some(r => r.id === homeRoomId)
  const alerts = rooms.filter(r => statuses[r.id].code === 'out' && (!locked || r.id === homeRoomId))
  const fs = statuses[focusRoom.id]
  const selected = people.find(p => p.person_id === selectedId) ?? null

  // What dropping the dragged (or selected) person on a tile would do
  const mover = drag.dragging?.person ?? selected
  const tilePreview = (r: RosterRoom): { code: StatusCode; text: string } | null => {
    if (!mover || (mover.work_area_id === r.id && mover.zone === 'classroom')) return null
    const s = roomStatus(r, simulateMove(people, mover.person_id, { work_area_id: r.id, zone: 'classroom' }), rooms)
    return { code: s.code, text: `${drag.dragging ? 'Drop' : 'If moved'}: ${s.label}${s.effectiveRatio ? ` · 1:${s.effectiveRatio}` : ''}` }
  }

  const describeAlert = (r: RosterRoom) => {
    const s = statuses[r.id]
    if (s.label === 'Over capacity') return `${r.name} is over capacity: ${s.childrenIn} children, capacity ${r.capacity}.`
    const parts = ON_SITE_ZONES
      .filter(z => s.groups[z].short > 0)
      .map(z => `${ZONE_LABEL[z].toLowerCase()} (${s.groups[z].children} children) needs ${s.groups[z].short} more teacher${s.groups[z].short > 1 ? 's' : ''}`)
    return `${r.name} is out of ratio at 1:${s.effectiveRatio}: ${parts.join(' and ')}.`
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">{formatDay(day)}</p>
          <h1 className="text-3xl font-bold tracking-tight text-heading">{teacher ? 'My room' : 'Live roster'}</h1>
        </div>
        <div className="flex items-center gap-2">
          {busy > 0 && <span className="inline-flex items-center gap-1.5 text-xs font-bold text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>}
          {!teacher && (
            <button type="button" onClick={() => setExporting(true)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-white px-3 text-xs font-bold text-text-main hover:bg-surface">
              <FileSpreadsheet className="h-3.5 w-3.5 text-brand-600" /> Export attendance
            </button>
          )}
          <LiveBadge live={live} onRetry={() => { reload(); reloadPhotos(); setLogKey(k => k + 1) }} />
        </div>
      </header>

      {teacher ? (
        <div className="rounded-2xl border border-border bg-white px-4 py-3.5 text-sm text-text-main">
          {viewerName ? <>Signed in as <strong className="text-heading">{viewerName}</strong>. </> : null}
          {locked
            ? <>Your room is <strong className="text-heading">{roomName[homeRoomId!]}</strong>. Drag children or yourself onto another room to move them there.</>
            : 'You have no home room, so pick the room you are working in.'}
        </div>
      ) : (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Stat label="Children checked in" value={totals.childrenIn} of={totals.childrenTotal} />
        <Stat label="Staff checked in" value={totals.staffIn} of={totals.staffTotal} />
        <Stat label="Rooms in ratio" value={totals.roomsInRatio} of={totals.roomsTotal} />
        <Stat label="Open spots today" value={totals.openSpots} />
      </div>
      )}

      {alerts.map(r => {
        const s = statuses[r.id]
        const shortZone = ON_SITE_ZONES.find(z => s.groups[z].short > 0)
        const floater = shortZone ? floatersFree[0] : undefined
        return (
          <div key={r.id} role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#f2b8b3] bg-[#fce4e2] px-4 py-3 text-[#7e1a14]">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span className="flex-1 basis-64 text-sm font-semibold">{describeAlert(r)}</span>
            {floater && shortZone && (
              <button type="button" onClick={() => move(floater, { work_area_id: r.id, zone: shortZone })}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[#a3221b] px-4 text-[13px] font-bold text-white hover:bg-[#7e1a14]">
                <Send className="h-4 w-4" /> Send {floater.first_name} {floater.last_initial}.
              </button>
            )}
          </div>
        )
      })}

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
          <RoomStage room={focusRoom} status={fs} seats={peopleInRoom(focusRoom.id, people)} waiting={waiting} photos={photos} tintOf={tintOf} visitingFrom={visitingFrom} ix={ix} />
          <Legend />
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer font-semibold text-brand-600">How to move people</summary>
            <p className="mt-1.5 leading-relaxed">
              Drag a child or teacher into Classroom, Playground or Lobby to check them in or move them, onto Home to check them out,
              or onto another room to change rooms. Floaters and children with no home room wait in the Lobby with a dashed outline
              until you drag them in. Tap anyone for the same moves as buttons.
            </p>
          </details>
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
              onOpen={locked ? undefined : () => openRoom(r.id)}
              ix={ix}
              preview={tilePreview(r)}
              style={{ ['--c' as string]: s.col, ['--r' as string]: s.row }}
            />
          )
        })}

      </div>

      <TransitionsLog supabase={supabase} centerId={centerId} today={day} refreshKey={logKey} people={people} roomName={roomName} onlyRoom={locked ? homeRoomId : null} />

      {selected && (
        <SelectedPanel
          person={selected}
          people={people}
          rooms={rooms}
          photo={photos[selected.person_id]}
          tint={tintOf(selected)}
          busy={busy > 0}
          onMove={move}
          onClose={() => setSelectedId(null)}
        />
      )}

      {drag.dragging && (
        <div
          ref={drag.ghostRef}
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 z-50 rounded-full shadow-2xl"
          style={{ transform: `translate(${drag.dragging.x}px, ${drag.dragging.y}px) translate(-50%, -50%)` }}
        >
          <Face
            person={drag.dragging.person}
            url={photos[drag.dragging.person.person_id]}
            tint={tintOf(drag.dragging.person)}
            size={60}
            border={drag.dragging.person.kind === 'staff' ? '3px solid #16202a' : '3px solid #ffffff'}
          />
        </div>
      )}

      {exporting && <ExportDialog supabase={supabase} centerId={centerId} today={day} onClose={() => setExporting(false)} />}

      {toast && (
        <div role="status" className="fixed left-1/2 top-4 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-2xl bg-[#7e1a14] px-4 py-3 text-sm font-semibold text-white shadow-2xl">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="rounded-full p-1 hover:bg-white/15"><X className="h-4 w-4" /></button>
        </div>
      )}
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

/** Keeps a room tablet's screen on while the teacher view is open (where the browser supports it) */
function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    type Sentinel = { release: () => Promise<void> }
    const nav = navigator as Navigator & { wakeLock: { request: (t: 'screen') => Promise<Sentinel> } }
    let lock: Sentinel | null = null
    let stopped = false
    const take = async () => {
      if (stopped || document.visibilityState !== 'visible') return
      try { lock = await nav.wakeLock.request('screen') } catch { /* battery saver or not allowed: the screen may sleep */ }
    }
    take()
    document.addEventListener('visibilitychange', take)                // the lock is dropped when the tab hides
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', take)
      lock?.release().catch(() => {})
    }
  }, [enabled])
}

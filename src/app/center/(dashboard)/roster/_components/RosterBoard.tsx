'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, BookOpen, Camera, ClipboardList, FileSpreadsheet, Mail, Moon, Sun, Utensils, Loader2, Radio, RefreshCw, Send, Users, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { applyPresence, loadRoster, moveOnRoster, type PresenceRow, type RosterMove } from '@/lib/roster'
import {
  allRoomStatuses, centerTotals, ON_SITE_ZONES, peopleInRoom, roomStatus, simulateMove, waitingForRoom,
  type RosterPerson, type RosterRoom, type StatusCode,
} from '@/lib/roster-ratio'
import { getRosterPhotoUrls } from '@/app/actions/roster.actions'
import { Chip, Face } from './PersonAvatar'
import { RoomStage } from './RoomStage'
import { RoomTile, StatusPill } from './RoomTile'
import { SelectedPanel, ZONE_LABEL } from './SelectedPanel'
import { TransitionsLog } from './TransitionsLog'
import { ChildCard } from './ChildCard'
import { ClassEntryDialog } from './ClassEntryDialog'
import { RoomNapDialog, type RoomNapMode } from './RoomNapDialog'
import { ClassPhotoDialog } from './DailyPhoto'
import { clockTime, loadPhotosForReview, loadRoomNaps, reportSettings, nextCheck, sleepChecksRequired, type RoomNap } from '@/lib/daily'
import { ExportDialog } from './ExportDialog'
import { ReportSettingsDialog } from './ReportSettingsDialog'
import { useRosterDrag, type RosterInteract } from './useRosterDrag'

/** One soft tint per room, in the center's room order; a child wears their home room's tint */
const TINTS = ['#f8dccb', '#d6e4fa', '#d9efd3', '#e7daf7', '#f8e6b0', '#cbedee', '#f6d5e5', '#e3e8ee']
const PHOTO_REFRESH_MS = 50 * 60 * 1000
const FOCUS_KEY = 'carelocal.roster.focus'
const VIEW_KEY = 'carelocal.roster.view'

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
  // Directors can look at the board the way a room teacher does; remembered in this browser
  const [adminView, setAdminView] = useState<'admin' | 'teacher'>('admin')
  useEffect(() => {
    try { if (window.localStorage.getItem(VIEW_KEY) === 'teacher') setAdminView('teacher') } catch { /* storage blocked */ }
  }, [])
  function chooseView(v: 'admin' | 'teacher') {
    setAdminView(v)
    try { window.localStorage.setItem(VIEW_KEY, v) } catch { /* storage blocked */ }
  }
  /** Teacher view: a real teacher, or a director who switched to it */
  const teacherView = teacher || adminView === 'teacher'
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
  const [classAction, setClassAction] = useState<'meal' | 'activity' | null>(null)
  const [napAction, setNapAction] = useState<RoomNapMode | null>(null)
  const [classPhoto, setClassPhoto] = useState(false)
  const [toReview, setToReview] = useState(0)
  const [reportsOn, setReportsOn] = useState<boolean | null>(null)
  const [reportDialog, setReportDialog] = useState(false)
  const [roomNaps, setRoomNaps] = useState<RoomNap[]>([])
  const [clock, setClock] = useState(() => new Date())
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

  // Teacher view: who is napping, kept current by Realtime and a 30-second tick for due sleep checks
  const reloadNaps = useCallback(async () => {
    const res = await loadRoomNaps(supabase, centerId)
    if (res.success) setRoomNaps(res.naps)
  }, [supabase, centerId])
  useEffect(() => {
    if (!teacherView) return
    let t: number | undefined
    const soon = () => { window.clearTimeout(t); t = window.setTimeout(reloadNaps, 400) }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadNaps()
    const channel = supabase
      .channel(`naps:${centerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'child_daily_entries', filter: `center_id=eq.${centerId}` }, soon)
      .subscribe()
    const tick = window.setInterval(() => setClock(new Date()), 30_000)
    return () => { window.clearTimeout(t); window.clearInterval(tick); supabase.removeChannel(channel) }
  }, [supabase, centerId, teacherView, reloadNaps])

  // Owners and admins: how many photos wait for review (refreshed when a toast says something changed)
  useEffect(() => {
    if (teacher) return
    let cancelled = false
    loadPhotosForReview(supabase, centerId).then(res => { if (!cancelled && res.success) setToReview(res.photos.length) })
    reportSettings(supabase, centerId).then(res => { if (!cancelled && res.success) setReportsOn(res.settings.enabled) })
    return () => { cancelled = true }
  }, [supabase, centerId, teacher, toast])

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
  // Teacher view: alerts and the log are about the room on screen
  const scopeRoom = locked ? homeRoomId : teacherView ? focusRoom.id : null
  const alerts = rooms.filter(r => statuses[r.id].code === 'out' && (!scopeRoom || r.id === scopeRoom))
  const fs = statuses[focusRoom.id]
  const selected = people.find(p => p.person_id === selectedId) ?? null
  // Children checked in to the room on screen (Classroom, Playground or Lobby), for class actions
  const presentKids = people
    .filter(p => p.kind === 'child' && p.zone !== 'home' && p.work_area_id === focusRoom.id)
    .sort((a, b) => a.first_name.localeCompare(b.first_name))
  // Napping here, and the next required sleep check (infants 12 months and under)
  const presentIds = new Set(presentKids.map(k => k.person_id))
  const napsHere = roomNaps.filter(n => presentIds.has(n.child_id))
  const nextDue = napsHere
    .filter(n => sleepChecksRequired(people.find(p => p.person_id === n.child_id)?.age_months))
    .map(n => nextCheck({ at: n.started_at, last_check_at: n.last_check_at }, n.check_minutes, clock))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0]

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
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-heading">{teacher ? 'My room' : 'Live roster'}</h1>
            {!teacher && (
              <div role="radiogroup" aria-label="View" className="flex rounded-full bg-surface-2 p-1">
                {(['admin', 'teacher'] as const).map(v => (
                  <button key={v} type="button" role="radio" aria-checked={adminView === v} onClick={() => chooseView(v)}
                    className={`min-h-9 rounded-full px-3.5 text-xs font-bold ${adminView === v ? 'bg-white text-heading shadow-sm' : 'text-muted hover:text-heading'}`}>
                    {v === 'admin' ? 'Admin' : 'Teacher view'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {busy > 0 && <span className="inline-flex items-center gap-1.5 text-xs font-bold text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>}
          {!teacher && (
            <Link href="/center/roster/photos"
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold hover:bg-surface ${toReview ? 'border-[#e8a33d] bg-[#fff0d1] text-[#7a4b00]' : 'border-border bg-white text-text-main'}`}>
              <Camera className="h-3.5 w-3.5 text-brand-600" /> Photo review{toReview ? ` (${toReview})` : ''}
            </Link>
          )}
          {!teacher && reportsOn != null && (
            <button type="button" onClick={() => setReportDialog(true)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-white px-3 text-xs font-bold text-text-main hover:bg-surface">
              <Mail className="h-3.5 w-3.5 text-brand-600" /> Parent reports: {reportsOn ? 'On' : 'Off'}
            </button>
          )}
          {!teacherView && (
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
      ) : teacherView ? null : (
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
          {teacherView && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface/50 p-2.5">
              <span className="mr-auto inline-flex items-center gap-2 px-1 text-sm text-muted">
                <BookOpen className="h-4 w-4 text-brand-600" /> <span><span className="font-bold text-heading">Today&apos;s plan</span> · Lesson plan coming soon</span>
              </span>
              <button type="button" onClick={() => setClassAction('meal')}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-bold text-heading hover:bg-surface">
                <Utensils className="h-4 w-4 text-brand-600" /> Meal served
              </button>
              <button type="button" onClick={() => setClassAction('activity')}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-bold text-heading hover:bg-surface">
                <ClipboardList className="h-4 w-4 text-brand-600" /> Activity with class
              </button>
              <button type="button" onClick={() => setClassPhoto(true)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-bold text-heading hover:bg-surface">
                <Camera className="h-4 w-4 text-brand-600" /> Class photo
              </button>
              <div className="flex w-full flex-wrap items-center gap-2 border-t border-border pt-2">
                <span className={`mr-auto inline-flex items-center gap-2 px-1 text-sm ${nextDue?.overdue ? 'font-bold text-[#7a4b00]' : 'text-muted'}`} role="status">
                  <Moon className="h-4 w-4 text-[#3b5bab]" />
                  {napsHere.length === 0 ? 'No one napping'
                    : `${napsHere.length} napping${nextDue ? (nextDue.overdue ? ' · sleep check due now' : ` · next check ${clockTime(nextDue.dueAt.toISOString())}`) : ''}`}
                </span>
                <button type="button" onClick={() => setNapAction('start')}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-bold text-heading hover:bg-surface">
                  <Moon className="h-4 w-4 text-[#3b5bab]" /> Nap time
                </button>
                {napsHere.length > 0 && (
                  <>
                    <button type="button" onClick={() => setNapAction('check')}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold ${nextDue?.overdue ? 'bg-[#b56a00] text-white' : 'border border-border bg-white text-heading hover:bg-surface'}`}>
                      Sleep check
                    </button>
                    <button type="button" onClick={() => setNapAction('wake')}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-bold text-heading hover:bg-surface">
                      <Sun className="h-4 w-4 text-[#b56a00]" /> Everyone up
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {/* Children with no home room still wait in the Lobby; teachers with no home room are parked below */}
          <RoomStage room={focusRoom} status={fs} seats={peopleInRoom(focusRoom.id, people)} waiting={waiting.filter(p => p.kind === 'child')} photos={photos} tintOf={tintOf} visitingFrom={visitingFrom} ix={ix} />
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
              onOpen={locked ? undefined : () => openRoom(r.id)}
              ix={ix}
              preview={tilePreview(r)}
              style={{ ['--c' as string]: s.col, ['--r' as string]: s.row }}
            />
          )
        })}

      </div>

      {floatersFree.length > 0 && (
        <section aria-labelledby="parked-h" className="rounded-3xl border border-dashed border-[#9aa6b2] bg-white px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="mr-2">
              <h2 id="parked-h" className="text-sm font-bold text-heading">Parked teachers</h2>
              <p className="text-xs text-muted">No home room, not checked in. Drag into a room to check in.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {floatersFree.map(p => (
                <Chip key={p.person_id} person={p} url={photos[p.person_id]} tint="#dce3ea" size={36} dashed ix={ix} />
              ))}
            </div>
          </div>
        </section>
      )}

      <TransitionsLog supabase={supabase} centerId={centerId} today={day} refreshKey={logKey} people={people} roomName={roomName} onlyRoom={scopeRoom} />

      {selected && teacherView && selected.kind === 'child' && (
        <ChildCard
          key={selected.person_id}
          supabase={supabase}
          centerId={centerId}
          day={day}
          person={selected}
          rooms={rooms}
          photo={photos[selected.person_id]}
          tint={tintOf(selected)}
          busy={busy > 0}
          refreshKey={logKey}
          onMove={move}
          onChanged={() => { reload() }}
          onClose={() => setSelectedId(null)}
        />
      )}

      {selected && !(teacherView && selected.kind === 'child') && (
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

      {classPhoto && (
        <ClassPhotoDialog
          centerId={centerId}
          room={focusRoom}
          children={presentKids}
          photos={photos}
          tintOf={tintOf}
          onClose={() => setClassPhoto(false)}
          onDone={msg => { setClassPhoto(false); setToast(msg) }}
        />
      )}

      {napAction && (
        <RoomNapDialog
          supabase={supabase}
          centerId={centerId}
          room={focusRoom}
          mode={napAction}
          children={presentKids}
          naps={roomNaps}
          photos={photos}
          tintOf={tintOf}
          onClose={() => setNapAction(null)}
          onDone={msg => { setNapAction(null); setToast(msg); reloadNaps() }}
        />
      )}

      {classAction && (
        <ClassEntryDialog
          supabase={supabase}
          centerId={centerId}
          room={focusRoom}
          kind={classAction}
          children={presentKids}
          photos={photos}
          tintOf={tintOf}
          onClose={() => setClassAction(null)}
          onDone={msg => { setClassAction(null); setToast(msg); setLogKey(k => k + 1) }}
        />
      )}

      {reportDialog && (
        <ReportSettingsDialog supabase={supabase} centerId={centerId} onClose={() => setReportDialog(false)}
          onSaved={st => { setReportDialog(false); setReportsOn(st.enabled); setToast(st.enabled ? 'Parent daily reports are on.' : 'Parent daily reports are off.') }} />
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

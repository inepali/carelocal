'use client'

import { useEffect, useRef, useState } from 'react'
import { Home, DoorOpen, Sun } from 'lucide-react'
import type { RosterPerson, RosterRoom, RoomStatus } from '@/lib/roster-ratio'
import { Chip, PersonAvatar } from './PersonAvatar'
import { StatusPill } from './RoomTile'
import { dropKey, type RosterInteract } from './useRosterDrag'

type Seats = { home: RosterPerson[]; classroom: RosterPerson[]; playground: RosterPerson[]; lobby: RosterPerson[] }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const DROP_RING = 'inset 0 0 0 4px rgba(35,87,217,0.55)'

/** Largest and smallest a child's face gets in the Classroom circle, in px */
const KID_MAX = 64
const KID_MIN = 26
/** Ring radii, as % of the circle's diameter, for 1, 2 and 3 rings (outermost first) */
const RING_RADII = [[37], [40, 24], [41, 30, 19]]

/**
 * Fit n children into the Classroom circle without overlap. Each ring's kids get a share proportional
 * to its circumference; the face size is whatever fits the tightest ring (arc spacing) and the gap
 * between rings, capped at KID_MAX. Add a ring only when that lets faces be bigger.
 */
export function kidLayout(n: number, diameter: number) {
  let best: { kidSize: number; rings: { count: number; rad: number }[] } | null = null
  for (const radii of RING_RADII) {
    if (radii.length > 1 && n <= radii.length * 4) break   // a handful of kids never needs another ring
    const total = radii.reduce((a, b) => a + b, 0)
    let left = n
    const rings = radii.map((rad, i) => {
      const count = i === radii.length - 1 ? left : Math.min(left, Math.round((n * rad) / total))
      left -= count
      return { count, rad }
    })
    const px = (pct: number) => (pct / 100) * diameter
    const arc = Math.min(...rings.map(r => (r.count ? (2 * Math.PI * px(r.rad)) / r.count : Infinity)))
    const gap = radii.length > 1 ? Math.min(...radii.slice(1).map((r, i) => px(radii[i] - r))) : Infinity
    // Faces at the outer ring must also stay inside the circle's edge
    const edge = 2 * px(50 - radii[0]) + px(4)
    const size = Math.floor(Math.min(KID_MAX, arc * 0.84, gap * 0.92, edge))
    if (!best || size > best.kidSize + 2) best = { kidSize: size, rings }
  }
  return { kidSize: Math.max(KID_MIN, best!.kidSize), rings: best!.rings }
}

/** The Classroom circle's rendered width, kept current as the screen resizes */
function useCircleDiameter(ref: React.RefObject<HTMLDivElement | null>) {
  const [d, setD] = useState(560)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => { if (el.offsetWidth) setD(el.offsetWidth) }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return d
}

/**
 * The selected room, as in the approved mockup: the green Classroom circle sits on top of a rectangle whose
 * top half is Home (checked out or not arrived) and whose bottom half is split into Playground and Lobby.
 * Each of the four is a drop target: Home checks out, the others check in or move. Up to 12 children sit in
 * one ring; more go into two rings.
 */
export function RoomStage({
  room,
  status,
  seats,
  waiting,
  photos,
  tintOf,
  visitingFrom,
  themeUrl,
  circleUrl,
  circleEditor,
  centerActions,
  fill = false,
  ix,
}: {
  room: RosterRoom
  status: RoomStatus
  seats: Seats
  /** Waiting for a room: substitutes whose shift has no room, and children who need a home room. Shown in the Lobby */
  waiting: RosterPerson[]
  photos: Record<string, string>
  tintOf: (p: RosterPerson) => string
  visitingFrom: (p: RosterPerson) => string | null
  /** The room's background picture (set by an admin); the zones and the circle become translucent over it */
  themeUrl?: string | null
  /** The Classroom circle's own picture; without one the circle shows the room picture through its green */
  circleUrl?: string | null
  /** Admin's pencil for the circle picture, shown at the bottom of the circle */
  circleEditor?: React.ReactNode
  /** Round icon buttons (Activities, Meal, Photo, Nap) in the middle of the circle, between the teachers */
  centerActions?: React.ReactNode
  /** Full screen: the stage fills the height it is given instead of keeping a fixed shape */
  fill?: boolean
  ix: RosterInteract
}) {
  /** A zone color, see-through enough to show the room picture behind it */
  const tone = (color: string) => (themeUrl ? `color-mix(in srgb, ${color} 58%, transparent)` : color)
  const kids = seats.classroom.filter(p => p.kind === 'child')
  const teachers = seats.classroom.filter(p => p.kind === 'staff')
  const n = kids.length
  const circleRef = useRef<HTMLDivElement>(null)
  const diameter = useCircleDiameter(circleRef)
  const layout = kidLayout(n, diameter)
  const { kidSize, rings } = layout
  const twoRings = rings.length > 1
  // Leave room in the middle for the buttons: teachers a little smaller and further apart
  const teacherBase = rings.length > 2 ? 44 : twoRings ? 52 : teachers.length >= 3 ? 68 : centerActions ? 72 : 84
  const teacherSize = Math.round(Math.min(teacherBase, diameter * 0.15))
  const chipSize = Math.round(Math.min(64, kidSize) / 2)

  const kidSpot = (i: number) => {
    let start = 0
    let r = 0
    while (r < rings.length - 1 && i >= start + rings[r].count) { start += rings[r].count; r++ }
    const { count, rad } = rings[r]
    const j = i - start
    // Stagger alternate rings by half a step so faces don't line up radially
    const ang = -Math.PI / 2 + (r % 2 ? Math.PI / Math.max(count, 1) : 0) + (2 * Math.PI * j) / Math.max(count, 1)
    return { left: `${50 + rad * Math.cos(ang)}%`, top: `${50 + rad * Math.sin(ang)}%` }
  }
  const teacherSpot = (i: number) => {
    if (teachers.length <= 1) return centerActions ? { left: '36%', top: '50%' } : { left: '50%', top: '50%' }   // one teacher sits beside the buttons
    const off = rings.length > 2 ? 8 : twoRings ? 10 : centerActions && teachers.length === 2 ? 20 : 16
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / teachers.length + (teachers.length === 2 ? Math.PI / 2 : 0)
    return { left: `${50 + off * Math.cos(ang)}%`, top: `${50 + off * Math.sin(ang)}%` }
  }

  const keys = {
    home: dropKey(room.id, 'home'),
    classroom: dropKey(room.id, 'classroom'),
    playground: dropKey(room.id, 'playground'),
    lobby: dropKey(room.id, 'lobby'),
  }
  const isOver = (k: string) => ix.over === k
  const zoneShadow = (k: string) => (ix.isDragging ? (isOver(k) ? DROP_RING : 'inset 0 0 0 2px rgba(35,87,217,0.25)') : undefined)

  const homeKids = seats.home.filter(p => p.kind === 'child').length
  const play = status.groups.playground
  const lobby = status.groups.lobby
  const waitingStaff = waiting.filter(p => p.kind === 'staff').length
  const waitingKids = waiting.length - waitingStaff
  const waitingLabel = [waitingStaff ? plural(waitingStaff, 'substitute', 'substitutes') : '', waitingKids ? `${plural(waitingKids, 'child', 'children')} with no home room` : '']
    .filter(Boolean).join(', ')

  const column = (people: RosterPerson[], side: 'left' | 'right', top: string, bottom: string, width: string, dashed: boolean | ((p: RosterPerson) => boolean), empty?: string) => (
    <div className="absolute flex flex-wrap content-start justify-center gap-1.5 overflow-y-auto" style={{ [side]: 8, width, top, bottom }}>
      {people.map(p => <Chip key={p.person_id} person={p} url={photos[p.person_id]} tint={tintOf(p)} size={chipSize} dashed={typeof dashed === 'function' ? dashed(p) : dashed} ix={ix} />)}
      {empty && people.length === 0 && <span className="text-center text-xs opacity-80">{empty}</span>}
    </div>
  )
  const even = (xs: RosterPerson[]) => xs.filter((_, i) => i % 2 === 0)
  const odd = (xs: RosterPerson[]) => xs.filter((_, i) => i % 2 === 1)

  return (
    <div className={`relative mx-auto w-full overflow-hidden rounded-[20px] border border-border bg-cover bg-center ${fill ? 'my-3 min-h-0 flex-1' : 'my-5 aspect-[10/9] lg:aspect-[16/10]'}`}
      style={themeUrl ? { backgroundImage: `url("${themeUrl}")` } : undefined}>
      {/* Home: checked out or not arrived. Dropping here checks out. */}
      <div
        data-drop={keys.home}
        className="absolute inset-x-0 top-0 h-1/2 border-b-[3px] border-[#b42318] text-[#7e1a14] transition-colors"
        style={{ background: tone(isOver(keys.home) ? '#edb0a9' : '#f3c6c1'), boxShadow: zoneShadow(keys.home) }}
      >
        <div className="absolute inset-x-3.5 top-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-2 text-sm"><Home className="h-[18px] w-[18px]" />Home · checked out or absent</span>
          <span className="text-xs">{plural(homeKids, 'child', 'children')}</span>
        </div>
        {column(even(seats.home), 'left', '52px', '8px', 'calc(16% - 10px)', true, 'Everyone is here')}
        {column(odd(seats.home), 'right', '52px', '8px', 'calc(16% - 10px)', true)}
      </div>

      {/* Playground */}
      <div
        data-drop={keys.playground}
        className="absolute bottom-0 left-0 h-1/2 w-1/2 border-r-2 border-t-[3px] border-r-[rgba(22,32,42,0.25)] border-t-[#a86b00] text-[#5c3b00] transition-colors"
        style={{ background: tone(isOver(keys.playground) ? '#f1d27f' : '#f8e2a8'), boxShadow: zoneShadow(keys.playground) }}
      >
        {column(seats.playground, 'left', '12px', '64px', 'calc(22% - 10px)', false, 'Nobody outside')}
        <div className="absolute inset-x-3 bottom-2.5 flex flex-col items-start gap-1">
          <span className="inline-flex items-center gap-1.5 text-sm"><Sun className="h-[18px] w-[18px]" />Playground</span>
          <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
            {plural(play.children, 'child', 'children')} · {plural(play.teachers, 'teacher', 'teachers')}
            <StatusPill code={play.code} label={play.label} />
          </span>
        </div>
      </div>

      {/* Lobby */}
      <div
        data-drop={keys.lobby}
        className="absolute bottom-0 right-0 h-1/2 w-1/2 border-t-[3px] border-t-[#2c5c9a] text-[#1d3f6e] transition-colors"
        style={{ background: tone(isOver(keys.lobby) ? '#b3cdee' : '#cfe0f5'), boxShadow: zoneShadow(keys.lobby) }}
      >
        {column([...seats.lobby, ...waiting], 'right', '12px', waitingLabel ? '84px' : '64px', 'calc(22% - 10px)', p => waiting.includes(p), 'Pickups, drop-offs')}
        <div className="absolute inset-x-3 bottom-2.5 flex flex-col items-end gap-1">
          <span className="inline-flex items-center gap-1.5 text-sm"><DoorOpen className="h-[18px] w-[18px]" />Lobby</span>
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-xs">
            {plural(lobby.children, 'child', 'children')} · {plural(lobby.teachers, 'teacher', 'teachers')}
            <StatusPill code={lobby.code} label={lobby.label} />
          </span>
          {waitingLabel && <span className="text-[11px] opacity-90">Waiting (not checked in): {waitingLabel}</span>}
        </div>
      </div>

      {/* Classroom circle */}
      <div
        ref={circleRef}
        data-drop={keys.classroom}
        className="absolute left-1/2 top-1/2 z-[2] aspect-square h-[76%] -translate-x-1/2 -translate-y-1/2 rounded-full lg:h-[88%] transition-colors"
        style={{
          background: circleUrl
            ? `linear-gradient(${isOver(keys.classroom) ? 'rgba(168,217,186,0.6)' : 'rgba(191,227,204,0.4)'}, ${isOver(keys.classroom) ? 'rgba(168,217,186,0.6)' : 'rgba(191,227,204,0.4)'}), url("${circleUrl}") center / cover`
            : tone(isOver(keys.classroom) ? '#a8d9ba' : '#bfe3cc'),
          border: isOver(keys.classroom) ? '4px dashed #14532d' : '4px solid #1e7a47',
          boxShadow: '0 6px 20px rgba(22,32,42,0.22)',
        }}
        role="group"
        aria-label={`${room.name} classroom: ${plural(status.groups.classroom.children, 'child', 'children')}, ${plural(status.groups.classroom.teachers, 'teacher', 'teachers')}`}
      >
        <span className="pointer-events-none absolute left-1/2 top-0 z-[3] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#1e7a47] px-3 py-1 text-xs text-white">
          Classroom · {plural(status.groups.classroom.children, 'child', 'children')} · {plural(status.groups.classroom.teachers, 'teacher', 'teachers')}
        </span>
        {circleEditor && <div className="absolute bottom-[3%] left-1/2 z-[4] -translate-x-1/2">{circleEditor}</div>}
        {teachers.length === 0 && n > 0 && (
          <div className="pointer-events-none absolute left-1/2 flex h-[120px] w-[120px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-dashed border-[#d14b3f] p-3 text-center text-xs text-[#a3221b]"
            style={{ left: centerActions ? '36%' : '50%', top: '50%' }}>
            No teacher checked in
          </div>
        )}
        {centerActions && (
          // Taps here are button presses, never the start of a drag
          <div className="absolute top-1/2 z-[4] grid -translate-x-1/2 -translate-y-1/2 grid-cols-2 place-items-center gap-2"
            style={{ left: teachers.length <= 1 ? '62%' : '50%' }}
            onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
            {centerActions}
          </div>
        )}
        {teachers.map((t, i) => (
          <PersonAvatar key={t.person_id} person={t} url={photos[t.person_id]} tint="#dce3ea" size={teacherSize} label={twoRings ? 'none' : 'below'} style={teacherSpot(i)} ix={ix} />
        ))}
        {kids.map((k, i) => (
          <PersonAvatar
            key={k.person_id}
            person={k}
            url={photos[k.person_id]}
            tint={tintOf(k)}
            size={kidSize}
            visitingFrom={visitingFrom(k)}
            label={!twoRings && kidSize >= 52 ? 'below' : 'none'}
            float={i}
            style={kidSpot(i)}
            ix={ix}
          />
        ))}
      </div>
    </div>
  )
}

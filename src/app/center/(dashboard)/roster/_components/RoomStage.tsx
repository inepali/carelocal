'use client'

import { Home, DoorOpen, Sun } from 'lucide-react'
import type { RosterPerson, RosterRoom, RoomStatus } from '@/lib/roster-ratio'
import { Chip, PersonAvatar } from './PersonAvatar'
import { StatusPill } from './RoomTile'
import { dropKey, type RosterInteract } from './useRosterDrag'

type Seats = { home: RosterPerson[]; classroom: RosterPerson[]; playground: RosterPerson[]; lobby: RosterPerson[] }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const DROP_RING = 'inset 0 0 0 4px rgba(35,87,217,0.55)'

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
  floaters,
  photos,
  tintOf,
  visitingFrom,
  ix,
}: {
  room: RosterRoom
  status: RoomStatus
  seats: Seats
  /** Teachers with no home room who are not checked in anywhere: they wait in the Lobby, available to any room */
  floaters: RosterPerson[]
  photos: Record<string, string>
  tintOf: (p: RosterPerson) => string
  visitingFrom: (p: RosterPerson) => string | null
  ix: RosterInteract
}) {
  const kids = seats.classroom.filter(p => p.kind === 'child')
  const teachers = seats.classroom.filter(p => p.kind === 'staff')
  const n = kids.length
  const twoRings = n > 12
  const kidSize = n <= 12 ? 64 : n <= 18 ? 54 : 48
  const outerN = twoRings ? Math.ceil(n * 0.58) : n
  const teacherSize = twoRings ? 52 : teachers.length >= 3 ? 68 : 84
  const chipSize = Math.round(kidSize / 2)

  const kidSpot = (i: number) => {
    const onOuter = i < outerN
    const ringN = onOuter ? outerN : n - outerN
    const j = onOuter ? i : i - outerN
    const rad = twoRings ? (onOuter ? 40 : 23) : 37
    const ang = -Math.PI / 2 + (onOuter ? 0 : Math.PI / Math.max(ringN, 1)) + (2 * Math.PI * j) / Math.max(ringN, 1)
    return { left: `${50 + rad * Math.cos(ang)}%`, top: `${50 + rad * Math.sin(ang)}%` }
  }
  const teacherSpot = (i: number) => {
    if (teachers.length <= 1) return { left: '50%', top: '50%' }
    const off = twoRings ? 10 : 16
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

  const column = (people: RosterPerson[], side: 'left' | 'right', top: string, bottom: string, width: string, dashed: boolean | ((p: RosterPerson) => boolean), empty?: string) => (
    <div className="absolute flex flex-wrap content-start justify-center gap-1.5 overflow-y-auto" style={{ [side]: 8, width, top, bottom }}>
      {people.map(p => <Chip key={p.person_id} person={p} url={photos[p.person_id]} tint={tintOf(p)} size={chipSize} dashed={typeof dashed === 'function' ? dashed(p) : dashed} ix={ix} />)}
      {empty && people.length === 0 && <span className="text-center text-xs font-semibold opacity-80">{empty}</span>}
    </div>
  )
  const even = (xs: RosterPerson[]) => xs.filter((_, i) => i % 2 === 0)
  const odd = (xs: RosterPerson[]) => xs.filter((_, i) => i % 2 === 1)

  return (
    <div className="relative mx-auto my-5 aspect-[10/9] w-full overflow-hidden lg:aspect-[16/10] rounded-[20px] border border-border">
      {/* Home: checked out or not arrived. Dropping here checks out. */}
      <div
        data-drop={keys.home}
        className="absolute inset-x-0 top-0 h-1/2 border-b-[3px] border-[#b42318] text-[#7e1a14] transition-colors"
        style={{ background: isOver(keys.home) ? '#edb0a9' : '#f3c6c1', boxShadow: zoneShadow(keys.home) }}
      >
        <div className="absolute inset-x-3.5 top-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-2 text-sm font-bold"><Home className="h-[18px] w-[18px]" />Home · checked out or absent</span>
          <span className="text-xs font-bold">{plural(homeKids, 'child', 'children')}</span>
        </div>
        {column(even(seats.home), 'left', '52px', '8px', 'calc(18% - 10px)', true, 'Everyone is here')}
        {column(odd(seats.home), 'right', '52px', '8px', 'calc(18% - 10px)', true)}
      </div>

      {/* Playground */}
      <div
        data-drop={keys.playground}
        className="absolute bottom-0 left-0 h-1/2 w-1/2 border-r-2 border-t-[3px] border-r-[rgba(22,32,42,0.25)] border-t-[#a86b00] text-[#5c3b00] transition-colors"
        style={{ background: isOver(keys.playground) ? '#f1d27f' : '#f8e2a8', boxShadow: zoneShadow(keys.playground) }}
      >
        {column(seats.playground, 'left', '12px', '64px', 'calc(22% - 10px)', false, 'Nobody outside')}
        <div className="absolute inset-x-3 bottom-2.5 flex flex-col items-start gap-1">
          <span className="inline-flex items-center gap-1.5 text-sm font-bold"><Sun className="h-[18px] w-[18px]" />Playground</span>
          <span className="inline-flex flex-wrap items-center gap-1.5 text-xs font-bold">
            {plural(play.children, 'child', 'children')} · {plural(play.teachers, 'teacher', 'teachers')}
            <StatusPill code={play.code} label={play.label} />
          </span>
        </div>
      </div>

      {/* Lobby */}
      <div
        data-drop={keys.lobby}
        className="absolute bottom-0 right-0 h-1/2 w-1/2 border-t-[3px] border-t-[#2c5c9a] text-[#1d3f6e] transition-colors"
        style={{ background: isOver(keys.lobby) ? '#b3cdee' : '#cfe0f5', boxShadow: zoneShadow(keys.lobby) }}
      >
        {column([...seats.lobby, ...floaters], 'right', '12px', '64px', 'calc(22% - 10px)', p => floaters.includes(p), 'Pickups, drop-offs')}
        <div className="absolute inset-x-3 bottom-2.5 flex flex-col items-end gap-1">
          <span className="inline-flex items-center gap-1.5 text-sm font-bold"><DoorOpen className="h-[18px] w-[18px]" />Lobby</span>
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-xs font-bold">
            {plural(lobby.children, 'child', 'children')} · {plural(lobby.teachers, 'teacher', 'teachers')}
            <StatusPill code={lobby.code} label={lobby.label} />
          </span>
        </div>
      </div>

      {/* Classroom circle */}
      <div
        data-drop={keys.classroom}
        className="absolute left-1/2 top-1/2 z-[2] aspect-square h-[76%] -translate-x-1/2 -translate-y-1/2 rounded-full lg:h-[88%] transition-colors"
        style={{
          background: isOver(keys.classroom) ? '#a8d9ba' : '#bfe3cc',
          border: isOver(keys.classroom) ? '4px dashed #14532d' : '4px solid #1e7a47',
          boxShadow: '0 6px 20px rgba(22,32,42,0.22)',
        }}
        role="group"
        aria-label={`${room.name} classroom: ${plural(status.groups.classroom.children, 'child', 'children')}, ${plural(status.groups.classroom.teachers, 'teacher', 'teachers')}`}
      >
        <span className="pointer-events-none absolute left-1/2 top-0 z-[3] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#1e7a47] px-3 py-1 text-xs font-bold text-white">
          Classroom · {plural(status.groups.classroom.children, 'child', 'children')} · {plural(status.groups.classroom.teachers, 'teacher', 'teachers')}
        </span>
        {teachers.length === 0 && n > 0 && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-[120px] w-[120px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-dashed border-[#d14b3f] p-3 text-center text-xs font-bold text-[#a3221b]">
            No teacher checked in
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
            label={n <= 12 ? 'below' : 'none'}
            float={i}
            style={kidSpot(i)}
            ix={ix}
          />
        ))}
      </div>
    </div>
  )
}

'use client'

import { Home, DoorOpen, Sun } from 'lucide-react'
import type { RosterPerson, RosterRoom, RoomStatus } from '@/lib/roster-ratio'
import { PersonAvatar } from './PersonAvatar'
import { StatusPill } from './RoomTile'

type Seats = { home: RosterPerson[]; classroom: RosterPerson[]; playground: RosterPerson[]; lobby: RosterPerson[] }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The selected room, as in the approved mockup: the green Classroom circle sits on top of a rectangle whose
 * top half is Home (checked out or not arrived) and whose bottom half is split into Playground and Lobby.
 * Up to 12 children sit in one ring; more go into two rings. Read-only in phase 2.
 */
export function RoomStage({
  room,
  status,
  seats,
  photos,
  tintOf,
  visitingFrom,
}: {
  room: RosterRoom
  status: RoomStatus
  seats: Seats
  photos: Record<string, string>
  tintOf: (p: RosterPerson) => string
  visitingFrom: (p: RosterPerson) => string | null
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

  const homeKids = seats.home.filter(p => p.kind === 'child').length
  const play = status.groups.playground
  const lobby = status.groups.lobby

  const chipColumn = (people: RosterPerson[], side: 'left' | 'right', top: string, bottom: string, width: string, dashed: boolean, empty?: string) => (
    <div className="absolute flex flex-wrap content-start justify-center gap-1.5 overflow-y-auto" style={{ [side]: 8, width, top, bottom }}>
      {people.map(p => (
        <div key={p.person_id} className="relative flex w-[52px] flex-col items-center gap-0.5" title={`${p.first_name} ${p.last_initial}.`}>
          <span
            className="flex items-center justify-center overflow-hidden rounded-full text-[10px] font-bold text-heading"
            style={{
              width: chipSize, height: chipSize,
              background: p.kind === 'staff' ? '#dce3ea' : tintOf(p),
              border: `2px ${dashed ? 'dashed' : 'solid'} ${p.kind === 'staff' ? '#16202a' : dashed ? '#7e1a14' : '#ffffff'}`,
            }}
          >
            {photos[p.person_id]
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              ? <img src={photos[p.person_id]} alt="" className="h-full w-full object-cover" draggable={false} />
              : `${p.first_name[0] ?? ''}${p.last_initial}`.toUpperCase()}
          </span>
          <span className="max-w-[52px] truncate text-[10px] font-semibold text-heading">{p.first_name} {p.last_initial}.</span>
        </div>
      ))}
      {empty && people.length === 0 && <span className="text-center text-xs font-semibold opacity-80">{empty}</span>}
    </div>
  )
  const even = (xs: RosterPerson[]) => xs.filter((_, i) => i % 2 === 0)
  const odd = (xs: RosterPerson[]) => xs.filter((_, i) => i % 2 === 1)

  return (
    <div className="relative mx-auto my-5 aspect-[10/9] w-full max-w-[780px] overflow-hidden rounded-[20px] border border-border">
      {/* Home: checked out or not arrived */}
      <div className="absolute inset-x-0 top-0 h-1/2 border-b-[3px] border-[#b42318] bg-[#f3c6c1] text-[#7e1a14]">
        <div className="absolute inset-x-3.5 top-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-2 text-sm font-bold"><Home className="h-[18px] w-[18px]" />Home · checked out or absent</span>
          <span className="text-xs font-bold">{plural(homeKids, 'child', 'children')}</span>
        </div>
        {chipColumn(even(seats.home), 'left', '52px', '8px', 'calc(16% - 10px)', true, 'Everyone is here')}
        {chipColumn(odd(seats.home), 'right', '52px', '8px', 'calc(16% - 10px)', true)}
      </div>

      {/* Playground */}
      <div className="absolute bottom-0 left-0 h-1/2 w-1/2 border-r-2 border-t-[3px] border-r-[rgba(22,32,42,0.25)] border-t-[#a86b00] bg-[#f8e2a8] text-[#5c3b00]">
        {chipColumn(seats.playground, 'left', '12px', '64px', 'calc(32% - 10px)', false, 'Nobody outside')}
        <div className="absolute inset-x-3 bottom-2.5 flex flex-col items-start gap-1">
          <span className="inline-flex items-center gap-1.5 text-sm font-bold"><Sun className="h-[18px] w-[18px]" />Playground</span>
          <span className="inline-flex flex-wrap items-center gap-1.5 text-xs font-bold">
            {plural(play.children, 'child', 'children')} · {plural(play.teachers, 'teacher', 'teachers')}
            <StatusPill code={play.code} label={play.label} />
          </span>
        </div>
      </div>

      {/* Lobby */}
      <div className="absolute bottom-0 right-0 h-1/2 w-1/2 border-t-[3px] border-t-[#2c5c9a] bg-[#cfe0f5] text-[#1d3f6e]">
        {chipColumn(seats.lobby, 'right', '12px', '64px', 'calc(32% - 10px)', false, 'Pickups, drop-offs')}
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
        className="absolute left-[16%] top-1/2 z-[2] aspect-square w-[68%] -translate-y-1/2 rounded-full border-4 border-[#1e7a47] bg-[#bfe3cc] shadow-[0_6px_20px_rgba(22,32,42,0.22)]"
        role="group"
        aria-label={`${room.name} classroom: ${plural(status.groups.classroom.children, 'child', 'children')}, ${plural(status.groups.classroom.teachers, 'teacher', 'teachers')}`}
      >
        <span className="absolute left-1/2 top-0 z-[3] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#1e7a47] px-3 py-1 text-xs font-bold text-white">
          Classroom · {plural(status.groups.classroom.children, 'child', 'children')} · {plural(status.groups.classroom.teachers, 'teacher', 'teachers')}
        </span>
        {teachers.length === 0 && n > 0 && (
          <div className="absolute left-1/2 top-1/2 flex h-[120px] w-[120px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-dashed border-[#d14b3f] p-3 text-center text-xs font-bold text-[#a3221b]">
            No teacher checked in
          </div>
        )}
        {teachers.map((t, i) => (
          <PersonAvatar key={t.person_id} person={t} url={photos[t.person_id]} tint="#dce3ea" size={teacherSize} label={twoRings ? 'none' : 'below'} style={teacherSpot(i)} />
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
          />
        ))}
      </div>
    </div>
  )
}

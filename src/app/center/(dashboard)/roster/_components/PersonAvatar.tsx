'use client'

import type { CSSProperties } from 'react'
import type { RosterPerson } from '@/lib/roster-ratio'
import { ageLabel } from '@/lib/roster-ratio'
import type { RosterInteract } from './useRosterDrag'

const SELECTED_RING = '0 0 0 3px #2357d9'

export const initialsOf = (p: RosterPerson) => `${p.first_name[0] ?? ''}${p.last_initial}`.toUpperCase()

export function describePerson(p: RosterPerson, visitingFrom?: string | null) {
  return [
    `${p.first_name} ${p.last_initial}.`,
    p.kind === 'staff' ? (p.employment === 'substitute' ? 'substitute teacher' : 'teacher') : ageLabel(p.age_months),
    visitingFrom ? `visiting from ${visitingFrom}` : '',
    p.zone === 'home' ? 'not checked in' : '',
  ].filter(Boolean).join(', ')
}

/** The round headshot itself (photo or initials), shared by every place a person appears */
export function Face({ person, url, tint, size, border }: { person: RosterPerson; url?: string | null; tint: string; size: number | '100%'; border: string }) {
  return (
    <span
      className="relative box-border flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-heading"
      style={{
        ...(size === '100%' ? { width: '100%', aspectRatio: '1 / 1' } : { width: size, height: size }),
        background: person.kind === 'staff' ? '#dce3ea' : tint,
        border,
        fontSize: size === '100%' ? 9 : Math.max(9, Math.round(size / 3.4)),
      }}
    >
      {url
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable
        ? <img src={url} alt="" className="pointer-events-none h-full w-full object-cover" draggable={false} />
        : initialsOf(person)}
    </span>
  )
}

/**
 * A child or teacher in the classroom circle. Drag to move; tap or Enter to open their panel.
 * Teachers get a dark ring; a dot marks a visiting child.
 */
export function PersonAvatar({
  person,
  url,
  tint,
  size,
  visitingFrom,
  label = 'below',
  float,
  style,
  ix,
}: {
  person: RosterPerson
  url?: string | null
  tint: string
  size: number
  visitingFrom?: string | null
  label?: 'below' | 'none'
  float?: number
  style?: CSSProperties
  ix?: RosterInteract
}) {
  const isStaff = person.kind === 'staff'
  const describe = describePerson(person, visitingFrom)
  const selected = ix?.selectedId === person.person_id
  const ring = isStaff ? `${Math.max(2, Math.round(size / 22))}px solid #16202a` : '2px solid #ffffff'

  return (
    <button
      type="button"
      aria-label={`${describe}. Drag to move, or press to open.`}
      aria-pressed={selected}
      title={describe}
      onPointerDown={ix?.bind(person).onPointerDown}
      onClick={() => ix?.select(person)}
      className={`absolute flex cursor-grab touch-none select-none flex-col items-center border-0 bg-transparent p-0 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${float != null ? 'roster-float' : ''}`}
      style={{
        transform: 'translate(-50%, -50%)',
        opacity: ix?.draggingId === person.person_id ? 0.35 : 1,
        ...(float != null ? { animation: `roster-float ${(2.8 + (float % 5) * 0.3).toFixed(2)}s ease-in-out ${(-((float * 0.53) % 3)).toFixed(2)}s infinite` } : {}),
        ...style,
      }}
    >
      <span className="relative rounded-full shadow-sm" style={{ boxShadow: selected ? SELECTED_RING : undefined }}>
        <Face person={person} url={url} tint={tint} size={size} border={ring} />
        {visitingFrom && <span aria-hidden="true" className="absolute right-0 top-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-amber-600" />}
      </span>
      {label === 'below' && (
        <span className={`mt-1 max-w-[88px] truncate whitespace-nowrap rounded-full px-1.5 text-[11px] font-semibold leading-4 ${isStaff ? 'border border-border bg-white text-heading' : 'text-text-main'}`}>
          {person.first_name} {person.last_initial}.
        </span>
      )}
    </button>
  )
}

/** A half-size headshot with a name, for the Home / Playground / Lobby bands */
export function Chip({ person, url, tint, size, dashed, ix }: { person: RosterPerson; url?: string | null; tint: string; size: number; dashed: boolean; ix?: RosterInteract }) {
  const isStaff = person.kind === 'staff'
  const selected = ix?.selectedId === person.person_id
  const describe = describePerson(person)
  return (
    <button
      type="button"
      aria-label={`${describe}. Drag to move, or press to open.`}
      aria-pressed={selected}
      title={describe}
      onPointerDown={ix?.bind(person).onPointerDown}
      onClick={() => ix?.select(person)}
      className="relative flex w-[52px] cursor-grab touch-none select-none flex-col items-center gap-0.5 border-0 bg-transparent p-0 focus-visible:outline-3 focus-visible:outline-brand-600"
      style={{ opacity: ix?.draggingId === person.person_id ? 0.35 : 1 }}
    >
      <span className="rounded-full" style={{ boxShadow: selected ? SELECTED_RING : undefined }}>
        <Face person={person} url={url} tint={tint} size={size} border={`2px ${dashed ? 'dashed' : 'solid'} ${isStaff ? '#16202a' : dashed ? '#7e1a14' : '#ffffff'}`} />
      </span>
      <span className="max-w-[52px] truncate text-[10px] font-semibold text-heading">{person.first_name} {person.last_initial}.</span>
    </button>
  )
}

/** The small headshot in a room tile: draggable, but tapping it opens the tile's room */
export function MiniAvatar({ person, url, tint, size, ix }: { person: RosterPerson; url?: string | null; tint: string; size?: number; ix?: RosterInteract }) {
  const isStaff = person.kind === 'staff'
  return (
    <span
      onPointerDown={ix?.bind(person).onPointerDown}
      className="block cursor-grab touch-none select-none"
      style={{ opacity: ix?.draggingId === person.person_id ? 0.35 : 1 }}
      title={`${person.first_name} ${person.last_initial}.`}
    >
      <Face person={person} url={url} tint={tint} size={size ?? '100%'} border={isStaff ? '2px solid #16202a' : '1.5px solid rgba(22,32,42,0.3)'} />
    </span>
  )
}

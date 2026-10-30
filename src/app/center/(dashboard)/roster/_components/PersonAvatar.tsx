'use client'

import type { CSSProperties } from 'react'
import type { RosterPerson } from '@/lib/roster-ratio'
import { ageLabel } from '@/lib/roster-ratio'

/**
 * A child or teacher on the board: headshot on the age-group tint, initials when there is no photo.
 * Teachers get a dark ring; people who are not checked in get a dashed one. A dot marks a visiting child.
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
}: {
  person: RosterPerson
  url?: string | null
  tint: string
  size: number
  /** Name of the child's home room when they are in another room */
  visitingFrom?: string | null
  label?: 'below' | 'none'
  /** Bob gently (classroom circle); index staggers the motion */
  float?: number
  style?: CSSProperties
}) {
  const isStaff = person.kind === 'staff'
  const name = `${person.first_name} ${person.last_initial}.`
  const away = person.zone === 'home'
  const describe = [
    name,
    isStaff ? (person.employment === 'substitute' ? 'substitute teacher' : 'teacher') : ageLabel(person.age_months),
    visitingFrom ? `visiting from ${visitingFrom}` : '',
    away ? 'not checked in' : '',
  ].filter(Boolean).join(', ')

  const ring = isStaff
    ? `${Math.max(2, Math.round(size / 22))}px solid var(--color-heading, #16202a)`
    : away ? '2px dashed #9b2c22' : '2px solid #ffffff'

  return (
    <div
      role="img"
      aria-label={describe}
      title={describe}
      className={`absolute flex flex-col items-center ${float != null ? 'roster-float' : ''}`}
      style={{
        transform: 'translate(-50%, -50%)',
        ...(float != null ? { animation: `roster-float ${(2.8 + (float % 5) * 0.3).toFixed(2)}s ease-in-out ${(-((float * 0.53) % 3)).toFixed(2)}s infinite` } : {}),
        ...style,
      }}
    >
      <span
        className="relative flex items-center justify-center overflow-hidden rounded-full font-bold text-heading shadow-sm"
        style={{ width: size, height: size, background: isStaff ? '#dce3ea' : tint, border: ring, fontSize: Math.max(10, Math.round(size / 3.4)) }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable
          <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          `${person.first_name[0] ?? ''}${person.last_initial}`.toUpperCase()
        )}
      </span>
      {visitingFrom && (
        <span aria-hidden="true" className="absolute right-0 top-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-amber-600" />
      )}
      {label === 'below' && (
        <span
          className={`mt-1 max-w-[88px] truncate whitespace-nowrap rounded-full px-1.5 text-[11px] font-semibold leading-4 ${isStaff ? 'border border-border bg-white text-heading' : away ? 'text-[#7e1a14]' : 'text-text-main'}`}
        >
          {name}
        </span>
      )}
    </div>
  )
}

/** Small headshot in a room tile or a band (static, no absolute positioning) */
export function MiniAvatar({ person, url, tint, size }: { person: RosterPerson; url?: string | null; tint: string; size?: number }) {
  const isStaff = person.kind === 'staff'
  return (
    <span
      className="box-border flex items-center justify-center overflow-hidden rounded-full text-[9px] font-bold text-heading"
      style={{ ...(size ? { width: size, height: size } : { width: '100%', aspectRatio: '1 / 1' }), background: isStaff ? '#dce3ea' : tint, border: isStaff ? '2px solid #16202a' : '1.5px solid rgba(22,32,42,0.3)' }}
      title={`${person.first_name} ${person.last_initial}.`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        `${person.first_name[0] ?? ''}${person.last_initial}`.toUpperCase()
      )}
    </span>
  )
}

'use client'

import { AlertTriangle, Sparkles } from 'lucide-react'
import type { Classroom } from '@/lib/children'
import { ageInMonths, ageLabel, suggestHomeRoom } from '@/lib/roster-ratio'
import { FLD, LBL } from './ui'

const range = (r: Classroom) =>
  r.min_age_months != null && r.max_age_months != null ? `${ageLabel(r.min_age_months)} – ${ageLabel(r.max_age_months)}` : null

/** Spots left in a room, not counting the child being edited if they are already in it */
export function openSpots(room: Classroom, currentRoomId?: string | null) {
  if (room.capacity == null) return null
  const taken = (room.enrolled ?? 0) - (currentRoomId === room.id ? 1 : 0)
  return room.capacity - taken
}

/** The room to pre-pick for a date of birth, as of a day (YYYY-MM-DD) */
export function suggestedRoomFor(dob: string, onDay: string, classrooms: Classroom[]) {
  return suggestHomeRoom(dob ? ageInMonths(dob, onDay) : null, classrooms)
}

/**
 * The home room picker: every room with its ages and open spots, the room that fits the child's age, and a
 * warning when the chosen room is full or meant for another age group. The live roster seats a child in this
 * room at Home until they are checked in.
 */
export function HomeRoomField({
  classrooms,
  dob,
  onDay,
  value,
  onChange,
  currentRoomId,
}: {
  classrooms: Classroom[]
  dob: string
  /** The day the age is counted on (the first day, or today) */
  onDay: string
  value: string
  onChange: (id: string) => void
  /** The child's saved room when editing, so they do not count against its spots */
  currentRoomId?: string | null
}) {
  const age = dob ? ageInMonths(dob, onDay) : null
  const suggested = suggestHomeRoom(age, classrooms)
  const chosen = classrooms.find(c => c.id === value) ?? null
  const spots = chosen ? openSpots(chosen, currentRoomId) : null
  const outside = chosen && age != null && chosen.min_age_months != null && chosen.max_age_months != null
    && (age < chosen.min_age_months || age >= chosen.max_age_months)

  return (
    <div>
      <label className={LBL} htmlFor="home-room">Home room</label>
      <select id="home-room" value={value} onChange={e => onChange(e.target.value)} className={FLD}>
        <option value="">Not assigned</option>
        {classrooms.map(c => {
          const r = range(c)
          const s = openSpots(c, currentRoomId)
          return (
            <option key={c.id} value={c.id}>
              {[c.name, r, s == null ? null : s > 0 ? `${s} open` : 'full', suggested?.id === c.id ? 'suggested' : null].filter(Boolean).join(' · ')}
            </option>
          )
        })}
      </select>
      <div className="mt-1 space-y-0.5 text-[11px]">
        {age != null && (
          <p className="flex items-center gap-1 text-subtle">
            <Sparkles className="h-3 w-3 text-brand-600" />
            {ageLabel(age)} old
            {suggested
              ? suggested.id === value ? `, which fits ${suggested.name}.` : <>; {suggested.name} fits this age. <button type="button" onClick={() => onChange(suggested.id)} className="font-semibold text-brand-600 hover:underline">Use it</button></>
              : '. No room is set up for this age yet (add age ranges under About → Manage Data).'}
          </p>
        )}
        {chosen && spots != null && (
          <p className={spots > 0 ? 'text-subtle' : 'font-semibold text-amber-700'}>
            {spots > 0 ? `${spots} of ${chosen.capacity} spots open in ${chosen.name}.` : `${chosen.name} is full (${chosen.capacity} enrolled). You can still add the child.`}
          </p>
        )}
        {outside && (
          <p className="flex items-start gap-1 font-semibold text-amber-700">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            {chosen!.name} is for {range(chosen!)}. On the live roster a younger child tightens the room&apos;s ratio.
          </p>
        )}
      </div>
    </div>
  )
}

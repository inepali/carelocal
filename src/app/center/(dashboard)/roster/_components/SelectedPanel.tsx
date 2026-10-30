'use client'

import { LogIn, LogOut, X } from 'lucide-react'
import { ageLabel, roomStatus, simulateMove, type OnSiteZone, type RosterPerson, type RosterRoom, type StatusCode } from '@/lib/roster-ratio'
import type { RosterMove } from '@/lib/roster'
import { Face } from './PersonAvatar'
import { STATUS_PILL } from './RoomTile'

export const ZONE_LABEL: Record<RosterPerson['zone'], string> = { home: 'Home', classroom: 'Classroom', playground: 'Playground', lobby: 'Lobby' }

interface Option {
  key: string
  label: string
  to: RosterMove
  result: { code: StatusCode; text: string }
  warning: string | null
}

/**
 * The person someone tapped: where they are, check in or out, and every place they can go with what each
 * move would do to the ratio. This is also the keyboard path for everything drag-and-drop does.
 */
export function SelectedPanel({
  person,
  people,
  rooms,
  photo,
  tint,
  busy,
  onMove,
  onClose,
}: {
  person: RosterPerson
  people: RosterPerson[]
  rooms: RosterRoom[]
  photo?: string
  tint: string
  busy: boolean
  onMove: (p: RosterPerson, to: RosterMove) => void
  onClose: () => void
}) {
  const roomById = (id: string | null) => rooms.find(r => r.id === id) ?? null
  const current = roomById(person.work_area_id)
  const home = roomById(person.home_area_id)
  const onSite = person.zone !== 'home' && !!current
  const base = current ?? home
  const isStaff = person.kind === 'staff'

  const before = current ? roomStatus(current, people, rooms) : null
  const option = (to: RosterMove & { work_area_id: string; zone: OnSiteZone }, label: string): Option => {
    const sim = simulateMove(people, person.person_id, to)
    const target = roomById(to.work_area_id)!
    const after = roomStatus(target, sim, rooms)
    const sameRoom = to.work_area_id === person.work_area_id
    const g = sameRoom ? after.groups[to.zone] : after
    const code = sameRoom ? after.groups[to.zone].code : after.code
    const ratio = sameRoom ? after.groups[to.zone].effectiveRatio : after.effectiveRatio
    let warning: string | null = null
    if (onSite && current && before && current.id !== target.id) {
      const left = roomStatus(current, sim, rooms)
      if (before.code !== 'out' && left.code === 'out') warning = `${current.name} would go out of ratio`
    } else if (onSite && current && before && sameRoom) {
      const fromGroup = roomStatus(current, sim, rooms).groups[person.zone as OnSiteZone]
      if (before.groups[person.zone as OnSiteZone].code !== 'out' && fromGroup?.code === 'out') warning = `${ZONE_LABEL[person.zone]} would go out of ratio`
    }
    return { key: `${to.work_area_id}|${to.zone}`, label, to, result: { code, text: `${g.label}${ratio ? ` · 1:${ratio}` : ''}` }, warning }
  }

  const here: Option[] = base
    ? (['classroom', 'playground', 'lobby'] as const)
        .filter(z => !(onSite && person.zone === z && person.work_area_id === base.id))
        .map(z => option({ work_area_id: base.id, zone: z }, ZONE_LABEL[z]))
    : []
  const elsewhere: Option[] = rooms
    .filter(r => r.id !== base?.id)
    .map(r => option({ work_area_id: r.id, zone: 'classroom' }, r.name))

  const checkInTo = base
  const where = onSite ? `${current!.name} · ${ZONE_LABEL[person.zone]}${!isStaff && home && home.id !== current!.id ? ' (visiting)' : ''}` : 'Not checked in'

  return (
    <aside
      aria-label={`${person.first_name} ${person.last_initial}.`}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      className="fixed inset-x-3 bottom-3 z-40 max-h-[72vh] overflow-y-auto rounded-3xl border-2 border-[#2357d9] bg-white p-4 shadow-2xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[360px]"
    >
      <div className="flex items-center gap-3">
        <Face person={person} url={photo} tint={tint} size={48} border={isStaff ? '3px solid #16202a' : '2px solid #ffffff'} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-heading">{person.first_name} {person.last_initial}.</p>
          <p className="text-[13px] text-muted">
            {isStaff ? (person.employment === 'substitute' ? 'Substitute teacher' : 'Teacher') : ageLabel(person.age_months)}
            {home ? ` · Home room: ${home.name}` : isStaff ? ' · Floater' : ' · No home room'}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-muted hover:bg-surface-2">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-text-main">{where}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${onSite ? STATUS_PILL.ok : STATUS_PILL.empty}`}>{onSite ? 'Checked in' : 'Not checked in'}</span>
        {onSite ? (
          <button type="button" disabled={busy} onClick={() => onMove(person, { work_area_id: null, zone: 'home' })}
            className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-white px-3.5 text-[13px] font-bold text-heading hover:bg-surface disabled:opacity-50">
            <LogOut className="h-4 w-4" /> Check out
          </button>
        ) : (
          <button type="button" disabled={busy || !checkInTo} onClick={() => checkInTo && onMove(person, { work_area_id: checkInTo.id, zone: 'classroom' })}
            title={checkInTo ? `Check in to ${checkInTo.name}` : 'Pick a room below'}
            className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-full bg-brand-600 px-3.5 text-[13px] font-bold text-white hover:bg-brand-800 disabled:opacity-50">
            <LogIn className="h-4 w-4" /> Check in{checkInTo ? ` to ${checkInTo.name}` : ''}
          </button>
        )}
      </div>

      {here.length > 0 && <OptionList title={`In ${base!.name}`} options={here} busy={busy} onPick={o => onMove(person, o.to)} />}
      {elsewhere.length > 0 && <OptionList title={base ? 'Move to another room' : 'Check in to'} options={elsewhere} busy={busy} onPick={o => onMove(person, o.to)} />}
    </aside>
  )
}

function OptionList({ title, options, busy, onPick }: { title: string; options: Option[]; busy: boolean; onPick: (o: Option) => void }) {
  return (
    <>
      <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-muted">{title}</p>
      <div className="flex flex-col gap-1.5">
        {options.map(o => (
          <button key={o.key} type="button" disabled={busy} onClick={() => onPick(o)}
            className="flex min-h-12 w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-border bg-white px-3 py-2 text-left hover:bg-surface disabled:opacity-50">
            <span className="flex-1 basis-28 text-sm font-bold text-heading">{o.label}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_PILL[o.result.code]}`}>{o.result.text}</span>
            {o.warning && <span className="basis-full text-xs font-semibold text-[#a3221b]">{o.warning}</span>}
          </button>
        ))}
      </div>
    </>
  )
}

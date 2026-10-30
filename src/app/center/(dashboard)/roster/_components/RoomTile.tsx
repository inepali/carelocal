'use client'

import { ChevronRight } from 'lucide-react'
import type { RosterPerson, RosterRoom, RoomStatus, StatusCode } from '@/lib/roster-ratio'
import { MiniAvatar } from './PersonAvatar'

export const STATUS_PILL: Record<StatusCode, string> = {
  ok: 'bg-[#e2f2ea] text-[#17603f]',
  warn: 'bg-[#fff0d1] text-[#7a4b00]',
  out: 'bg-[#fce4e2] text-[#a3221b]',
  empty: 'bg-[#edf0f3] text-[#4a5562]',
}

export function StatusPill({ code, label, className = '' }: { code: StatusCode; label: string; className?: string }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_PILL[code]} ${className}`}>{label}</span>
}

/** A room beside the selected one: status, counts and who is in it. Tapping it brings it to the center. */
export function RoomTile({
  room,
  status,
  present,
  photos,
  tintOf,
  onOpen,
  style,
}: {
  room: RosterRoom
  status: RoomStatus
  present: RosterPerson[]
  photos: Record<string, string>
  tintOf: (p: RosterPerson) => string
  onOpen: () => void
  style?: React.CSSProperties
}) {
  const border = status.code === 'out' ? 'border-2 border-[#d14b3f]' : 'border border-border'
  return (
    <button
      type="button"
      onClick={onOpen}
      style={style}
      aria-label={`${room.name}: ${status.childrenIn} children, ${status.teachersIn} teachers, ${status.label}. Open room.`}
      className={`flex min-h-[150px] w-full flex-col rounded-2xl bg-white p-2.5 text-left shadow-sm transition hover:shadow-md focus-visible:outline-3 focus-visible:outline-brand-600 lg:[grid-column:var(--c)] lg:[grid-row:var(--r)] ${border}`}
    >
      <span className="flex flex-col items-start gap-1.5">
        <span className="text-[15px] font-bold leading-tight text-heading">{room.name}</span>
        <StatusPill code={status.code} label={status.label} />
      </span>
      <span className="mt-1 block text-[11px] text-muted">
        {status.effectiveRatio ? `1:${status.effectiveRatio}` : 'No ratio'}{room.capacity != null ? ` · cap ${room.capacity}` : ''}
      </span>
      <span className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-xs text-text-main">
        <span><strong className="text-xl text-heading">{status.childrenIn}</strong>{room.capacity != null ? `/${room.capacity}` : ''} kids</span>
        <span><strong className="text-xl text-heading">{status.teachersIn}</strong> {status.teachersIn === 1 ? 'Tchr' : 'Tchrs'}</span>
      </span>
      <span aria-hidden="true" className="mt-2.5 grid grid-cols-[repeat(4,minmax(0,24px))] gap-[5px]">
        {present.map(p => (
          <MiniAvatar key={p.person_id} person={p} url={photos[p.person_id]} tint={tintOf(p)} />
        ))}
      </span>
      {status.visiting > 0 && <span className="mt-2 block text-xs font-semibold text-[#8a4a00]">{status.visiting} visiting</span>}
      <span className="mt-auto flex items-center gap-1 pt-2.5 text-xs font-bold text-brand-600">Open room <ChevronRight className="h-3.5 w-3.5" /></span>
    </button>
  )
}

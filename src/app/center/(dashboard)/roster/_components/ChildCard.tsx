'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Baby, Camera, ClipboardList, Loader2, LogIn, LogOut, Moon, Pill, StickyNote, Droplets, Utensils, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ageLabel, type RosterPerson, type RosterRoom } from '@/lib/roster-ratio'
import { loadChildDayEvents, setToiletTrained, type RosterMove } from '@/lib/roster'
import { Face } from './PersonAvatar'
import { ZONE_LABEL } from './SelectedPanel'

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * The child card in teacher view: a panel on the right (the whole screen on a phone). Who the child is, any
 * care alert, Check in / Check out, the day at a glance and the diaper/toilet switch. The daily activities
 * (nap, meals, medicine, photos...) fill the card in the next phases; moving rooms is done by dragging.
 */
export function ChildCard({
  supabase,
  centerId,
  day,
  person,
  rooms,
  photo,
  tint,
  busy,
  refreshKey,
  onMove,
  onChanged,
  onClose,
}: {
  supabase: SupabaseClient
  centerId: string
  day: string
  person: RosterPerson
  rooms: RosterRoom[]
  photo?: string
  tint: string
  busy: boolean
  /** Bumped when the board changes, so "today" reloads */
  refreshKey: number
  onMove: (p: RosterPerson, to: RosterMove) => void
  /** Something on the child changed (the toilet switch): reload the board */
  onChanged: () => void
  onClose: () => void
}) {
  const [events, setEvents] = useState<{ action: string; at: string }[]>([])
  const [mode, setMode] = useState<'diaper' | 'bathroom'>(person.diaper_or_bathroom ?? 'diaper')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setMode(person.diaper_or_bathroom ?? 'diaper') }, [person.person_id, person.diaper_or_bathroom])

  useEffect(() => {
    let cancelled = false
    loadChildDayEvents(supabase, centerId, person.person_id, day).then(res => {
      if (!cancelled && res.success) setEvents(res.events)
    })
    return () => { cancelled = true }
  }, [supabase, centerId, person.person_id, day, refreshKey, person.zone])

  const roomOf = (id: string | null) => rooms.find(r => r.id === id) ?? null
  const current = roomOf(person.work_area_id)
  const home = roomOf(person.home_area_id)
  const onSite = person.zone !== 'home' && !!current
  const base = current ?? home
  const firstIn = events.find(e => e.action === 'check_in')
  const lastOut = [...events].reverse().find(e => e.action === 'check_out')

  async function switchMode(next: 'diaper' | 'bathroom') {
    if (next === mode) return
    setSaving(true)
    setError(null)
    const res = await setToiletTrained(supabase, centerId, person.person_id, next === 'bathroom')
    setSaving(false)
    if (!res.success) { setError(res.error); return }
    setMode(res.mode)
    onChanged()
  }

  const COMING = [
    { label: 'Nap', icon: Moon },
    { label: 'Meal', icon: Utensils },
    { label: mode === 'diaper' ? 'Diaper' : 'Bathroom', icon: mode === 'diaper' ? Baby : Droplets },
    { label: 'Medicine', icon: Pill },
    { label: 'Photo', icon: Camera },
    { label: 'Activity', icon: ClipboardList },
    { label: 'Note', icon: StickyNote },
  ]

  return (
    <aside
      aria-label={`${person.first_name} ${person.last_initial}.`}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[420px] sm:border-l sm:border-border"
    >
      <div className="sticky top-0 z-[1] border-b border-border bg-white p-4">
        <div className="flex items-start gap-3">
          <Face person={person} url={photo} tint={tint} size={64} border="3px solid #ffffff" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold text-heading">{person.first_name} {person.last_initial}.</p>
            <p className="text-[13px] text-muted">{ageLabel(person.age_months)}{home ? ` · ${home.name}` : ' · No home room'}</p>
            <p className="mt-0.5 text-[13px] font-semibold text-text-main">
              {onSite ? `${current!.name} · ${ZONE_LABEL[person.zone]}${home && home.id !== current!.id ? ' (visiting)' : ''}` : 'Not checked in'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-muted hover:bg-surface-2">
            <X className="h-5 w-5" />
          </button>
        </div>

        {person.care_alert && (
          <p role="note" className="mt-3 flex items-start gap-2 rounded-xl bg-[#fce4e2] px-3 py-2 text-sm font-bold text-[#a3221b]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {person.care_alert}
          </p>
        )}

        <div className="mt-3">
          {onSite ? (
            <button type="button" disabled={busy} onClick={() => onMove(person, { work_area_id: null, zone: 'home' })}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-[#b42318] bg-white text-base font-bold text-[#a3221b] hover:bg-[#fce4e2] disabled:opacity-50">
              <LogOut className="h-5 w-5" /> Check out
            </button>
          ) : (
            <button type="button" disabled={busy || !base} onClick={() => base && onMove(person, { work_area_id: base.id, zone: 'classroom' })}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-bold text-white hover:bg-brand-800 disabled:opacity-50">
              <LogIn className="h-5 w-5" /> Check in{base ? ` to ${base.name}` : ''}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-5 p-4">
        <section aria-labelledby="glance-h">
          <h3 id="glance-h" className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Today at a glance</h3>
          <div className="flex flex-wrap gap-2">
            <Chip>{firstIn ? `In ${clock(firstIn.at)}` : 'Not in yet'}</Chip>
            {lastOut && <Chip>Out {clock(lastOut.at)}</Chip>}
            {events.filter(e => e.action === 'check_in').length > 1 && <Chip>{events.filter(e => e.action === 'check_in').length} check-ins</Chip>}
          </div>
        </section>

        <section aria-labelledby="care-h">
          <h3 id="care-h" className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Diapers or bathroom</h3>
          <div role="radiogroup" aria-label="Diapers or bathroom" className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
            {(['diaper', 'bathroom'] as const).map(m => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={saving} onClick={() => switchMode(m)}
                className={`min-h-11 rounded-lg text-sm font-bold ${mode === m ? 'bg-white text-heading shadow-sm' : 'text-muted'}`}>
                {m === 'diaper' ? 'Diapers' : 'Toilet trained'}
              </button>
            ))}
          </div>
          {saving && <p className="mt-1 flex items-center gap-1 text-xs text-muted"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</p>}
          {error && <p className="mt-1 text-xs font-semibold text-[#a3221b]">{error}</p>}
        </section>

        <section aria-labelledby="daily-h">
          <h3 id="daily-h" className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Daily activities</h3>
          <div className="grid grid-cols-3 gap-2">
            {COMING.map(({ label, icon: Icon }) => (
              <span key={label} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-xs font-semibold text-subtle">
                <Icon className="h-5 w-5" /> {label}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Logging naps, meals, diapers, medicine and photos arrives in the next update.</p>
        </section>
      </div>
    </aside>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-surface px-3 py-1 text-[13px] font-semibold text-text-main">{children}</span>
}

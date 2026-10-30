'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Baby, Camera, ClipboardList, Loader2, LogIn, LogOut, Milk, Moon, Pill, StickyNote, Droplets, Utensils, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ageLabel, type RosterPerson, type RosterRoom } from '@/lib/roster-ratio'
import { loadChildDayEvents, setToiletTrained, type RosterMove } from '@/lib/roster'
import { addEntry, describeEntry, glanceChips, loadDay, newKey, showsBottle, voidEntry, type DailyDetails, type DailyEntry } from '@/lib/daily'
import { Face } from './PersonAvatar'
import { ZONE_LABEL } from './SelectedPanel'
import { EntryForm, VoidForm, type RoutineKind } from './DailyForms'

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * The child card in teacher view: a panel on the right (the whole screen on a phone). Who the child is, any
 * care alert, Check in / Check out, the day at a glance, quick add for the day's routine (meal, bottle,
 * diaper or bathroom, activity, note) and today's list, where an entry is removed with a reason, never
 * deleted. Naps, medicine and photos come in the next phases; moving rooms is done by dragging.
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
  const [entries, setEntries] = useState<DailyEntry[]>([])
  const [adding, setAdding] = useState<{ kind: RoutineKind; key: string } | null>(null)
  const [voiding, setVoiding] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
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

  const reloadEntries = useCallback(async () => {
    const res = await loadDay(supabase, centerId, person.person_id, day || undefined)
    if (res.success) setEntries(res.entries)
  }, [supabase, centerId, person.person_id, day])

  // The board remounts the card for each child (key), so this only loads
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadEntries()
  }, [reloadEntries])

  // Another tablet logs something for this child: the list follows
  useEffect(() => {
    let t: number | undefined
    const soon = () => { window.clearTimeout(t); t = window.setTimeout(reloadEntries, 300) }
    const channel = supabase
      .channel(`daily:${person.person_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'child_daily_entries', filter: `child_id=eq.${person.person_id}` }, soon)
      .subscribe()
    return () => { window.clearTimeout(t); supabase.removeChannel(channel) }
  }, [supabase, person.person_id, reloadEntries])

  useEffect(() => {
    if (!saved) return
    const t = window.setTimeout(() => setSaved(null), 3000)
    return () => window.clearTimeout(t)
  }, [saved])

  async function save(details: DailyDetails, at: string | null) {
    if (!adding) return
    setWorking(true)
    setFormError(null)
    const res = await addEntry(supabase, centerId, person.person_id, adding.kind, details, { at, key: adding.key })   // same key on a retry
    setWorking(false)
    if (!res.success) { setFormError(res.error); return }
    const d = describeEntry({ kind: adding.kind, details })
    setSaved(`Saved: ${d.title}${d.detail ? ` · ${d.detail}` : ''}`)
    setAdding(null)
    reloadEntries()
  }

  async function remove(id: string, reason: string) {
    setWorking(true)
    setFormError(null)
    const res = await voidEntry(supabase, id, reason)
    setWorking(false)
    if (!res.success) { setFormError(res.error); return }
    setVoiding(null)
    reloadEntries()
  }

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

  const QUICK: { kind: RoutineKind; label: string; icon: typeof Moon }[] = [
    { kind: 'meal', label: 'Meal', icon: Utensils },
    ...(showsBottle(person.age_months) ? [{ kind: 'bottle' as const, label: 'Bottle', icon: Milk }] : []),
    mode === 'diaper' ? { kind: 'diaper', label: 'Diaper', icon: Baby } : { kind: 'bathroom', label: 'Bathroom', icon: Droplets },
    { kind: 'activity', label: 'Activity', icon: ClipboardList },
    { kind: 'note', label: 'Note', icon: StickyNote },
  ]
  const COMING = [
    { label: 'Nap', icon: Moon },
    { label: 'Medicine', icon: Pill },
    { label: 'Photo', icon: Camera },
  ]
  const chips = glanceChips(entries)
  // Today's list: the routine entries plus check-in and check-out, newest first
  type Row = { id: string; at: string; entry?: DailyEntry; action?: string }
  const rows: Row[] = [
    ...entries.map(e => ({ id: e.id, at: e.at, entry: e })),
    ...events.map((e, i) => ({ id: `ev-${i}`, at: e.at, action: e.action })),
  ].sort((a, b) => b.at.localeCompare(a.at))

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
        {onSite && (
        <section aria-labelledby="glance-h">
          <h3 id="glance-h" className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Today at a glance</h3>
          <div className="flex flex-wrap gap-2">
            <Chip>{firstIn ? `In ${clock(firstIn.at)}` : 'Not in yet'}</Chip>
            {lastOut && <Chip>Out {clock(lastOut.at)}</Chip>}
            {events.filter(e => e.action === 'check_in').length > 1 && <Chip>{events.filter(e => e.action === 'check_in').length} check-ins</Chip>}
            {chips.map(c => <Chip key={c}>{c}</Chip>)}
          </div>
        </section>
        )}

        <section aria-labelledby="daily-h">
          <h3 id="daily-h" className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Add to today</h3>
          {saved && <p role="status" className="mb-2 rounded-lg bg-[#e2f2ea] px-3 py-2 text-sm font-semibold text-[#17603f]">{saved}</p>}
          {!onSite && <p className="mb-2 text-sm text-muted">Check {person.first_name} in to add to today.</p>}
          {adding && onSite ? (
            <EntryForm key={adding.key} kind={adding.kind} busy={working} error={formError} onSave={save}
              onCancel={() => { setAdding(null); setFormError(null) }} />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {QUICK.map(({ kind, label, icon: Icon }) => (
                <button key={kind} type="button" disabled={!onSite} onClick={() => { setVoiding(null); setFormError(null); setAdding({ kind, key: newKey() }) }}
                  className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-white text-sm font-bold text-heading shadow-sm hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:bg-white">
                  <Icon className="h-5 w-5 text-brand-600" /> {label}
                </button>
              ))}
              {COMING.map(({ label, icon: Icon }) => (
                <span key={label} title="Coming soon" className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-xs font-semibold text-subtle">
                  <Icon className="h-5 w-5" /> {label} <span className="text-[10px] font-normal">Soon</span>
                </span>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="list-h">
          <h3 id="list-h" className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Today</h3>
          {rows.length === 0 ? (
            <p className="text-sm text-muted">Nothing recorded yet today.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {rows.map(r => {
                if (!r.entry) {
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="w-16 shrink-0 text-xs font-semibold text-muted">{clock(r.at)}</span>
                      <span className="font-semibold text-text-main">{r.action === 'check_in' ? 'Checked in' : 'Checked out'}</span>
                    </li>
                  )
                }
                const e = r.entry
                const d = describeEntry(e)
                const gone = !!e.voided_at
                return (
                  <li key={r.id} className="px-3 py-2 text-sm">
                    <div className="flex items-start gap-3">
                      <span className="w-16 shrink-0 pt-0.5 text-xs font-semibold text-muted">{clock(e.at)}</span>
                      <div className={`min-w-0 flex-1 ${gone ? 'text-subtle line-through' : ''}`}>
                        <p><span className="font-bold text-heading">{d.title}</span>{d.detail && <span className="text-text-main"> · {d.detail}</span>}</p>
                        {e.details.note && <p className="text-xs text-muted">{e.details.note}</p>}
                        {/* Who recorded it is left off until teachers sign in to the roster on their own */}
                        {e.batch_id && <p className="text-[11px] text-subtle">Whole class</p>}
                      </div>
                      {e.can_void && voiding !== e.id && (
                        <button type="button" onClick={() => { setAdding(null); setFormError(null); setVoiding(e.id) }}
                          className="min-h-9 shrink-0 rounded-lg px-2 text-xs font-bold text-[#a3221b] hover:bg-[#fce4e2]">Remove</button>
                      )}
                    </div>
                    {gone && <p className="ml-[76px] text-[11px] text-subtle">Removed: {e.void_reason}</p>}
                    {voiding === e.id && (
                      <VoidForm busy={working} error={formError} onConfirm={reason => remove(e.id, reason)} onCancel={() => { setVoiding(null); setFormError(null) }} />
                    )}
                  </li>
                )
              })}
            </ol>
          )}
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

      </div>
    </aside>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-surface px-3 py-1 text-[13px] font-semibold text-text-main">{children}</span>
}

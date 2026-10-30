'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Baby, Camera, ClipboardList, Loader2, LogIn, LogOut, Milk, Moon, Pill, StickyNote, Droplets, Utensils, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ageLabel, type RosterPerson, type RosterRoom } from '@/lib/roster-ratio'
import { loadChildDayEvents, setToiletTrained, type RosterMove } from '@/lib/roster'
import {
  addEntry, describeEntry, endNaps, giveMedicine, glanceChips, loadChildStatus, loadDay, newKey, recordSleepChecks, showsBottle,
  sleepChecksRequired, startNaps, voidEntry, type ChildStatus, type DailyDetails, type DailyEntry, type SleepStatus,
} from '@/lib/daily'
import { Face } from './PersonAvatar'
import { ZONE_LABEL } from './SelectedPanel'
import { EntryForm, VoidForm, type RoutineKind } from './DailyForms'
import { MedicineForm, NapBanner, NapTimeForm, SleepCheckForm } from './NapMedForms'
import { PhotoForm, PhotoViewer } from './DailyPhoto'
import { getDailyPhotoUrls } from '@/app/actions/daily-photo.actions'

type AddKind = RoutineKind | 'nap' | 'wake' | 'sleep_check' | 'medicine' | 'photo'

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * The child card in teacher view: a panel on the right (the whole screen on a phone). Who the child is, any
 * care alert, Check in / Check out, the day at a glance, quick add for the day's routine (meal, bottle,
 * diaper or bathroom, activity, note), naps with sleep checks (due on a timer, required for infants),
 * medicine from the child's authorized list (hidden when there is none), and today's list, where an entry is
 * removed with a reason, never deleted. Photos come next; moving rooms is done by dragging.
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
  const [adding, setAdding] = useState<{ kind: AddKind; key: string } | null>(null)
  const [status, setStatus] = useState<ChildStatus | null>(null)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [viewing, setViewing] = useState<{ url: string; caption?: string } | null>(null)
  const [now, setNow] = useState(() => new Date())
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
    const [res, st] = await Promise.all([
      loadDay(supabase, centerId, person.person_id, day || undefined),
      loadChildStatus(supabase, centerId, person.person_id),
    ])
    if (res.success) {
      setEntries(res.entries)
      // Signed links for today's photos (the server only signs keys the caller can read)
      const keys = res.entries.map(e => e.details.photo_key).filter((k): k is string => !!k)
      if (keys.length) {
        const urls = await getDailyPhotoUrls(centerId, keys)
        if (urls.success) setPhotoUrls(urls.urls)
      }
    }
    if (st.success) setStatus(st.status)
  }, [supabase, centerId, person.person_id, day])

  // The sleep-check timer
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (viewing) setViewing(null); else onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, viewing])

  useEffect(() => {
    if (!saved) return
    const t = window.setTimeout(() => setSaved(null), 3000)
    return () => window.clearTimeout(t)
  }, [saved])

  /** Runs one save; on success shows the message, closes the form and reloads */
  async function run(action: () => Promise<{ success: true } | { success: false; error: string }>, message: string) {
    setWorking(true)
    setFormError(null)
    const res = await action()
    setWorking(false)
    if (!res.success) { setFormError(res.error); return }
    setSaved(message)
    setAdding(null)
    setNow(new Date())
    reloadEntries()
  }

  function save(details: DailyDetails, at: string | null) {
    if (!adding) return
    const kind = adding.kind as RoutineKind
    const d = describeEntry({ kind, details })
    run(() => addEntry(supabase, centerId, person.person_id, kind, details, { at, key: adding.key }),   // same key on a retry
      `Saved: ${d.title}${d.detail ? ` · ${d.detail}` : ''}`)
  }
  const me = [person.person_id]
  const napStart = (at: string | null) => adding && run(() => startNaps(supabase, centerId, me, { at, key: adding.key }), 'Nap started')
  const napEnd = (at: string | null) => run(() => endNaps(supabase, centerId, me, at), 'Woke up')
  const sleepCheck = (s: SleepStatus, note: string | null, at: string | null) => adding &&
    run(() => recordSleepChecks(supabase, centerId, [{ child_id: person.person_id, status: s, ...(note ? { note } : {}) }], { at, key: adding.key }), 'Sleep check saved')
  const medicine = (id: string, dose: string, note: string | null, at: string | null) => adding &&
    run(() => giveMedicine(supabase, centerId, person.person_id, id, { dose, note, at, key: adding.key }), 'Medicine saved')

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

  const nap = status?.open_nap ?? null
  const meds = status?.medications ?? []
  const required = sleepChecksRequired(person.age_months)
  const QUICK: { kind: AddKind; label: string; icon: typeof Moon }[] = [
    ...(nap ? [] : [{ kind: 'nap' as const, label: 'Nap', icon: Moon }]),
    { kind: 'meal', label: 'Meal', icon: Utensils },
    ...(showsBottle(person.age_months) ? [{ kind: 'bottle' as const, label: 'Bottle', icon: Milk }] : []),
    mode === 'diaper' ? { kind: 'diaper', label: 'Diaper', icon: Baby } : { kind: 'bathroom', label: 'Bathroom', icon: Droplets },
    { kind: 'activity', label: 'Activity', icon: ClipboardList },
    // Medicine only when a director has put the child's medicines on file
    ...(meds.length ? [{ kind: 'medicine' as const, label: 'Medicine', icon: Pill }] : []),
    { kind: 'note', label: 'Note', icon: StickyNote },
    { kind: 'photo', label: 'Photo', icon: Camera },
  ]
  const open = (kind: AddKind) => { setVoiding(null); setFormError(null); setAdding({ kind, key: newKey() }) }
  const cancel = () => { setAdding(null); setFormError(null) }
  const chips = glanceChips(entries)
  // Today's list: the routine entries plus check-in and check-out, newest first
  type Row = { id: string; at: string; entry?: DailyEntry; action?: string }
  const rows: Row[] = [
    ...entries.map(e => ({ id: e.id, at: e.at, entry: e })),
    ...events.map((e, i) => ({ id: `ev-${i}`, at: e.at, action: e.action })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <>
    {/* Tapping anywhere outside the card closes it, like the X */}
    <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-brand-900/20" />
    <aside
      aria-label={`${person.first_name} ${person.last_initial}.`}
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
          {nap && onSite && !adding && (
            <NapBanner nap={nap} minutes={status?.check_minutes ?? 15} required={required} now={now} busy={working}
              onCheck={() => open('sleep_check')} onWake={() => open('wake')} />
          )}
          {adding && onSite ? (
            adding.kind === 'nap' || adding.kind === 'wake' ? (
              <NapTimeForm key={adding.key} mode={adding.kind === 'nap' ? 'start' : 'wake'} busy={working} error={formError}
                onSave={adding.kind === 'nap' ? napStart : napEnd} onCancel={cancel} />
            ) : adding.kind === 'sleep_check' ? (
              <SleepCheckForm key={adding.key} required={required} busy={working} error={formError} onSave={sleepCheck} onCancel={cancel} />
            ) : adding.kind === 'photo' ? (
              <PhotoForm key={adding.key} centerId={centerId} person={person} onCancel={cancel}
                onSaved={() => { setAdding(null); setSaved('Photo saved'); reloadEntries() }} />
            ) : adding.kind === 'medicine' ? (
              <MedicineForm key={adding.key} medications={meds} busy={working} error={formError} onSave={medicine} onCancel={cancel} />
            ) : (
              <EntryForm key={adding.key} kind={adding.kind} busy={working} error={formError} onSave={save} onCancel={cancel} />
            )
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {QUICK.map(({ kind, label, icon: Icon }) => (
                <button key={kind} type="button" disabled={!onSite} onClick={() => open(kind)}
                  className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-white text-sm font-bold text-heading shadow-sm hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:bg-white">
                  <Icon className="h-5 w-5 text-brand-600" /> {label}
                </button>
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
                        {e.kind === 'photo' && e.details.photo_key && photoUrls[e.details.photo_key] && !gone && (
                          <button type="button" onClick={() => setViewing({ url: photoUrls[e.details.photo_key!], caption: e.details.caption })}
                            className="mt-1 block overflow-hidden rounded-lg border border-border" aria-label="Open photo">
                            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                            <img src={photoUrls[e.details.photo_key]} alt={e.details.caption ?? 'Photo'} className="h-24 w-32 object-cover" />
                          </button>
                        )}
                        {/* Who recorded it is left off until teachers sign in to the roster on their own */}
                        {e.batch_id && ['meal', 'activity', 'note'].includes(e.kind) && <p className="text-[11px] text-subtle">Whole class</p>}
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
    {viewing && <PhotoViewer url={viewing.url} caption={viewing.caption} onClose={() => setViewing(null)} />}
    </>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-surface px-3 py-1 text-[13px] font-semibold text-text-main">{children}</span>
}

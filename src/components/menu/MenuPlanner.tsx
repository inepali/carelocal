'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import {
  SLOT_LABELS, SLOT_STYLE, type MealPreset, type MealSlot, type MenuEntry,
  addDays, addMonths, entryKey, monthLabel, monthOf, monthWeeks, monthEnd, mondayOf, presetFoods, toDateOnly, fromDateOnly,
} from '@/lib/menu'
import { checkDay, checkWeeks, type DayCheck, type MealCheck } from '@/lib/cacfp'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'
import {
  ChevronLeft, ChevronRight, Loader2, Search, X, Copy, RefreshCw, Lock, Printer, CheckCircle2, AlertTriangle,
  ClipboardList, BookOpen, Send, RotateCcw, Trash2, StickyNote, Utensils,
} from 'lucide-react'
import { useMenuLibrary, useMenuMonth } from './useMenuData'
import { usePresetDrag } from './usePresetDrag'
import MenuLibrary from './MenuLibrary'

const BTN = 'inline-flex items-center justify-center gap-2 font-bold px-4 py-2.5 rounded-xl text-sm transition-all disabled:opacity-50'
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

/**
 * The monthly menu calendar. Editors (center owner/admins and staff marked menu editor) drag presets onto
 * meal slots, copy weeks, close days and publish the month; everyone else at the center sees published months.
 * The database enforces the same rules (see the menu_planning migration).
 */
export default function MenuPlanner({ centerId, reportHref }: { centerId: string; reportHref: string }) {
  const lib = useMenuLibrary(centerId)
  const [month, setMonth] = useState(() => monthOf(toDateOnly(new Date())))
  const data = useMenuMonth(centerId, month)
  const [view, setView] = useState<'calendar' | 'library'>('calendar')
  const [selected, setSelected] = useState<MealPreset | null>(null)
  const [query, setQuery] = useState('')
  const [slotFilter, setSlotFilter] = useState<MealSlot | 'all'>('all')
  const [openEntry, setOpenEntry] = useState<MenuEntry | null>(null)
  const [busy, setBusy] = useState(false)

  const { supabase, settings, canEdit, foodMap } = lib
  const today = toDateOnly(new Date())
  const weeks = useMemo(() => monthWeeks(month), [month])
  const published = data.monthRow?.status === 'published'
  const entriesByKey = useMemo(() => new Map(data.entries.map(e => [entryKey(e.service_date, e.slot), e])), [data.entries])
  const closedByDate = useMemo(() => new Map(data.closed.map(c => [c.service_date, c])), [data.closed])
  const activePresets = useMemo(() => lib.presets.filter(p => p.is_active), [lib.presets])

  // CACFP checks per day and week
  const dayChecks = useMemo(() => {
    const out = new Map<string, DayCheck>()
    if (!settings.cacfpEnabled) return out
    const byDate = new Map<string, Partial<Record<MealSlot, MenuEntry['items']>>>()
    for (const e of data.entries) {
      if (closedByDate.has(e.service_date)) continue
      const day = byDate.get(e.service_date) ?? {}
      day[e.slot] = e.items
      byDate.set(e.service_date, day)
    }
    for (const [date, meals] of byDate) out.set(date, checkDay(date, meals))
    return out
  }, [data.entries, closedByDate, settings.cacfpEnabled])
  const weekIssues = useMemo(() => new Map(checkWeeks([...dayChecks.values()], mondayOf).map(i => [i.weekStart, i.message])), [dayChecks])

  // ── Writes ───────────────────────────────────────────────────────────────────────────────────────────────
  const place = useCallback(async (preset: MealPreset, date: string, slot: MealSlot) => {
    if (!canEdit) return
    if (closedByDate.has(date)) { showAlert('That day is marked closed. Reopen it first.'); return }
    if (!settings.slots.includes(slot)) return
    if (!preset.meal_types.includes(slot)) {
      showAlert(`“${preset.name}” is set up for ${preset.meal_types.map(s => SLOT_LABELS[s]).join(', ')}, not ${SLOT_LABELS[slot]}.`)
      return
    }
    const { data: row, error } = await supabase.from('menu_entries')
      .upsert({ center_id: centerId, service_date: date, slot, preset_id: preset.id }, { onConflict: 'center_id,service_date,slot' })
      .select('id, center_id, service_date, slot, preset_id, preset_name, items, note').single()
    if (error) { showAlert('Could not place the meal: ' + error.message); return }
    data.setEntries(prev => [...prev.filter(e => !(e.service_date === date && e.slot === slot)), row as MenuEntry])
  }, [canEdit, closedByDate, settings.slots, supabase, centerId, data])

  const drag = usePresetDrag<MealPreset>((preset, key) => {
    const [date, slot] = key.split('|') as [string, MealSlot]
    place(preset, date, slot)
  })

  async function tapSlot(date: string, slot: MealSlot) {
    if (selected) { await place(selected, date, slot); return }
    const entry = entriesByKey.get(entryKey(date, slot))
    if (entry) setOpenEntry(entry)
  }

  async function removeEntry(entry: MenuEntry) {
    const { error } = await supabase.from('menu_entries').delete().eq('id', entry.id)
    if (error) { showAlert('Could not remove the meal: ' + error.message); return }
    data.setEntries(prev => prev.filter(e => e.id !== entry.id))
    setOpenEntry(null)
  }

  async function saveNote(entry: MenuEntry) {
    const note = await showPrompt(`Note for ${SLOT_LABELS[entry.slot]} (e.g. “Oat milk for Room 3”):`, entry.note ?? '', { title: 'Meal note' })
    if (note === null) return
    const { data: row, error } = await supabase.from('menu_entries').update({ note: note.trim() || null }).eq('id', entry.id)
      .select('id, center_id, service_date, slot, preset_id, preset_name, items, note').single()
    if (error) { showAlert('Could not save the note: ' + error.message); return }
    data.setEntries(prev => prev.map(e => e.id === entry.id ? row as MenuEntry : e))
    setOpenEntry(row as MenuEntry)
  }

  async function toggleClosed(date: string) {
    const closed = closedByDate.get(date)
    if (closed) {
      const { error } = await supabase.from('menu_closed_days').delete().eq('center_id', centerId).eq('service_date', date)
      if (error) { showAlert(error.message); return }
      data.setClosed(prev => prev.filter(c => c.service_date !== date))
      return
    }
    const reason = await showPrompt('Why is the center closed? (optional)', 'Holiday', { title: `Close ${dateLabel(date)}` })
    if (reason === null) return
    const planned = data.entries.filter(e => e.service_date === date)
    if (planned.length && !await showConfirm(`Remove the ${planned.length} meal${planned.length === 1 ? '' : 's'} planned that day?`, { confirmLabel: 'Close day' })) return
    setBusy(true)
    if (planned.length) {
      const { error } = await supabase.from('menu_entries').delete().eq('center_id', centerId).eq('service_date', date)
      if (error) { setBusy(false); showAlert(error.message); return }
    }
    const { data: row, error } = await supabase.from('menu_closed_days')
      .insert({ center_id: centerId, service_date: date, reason: reason.trim() || null }).select('center_id, service_date, reason').single()
    setBusy(false)
    if (error) { showAlert(error.message); return }
    data.setEntries(prev => prev.filter(e => e.service_date !== date))
    data.setClosed(prev => [...prev, row as { center_id: string; service_date: string; reason: string | null }])
  }

  /** Copy one week's meals onto later weeks (next week, or every week to the end of the month) */
  async function copyWeek(monday: string, toEndOfMonth: boolean) {
    const source = data.entries.filter(e => e.preset_id && e.service_date >= monday && e.service_date <= addDays(monday, 4))
    if (!source.length) { showAlert('There are no meals in that week to copy.'); return }
    const last = toEndOfMonth ? monthEnd(month) : addDays(monday, 11)
    const rows: { center_id: string; service_date: string; slot: MealSlot; preset_id: string }[] = []
    for (let w = 1; addDays(monday, 7 * w) <= last; w++) {
      for (const e of source) {
        const date = addDays(e.service_date, 7 * w)
        if (date > last || closedByDate.has(date)) continue
        rows.push({ center_id: centerId, service_date: date, slot: e.slot, preset_id: e.preset_id! })
      }
      if (!toEndOfMonth) break
    }
    if (!rows.length) { showAlert('Nothing to copy into: the following days are closed or outside this month.'); return }
    const overwriting = rows.filter(r => entriesByKey.has(entryKey(r.service_date, r.slot))).length
    const msg = `Copy ${source.length} meal${source.length === 1 ? '' : 's'} onto ${toEndOfMonth ? 'every following week this month' : 'next week'}?` +
      (overwriting ? ` ${overwriting} meal${overwriting === 1 ? '' : 's'} already planned there will be replaced.` : '')
    if (!await showConfirm(msg, { title: 'Copy week', confirmLabel: 'Copy' })) return
    setBusy(true)
    const { error } = await supabase.from('menu_entries').upsert(rows, { onConflict: 'center_id,service_date,slot' })
    setBusy(false)
    if (error) { showAlert('Copy failed: ' + error.message); return }
    data.reload()
  }

  async function setPublished(publish: boolean) {
    if (publish) {
      const planned = data.entries.length
      const problems = [...dayChecks.values()].filter(d => !d.ok).length
      const warn = settings.cacfpEnabled && problems ? ` ${problems} day${problems === 1 ? ' does' : 's do'} not meet the CACFP meal pattern yet.` : ''
      if (!await showConfirm(`Publish the ${monthLabel(month)} menu with ${planned} planned meal${planned === 1 ? '' : 's'}? Everyone at the center will see it.${warn}`,
        { title: 'Publish menu', confirmLabel: 'Publish' })) return
    } else if (!await showConfirm(`Take the ${monthLabel(month)} menu back to draft? Staff will stop seeing it until you publish again.`,
      { title: 'Unpublish menu', confirmLabel: 'Back to draft' })) return
    setBusy(true)
    const { data: row, error } = await supabase.from('menu_months')
      .upsert({ center_id: centerId, month, status: publish ? 'published' : 'draft' }, { onConflict: 'center_id,month' })
      .select('center_id, month, status, published_at, published_by_name').single()
    setBusy(false)
    if (error) { showAlert(error.message); return }
    data.setMonthRow(row as typeof data.monthRow)
  }

  // ── Render ───────────────────────────────────────────────────────────────────────────────────────────────
  if (lib.loading) return <div className="flex items-center gap-2 p-10 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading menu…</div>
  if (lib.error) return <div className="px-4 py-3 rounded-xl text-sm border bg-red-50 text-red-700 border-red-200">{lib.error}</div>

  if (view === 'library') {
    return <MenuLibrary centerId={centerId} lib={lib} onBack={() => { setView('calendar'); data.reload() }} />
  }

  const visiblePresets = activePresets.filter(p =>
    (slotFilter === 'all' || p.meal_types.includes(slotFilter)) &&
    (!query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase())))
  const hiddenFromViewer = !canEdit && !published
  const slots = settings.slots

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(m => addMonths(m, -1))} className="p-2 rounded-xl border border-border bg-white hover:bg-surface" aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
          <h2 className="text-xl font-black text-text-main min-w-44 text-center">{monthLabel(month)}</h2>
          <button onClick={() => setMonth(m => addMonths(m, 1))} className="p-2 rounded-xl border border-border bg-white hover:bg-surface" aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
          {month !== monthOf(today) && <button onClick={() => setMonth(monthOf(today))} className="text-xs font-bold text-brand-600 hover:underline ml-1">This month</button>}
          <span className={`ml-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${published ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
            title={published && data.monthRow?.published_by_name ? `Published by ${data.monthRow.published_by_name}` : undefined}>
            {published ? <><CheckCircle2 className="w-3.5 h-3.5" /> Published</> : 'Draft'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => window.print()} className={`${BTN} bg-white border border-border text-text-main hover:bg-surface`}><Printer className="w-4 h-4" /> Print</button>
          {settings.cacfpEnabled && (canEdit || published) && (
            <Link href={`${reportHref}?month=${month}`} className={`${BTN} bg-white border border-border text-text-main hover:bg-surface`}><ClipboardList className="w-4 h-4" /> CACFP report</Link>
          )}
          {canEdit && <button onClick={() => setView('library')} className={`${BTN} bg-white border border-border text-text-main hover:bg-surface`}><BookOpen className="w-4 h-4" /> Foods &amp; presets</button>}
          {canEdit && (published
            ? <button disabled={busy} onClick={() => setPublished(false)} className={`${BTN} bg-white border border-border text-text-main hover:bg-surface`}><RotateCcw className="w-4 h-4" /> Back to draft</button>
            : <button disabled={busy || data.entries.length === 0} onClick={() => setPublished(true)} className={`${BTN} bg-brand-600 text-white hover:bg-brand-700`}><Send className="w-4 h-4" /> Publish month</button>)}
        </div>
      </div>

      <h2 className="hidden print:block text-2xl font-black mb-4">{settings.centerName} · {monthLabel(month)} Menu</h2>

      {data.error && <div className="mb-4 px-4 py-3 rounded-xl text-sm border bg-red-50 text-red-700 border-red-200">{data.error}</div>}

      {hiddenFromViewer ? (
        <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">
          The {monthLabel(month)} menu hasn&apos;t been published yet.
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Palette */}
          {canEdit && (
            <aside className="lg:w-72 shrink-0 print:hidden">
              <div className="bg-white border border-border rounded-3xl p-4 lg:sticky lg:top-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-black text-text-main flex items-center gap-2"><Utensils className="w-4 h-4 text-brand-600" /> Meal presets</h3>
                  <span className="text-xs font-bold text-subtle">{activePresets.length}</span>
                </div>
                {activePresets.length === 0 ? (
                  <div className="text-sm text-muted py-4 text-center">
                    No presets yet.{' '}
                    <button onClick={() => setView('library')} className="font-bold text-brand-600 hover:underline">Set up foods &amp; presets →</button>
                  </div>
                ) : (
                  <>
                    <div className="relative mb-2">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
                      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search presets"
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-border text-sm focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600" />
                    </div>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {(['all', ...slots] as const).map(s => (
                        <button key={s} onClick={() => setSlotFilter(s)}
                          className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${slotFilter === s ? 'bg-brand-900 text-white border-brand-900' : 'bg-white text-muted border-border hover:border-brand-200'}`}>
                          {s === 'all' ? 'All' : SLOT_LABELS[s]}
                        </button>
                      ))}
                    </div>
                    <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
                      {visiblePresets.map(p => {
                        const foods = presetFoods(p, foodMap)
                        const isSel = selected?.id === p.id
                        return (
                          <li key={p.id}>
                            <button type="button" {...drag.bind(p, p.name)}
                              onClick={drag.tap(() => setSelected(isSel ? null : p))}
                              aria-pressed={isSel}
                              className={`w-full text-left px-3 py-2 rounded-xl border cursor-grab active:cursor-grabbing select-none transition-colors ${isSel ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-600/20' : 'border-border bg-white hover:border-brand-200'}`}>
                              <div className="text-sm font-bold text-text-main leading-tight">{p.name}</div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {p.meal_types.filter(s => slots.includes(s)).map(s => (
                                  <span key={s} className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${SLOT_STYLE[s]}`}>{SLOT_LABELS[s]}</span>
                                ))}
                              </div>
                              {foods.length > 0 && <div className="mt-1 text-[11px] text-subtle truncate">{foods.map(f => f.name).join(', ')}</div>}
                            </button>
                          </li>
                        )
                      })}
                      {visiblePresets.length === 0 && <li className="text-xs text-subtle text-center py-3">No presets match.</li>}
                    </ul>
                    <p className="mt-3 text-[11px] text-subtle leading-snug">Drag a preset onto a meal, or tap it and then tap the meal.</p>
                  </>
                )}
              </div>
            </aside>
          )}

          {/* Calendar */}
          <div className="flex-1 min-w-0">
            {selected && (
              <div className="mb-3 px-4 py-2.5 rounded-xl bg-brand-50 border border-brand-200 text-sm text-brand-800 flex items-center justify-between gap-2 print:hidden">
                <span>Tap a <strong>{selected.meal_types.filter(s => slots.includes(s)).map(s => SLOT_LABELS[s]).join(' / ')}</strong> slot to place <strong>{selected.name}</strong>.</span>
                <button onClick={() => setSelected(null)} className="p-1 rounded-lg hover:bg-brand-100" aria-label="Stop placing"><X className="w-4 h-4" /></button>
              </div>
            )}
            {data.loading ? (
              <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-brand-600" /></div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[760px] bg-white border border-border rounded-3xl overflow-hidden print:border-0 print:rounded-none">
                  <div className="grid grid-cols-5 border-b border-border bg-surface/50">
                    {WEEKDAYS.map(d => <div key={d} className="px-3 py-2 text-[11px] font-black uppercase tracking-widest text-subtle">{d}</div>)}
                  </div>
                  {weeks.map(week => {
                    const monday = mondayOf(week.find(Boolean)!)
                    const issue = weekIssues.get(monday)
                    const hasMeals = week.some(d => d && slots.some(s => entriesByKey.has(entryKey(d, s))))
                    return (
                      <div key={monday} className="border-b border-border last:border-b-0 break-inside-avoid">
                        {canEdit && (hasMeals || issue) && (
                          <div className="px-3 pt-2 flex flex-wrap items-center gap-3 text-[11px] print:hidden">
                            {issue && <span className="inline-flex items-center gap-1 font-bold text-amber-700"><AlertTriangle className="w-3 h-3" /> {issue}</span>}
                            {hasMeals && (
                              <span className="ml-auto flex items-center gap-3">
                                <button disabled={busy} onClick={() => copyWeek(monday, false)} className="inline-flex items-center gap-1 font-bold text-brand-600 hover:underline disabled:opacity-50"><Copy className="w-3 h-3" /> Copy to next week</button>
                                <button disabled={busy} onClick={() => copyWeek(monday, true)} className="inline-flex items-center gap-1 font-bold text-brand-600 hover:underline disabled:opacity-50"><RefreshCw className="w-3 h-3" /> Repeat through month end</button>
                              </span>
                            )}
                          </div>
                        )}
                        <div className="grid grid-cols-5 divide-x divide-border">
                          {week.map((date, i) => date === null ? (
                            <div key={`blank-${monday}-${i}`} className="bg-surface/40 min-h-24" />
                          ) : (
                            <DayCell key={date} date={date} today={date === today} slots={slots} canEdit={canEdit}
                              closed={closedByDate.get(date)?.reason ?? (closedByDate.has(date) ? '' : null)}
                              entries={entriesByKey} check={dayChecks.get(date)} cacfp={settings.cacfpEnabled}
                              dragging={drag.dragging?.item ?? selected} over={drag.over}
                              onTapSlot={tapSlot} onToggleClosed={toggleClosed} busy={busy} />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {settings.cacfpEnabled && (
              <p className="mt-3 text-[11px] text-subtle print:hidden">
                Green check: meets the CACFP meal pattern for ages 1–12. Portion sizes, added-sugar limits and milk type by age are not checked here.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Drag ghost */}
      {drag.dragging && typeof document !== 'undefined' && createPortal(
        <div ref={drag.ghostRef} className="fixed left-0 top-0 z-[100] pointer-events-none px-3 py-1.5 rounded-xl bg-brand-900 text-white text-xs font-bold shadow-xl">
          {drag.dragging.label}
        </div>, document.body)}

      {openEntry && (
        <EntryDialog entry={openEntry} canEdit={canEdit} check={dayChecks.get(openEntry.service_date)?.meals[openEntry.slot]}
          cacfp={settings.cacfpEnabled} onClose={() => setOpenEntry(null)} onRemove={removeEntry} onNote={saveNote} />
      )}
    </div>
  )
}

function dateLabel(date: string) {
  return fromDateOnly(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function DayCell({
  date, today, slots, canEdit, closed, entries, check, cacfp, dragging, over, onTapSlot, onToggleClosed, busy,
}: {
  date: string; today: boolean; slots: MealSlot[]; canEdit: boolean; closed: string | null
  entries: Map<string, MenuEntry>; check: DayCheck | undefined; cacfp: boolean
  dragging: MealPreset | null; over: string | null; busy: boolean
  onTapSlot: (date: string, slot: MealSlot) => void; onToggleClosed: (date: string) => void
}) {
  const dayNum = fromDateOnly(date).getDate()
  return (
    <div className={`min-h-24 p-2 flex flex-col gap-1.5 ${closed !== null ? 'bg-slate-50' : ''}`}>
      <div className="flex items-center justify-between gap-1">
        <span className={`text-xs font-black ${today ? 'bg-brand-600 text-white rounded-md px-1.5 py-0.5' : 'text-text-main'}`}>{dayNum}</span>
        <div className="flex items-center gap-1">
          {cacfp && check && closed === null && (check.ok
            ? <CheckCircle2 className="w-3.5 h-3.5 text-brand-600" aria-label="Meets the CACFP meal pattern" />
            : <span title={[...check.problems, ...Object.entries(check.meals).flatMap(([s, m]) => m!.problems.map(p => `${SLOT_LABELS[s as MealSlot]}: ${p}`))].join('\n')}>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" aria-label="Does not meet the CACFP meal pattern" />
              </span>)}
          {canEdit && (
            <button disabled={busy} onClick={() => onToggleClosed(date)} title={closed !== null ? 'Reopen this day' : 'Mark closed (holiday)'}
              className="p-0.5 rounded text-subtle hover:text-text-main hover:bg-surface print:hidden disabled:opacity-50">
              <Lock className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      {closed !== null ? (
        <div className="flex-1 flex items-center justify-center text-[11px] font-bold text-subtle uppercase tracking-widest text-center">Closed{closed ? ` · ${closed}` : ''}</div>
      ) : slots.map(slot => {
        const key = entryKey(date, slot)
        const entry = entries.get(key)
        const meal = check?.meals[slot]
        const droppable = !!dragging && dragging.meal_types.includes(slot)
        const isOver = over === key && droppable
        const interactive = canEdit || !!entry
        return (
          <div key={slot} data-menu-drop={canEdit && droppable ? key : undefined}>
            <button type="button" disabled={!interactive} onClick={() => onTapSlot(date, slot)}
              className={`w-full text-left rounded-lg border px-1.5 py-1 transition-colors ${
                isOver ? 'border-brand-600 bg-brand-100 ring-2 ring-brand-600/30'
                : droppable ? 'border-brand-300 border-dashed bg-brand-50/50'
                : entry ? `${SLOT_STYLE[slot]}` : 'border-dashed border-border text-subtle'
              } ${interactive ? 'hover:brightness-95' : 'cursor-default'}`}>
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-black uppercase tracking-wider opacity-70">{SLOT_LABELS[slot]}</span>
                {cacfp && meal && !meal.ok && <AlertTriangle className="w-2.5 h-2.5 text-amber-600 shrink-0" />}
                {entry?.note && <StickyNote className="w-2.5 h-2.5 shrink-0 opacity-70" />}
              </div>
              <div className="text-[11px] font-bold leading-tight line-clamp-2">
                {entry ? (entry.items.length ? entry.items.map(f => f.name).join(', ') : entry.preset_name) : canEdit ? '+' : '—'}
              </div>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function EntryDialog({
  entry, canEdit, check, cacfp, onClose, onRemove, onNote,
}: {
  entry: MenuEntry; canEdit: boolean; check: MealCheck | undefined; cacfp: boolean
  onClose: () => void; onRemove: (e: MenuEntry) => void; onNote: (e: MenuEntry) => void
}) {
  const allergens = [...new Set(entry.items.flatMap(f => f.allergens))]
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${SLOT_LABELS[entry.slot]} on ${dateLabel(entry.service_date)}`}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest border ${SLOT_STYLE[entry.slot]}`}>{SLOT_LABELS[entry.slot]}</div>
            <h3 className="mt-2 text-lg font-black text-text-main">{entry.preset_name || 'Meal'}</h3>
            <p className="text-sm text-muted">{dateLabel(entry.service_date)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <ul className="divide-y divide-border border border-border rounded-2xl mb-4">
          {entry.items.map(f => (
            <li key={f.food_item_id} className="px-3 py-2 flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-text-main">{f.name}{f.serving_note ? <span className="text-subtle font-normal"> · {f.serving_note}</span> : null}</span>
              {cacfp && <span className="text-[10px] font-bold uppercase tracking-wider text-subtle">{f.component === 'meat_alt' ? 'Meat/alt' : f.component}{f.whole_grain_rich ? ' · WGR' : ''}</span>}
            </li>
          ))}
          {entry.items.length === 0 && <li className="px-3 py-2 text-sm text-subtle">No foods listed.</li>}
        </ul>
        {allergens.length > 0 && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3"><strong>Contains:</strong> {allergens.join(', ')}</p>}
        {entry.note && <p className="text-sm text-text-main bg-surface rounded-xl px-3 py-2 mb-3"><strong>Note:</strong> {entry.note}</p>}
        {cacfp && check && (
          <div className={`text-xs rounded-xl px-3 py-2 mb-4 border ${check.ok ? 'bg-brand-50 border-brand-200 text-brand-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
            {check.ok ? 'Meets the CACFP meal pattern.' : check.problems.join(' · ')}
            {check.ok && check.problems.length > 0 && <span> {check.problems.join(' · ')}</span>}
          </div>
        )}
        {canEdit && (
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => onRemove(entry)} className={`${BTN} text-red-600 hover:bg-red-50`}><Trash2 className="w-4 h-4" /> Remove</button>
            <button onClick={() => onNote(entry)} className={`${BTN} bg-white border border-border text-text-main hover:bg-surface`}><StickyNote className="w-4 h-4" /> {entry.note ? 'Edit note' : 'Add note'}</button>
          </div>
        )}
      </div>
    </div>, document.body)
}


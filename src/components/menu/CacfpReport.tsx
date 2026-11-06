'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  SLOT_LABELS, type MealSlot, type MenuEntry,
  addMonths, entryKey, fromDateOnly, monthLabel, monthOf, monthWeekdays, mondayOf, toDateOnly,
} from '@/lib/menu'
import { checkDay, checkWeeks, summarize, credits, COMPONENT_SHORT, type DayCheck } from '@/lib/cacfp'
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Printer, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useMenuLibrary, useMenuMonth } from './useMenuData'

const BTN = 'inline-flex items-center justify-center gap-2 font-bold px-4 py-2.5 rounded-xl text-sm transition-all disabled:opacity-50'

/**
 * Monthly CACFP menu compliance report: every planned meal with the components it credits, what is missing, and
 * day and week rules. Printable for the sponsor or an inspection. Staff who are not editors see published months only.
 */
export default function CacfpReport({ centerId, backHref }: { centerId: string; backHref: string }) {
  const lib = useMenuLibrary(centerId)
  const [month, setMonth] = useState(() => {
    const q = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('month')
    return q && /^\d{4}-\d{2}-01$/.test(q) ? q : monthOf(toDateOnly(new Date()))
  })
  const data = useMenuMonth(centerId, month)
  const slots = lib.settings.slots

  const closed = useMemo(() => new Map(data.closed.map(c => [c.service_date, c.reason])), [data.closed])
  const byKey = useMemo(() => new Map(data.entries.map(e => [entryKey(e.service_date, e.slot), e])), [data.entries])
  const days = useMemo(() => monthWeekdays(month), [month])
  const checks = useMemo(() => {
    const out = new Map<string, DayCheck>()
    for (const d of days) {
      if (closed.has(d)) continue
      const meals: Partial<Record<MealSlot, MenuEntry['items']>> = {}
      for (const s of slots) { const e = byKey.get(entryKey(d, s)); if (e) meals[s] = e.items }
      if (Object.keys(meals).length) out.set(d, checkDay(d, meals))
    }
    return out
  }, [days, closed, slots, byKey])
  const summary = summarize([...checks.values()])
  const weekIssues = checkWeeks([...checks.values()], mondayOf)
  const unplanned = days.filter(d => !closed.has(d)).reduce((n, d) => n + slots.filter(s => !byKey.has(entryKey(d, s))).length, 0)

  if (lib.loading) return <div className="flex items-center gap-2 p-10 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
  if (!lib.settings.cacfpEnabled) {
    return <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted">CACFP tracking isn&apos;t turned on for this center.</div>
  }
  const published = data.monthRow?.status === 'published'

  return (
    <div className="pb-24">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-brand-600"><ArrowLeft className="w-4 h-4" /> Back to menu</Link>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(m => addMonths(m, -1))} className="p-2 rounded-xl border border-border bg-white hover:bg-surface" aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
          <span className="font-black text-text-main min-w-40 text-center">{monthLabel(month)}</span>
          <button onClick={() => setMonth(m => addMonths(m, 1))} className="p-2 rounded-xl border border-border bg-white hover:bg-surface" aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={() => window.print()} className={`${BTN} bg-white border border-border text-text-main hover:bg-surface ml-2`}><Printer className="w-4 h-4" /> Print</button>
        </div>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-heading">CACFP Menu Report · {monthLabel(month)}</h1>
        <p className="text-sm text-muted">{lib.settings.centerName} · {published ? `Published${data.monthRow?.published_by_name ? ` by ${data.monthRow.published_by_name}` : ''}` : 'Draft (not published)'} · Children 1–12 meal pattern</p>
      </div>

      {data.loading ? <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-brand-600" /></div> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Stat label="Meals planned" value={summary.mealsPlanned} />
            <Stat label="Meet the pattern" value={summary.mealsOk} tone={summary.mealsOk === summary.mealsPlanned ? 'good' : 'warn'} />
            <Stat label="Days with problems" value={summary.daysWithProblems} tone={summary.daysWithProblems ? 'warn' : 'good'} />
            <Stat label="Meals not planned" value={unplanned} tone={unplanned ? 'warn' : 'good'} />
          </div>

          {weekIssues.length > 0 && (
            <ul className="mb-6 space-y-1">
              {weekIssues.map(w => (
                <li key={w.weekStart} className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> Week of {fromDateOnly(w.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: {w.message}
                </li>
              ))}
            </ul>
          )}

          <div className="overflow-x-auto bg-white border border-border rounded-3xl print:border-0 print:rounded-none">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface/50 border-b border-border text-left">
                  <th className="px-3 py-2 text-[11px] font-black uppercase tracking-widest text-subtle w-28">Date</th>
                  {slots.map(s => <th key={s} className="px-3 py-2 text-[11px] font-black uppercase tracking-widest text-subtle">{SLOT_LABELS[s]}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {days.map(d => {
                  const check = checks.get(d)
                  const isClosed = closed.has(d)
                  return (
                    <tr key={d} className="align-top break-inside-avoid">
                      <td className="px-3 py-2">
                        <div className="font-bold text-text-main whitespace-nowrap">{fromDateOnly(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                        {check?.problems.map(p => <div key={p} className="text-[11px] font-semibold text-amber-700">{p}</div>)}
                      </td>
                      {isClosed ? (
                        <td colSpan={slots.length} className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-subtle">Closed{closed.get(d) ? ` · ${closed.get(d)}` : ''}</td>
                      ) : slots.map(s => {
                        const e = byKey.get(entryKey(d, s))
                        const m = check?.meals[s]
                        if (!e) return <td key={s} className="px-3 py-2 text-xs text-subtle">Not planned</td>
                        return (
                          <td key={s} className="px-3 py-2">
                            <div className="flex items-start gap-1.5">
                              {m && (m.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-brand-600 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />)}
                              <div>
                                <ul className="text-xs text-text-main">
                                  {e.items.map(f => {
                                    const c = credits(f)
                                    return (
                                      <li key={f.food_item_id}>
                                        {f.name}{f.serving_note ? <span className="text-subtle"> ({f.serving_note})</span> : null}{' '}
                                        <span className="text-[10px] font-black text-subtle">[{c ? COMPONENT_SHORT[c] : '—'}{f.whole_grain_rich ? ' WGR' : ''}]</span>
                                      </li>
                                    )
                                  })}
                                </ul>
                                {m?.problems.map(p => <div key={p} className="text-[11px] font-semibold text-amber-700">{p}</div>)}
                                {m?.meatForGrain && <div className="text-[11px] text-subtle">Meat/alternate in place of grains</div>}
                              </div>
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[11px] text-subtle leading-relaxed">
            Components: M milk · G grains · MA meat/meat alternate · V vegetable · F fruit · WGR whole grain-rich · — not creditable.
            This report checks which components each meal and day include. Portion sizes by age, added-sugar limits on cereal and yogurt,
            juice limits and milk type by age are not checked; confirm them with your CACFP sponsor. Meal counts are not included.
          </p>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' }) {
  const cls = tone === 'good' ? 'text-brand-700' : tone === 'warn' ? 'text-amber-700' : 'text-text-main'
  return (
    <div className="bg-white border border-border rounded-2xl p-4">
      <div className={`text-2xl font-black ${cls}`}>{value}</div>
      <div className="text-[11px] font-bold uppercase tracking-widest text-subtle">{label}</div>
    </div>
  )
}

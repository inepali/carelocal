import Link from 'next/link'
import { ChevronLeft, ChevronRight, Utensils } from 'lucide-react'
import { SLOT_LABELS, addDays, fromDateOnly, monthOf, type MealSlot } from '@/lib/menu'
import { loadPortalMenu, type PortalMenu } from '@/lib/server/parent-portal'

/**
 * The center's menu on the parent page, read only, one week at a time (Sunday to Saturday), opening on this week.
 * Each day shows its meals in the center's serving order with foods, serving notes and allergens, or that the
 * center is closed. Only published months show (parent_portal_menu enforces it); a week that crosses into another
 * month loads that month too.
 */

const dayLabel = (d: string) => fromDateOnly(d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
const shortLabel = (d: string) => fromDateOnly(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Sunday of the week containing the date */
export const sundayOf = (d: string) => addDays(d, -fromDateOnly(d).getDay())

function weekHref(childId: string, week: string | null) {
  const q = new URLSearchParams({ child: childId, tab: 'menu' })
  if (week) q.set('week', week)
  return `/parent?${q.toString()}`
}

export async function MenuView({ tokenHash, childId, week }: { tokenHash: string; childId: string; week: string | null }) {
  // This month first: it also tells us the center's today and which months are published
  const base = await loadPortalMenu(tokenHash, null)
  if (!base) return <Box><p className="text-sm text-text-muted">The menu is not available.</p></Box>

  const thisWeek = sundayOf(base.today)
  const start = week ? sundayOf(week) : thisWeek
  const end = addDays(start, 6)
  const months = [...new Set([monthOf(start), monthOf(end)])]
  const loaded = await Promise.all(months.map(m => (m === base.month ? base : loadPortalMenu(tokenHash, m))))
  const byMonth = new Map(loaded.filter((m): m is PortalMenu => m !== null).map(m => [m.month, m]))

  const published = new Set(base.months)
  const weekHasMenu = (sunday: string) => published.has(monthOf(sunday)) || published.has(monthOf(addDays(sunday, 6)))
  const prev = addDays(start, -7)
  const next = addDays(start, 7)
  const isThisWeek = start === thisWeek
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const anyPublished = days.some(d => byMonth.get(monthOf(d))?.published)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {weekHasMenu(prev)
          ? <Link href={weekHref(childId, prev)} aria-label="Previous week" className="rounded-xl border border-border bg-white p-2"><ChevronLeft className="h-5 w-5" /></Link>
          : <span className="w-10" />}
        <div className="text-center">
          <p className="text-base font-bold">{isThisWeek ? 'This week' : `Week of ${shortLabel(start)}`}</p>
          <p className="text-xs text-muted">{shortLabel(start)} – {shortLabel(end)}</p>
        </div>
        {weekHasMenu(next)
          ? <Link href={weekHref(childId, next)} aria-label="Next week" className="rounded-xl border border-border bg-white p-2"><ChevronRight className="h-5 w-5" /></Link>
          : <span className="w-10" />}
      </div>

      {!isThisWeek && (
        <Link href={weekHref(childId, null)} className="block text-center text-sm font-semibold text-brand-600">Back to this week</Link>
      )}

      {!anyPublished ? (
        <Box>
          <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-text-muted">
            <Utensils className="h-8 w-8 text-subtle" />
            The menu for this week is not ready yet.
          </div>
        </Box>
      ) : (
        <WeekDays days={days} byMonth={byMonth} today={base.today} slots={base.slots} />
      )}
      <p className="px-1 text-center text-xs text-muted">Menus can change. Allergens are listed as the center entered them; ask the center about your child’s needs.</p>
    </div>
  )
}

function WeekDays({ days, byMonth, today, slots }: {
  days: string[]; byMonth: Map<string, PortalMenu>; today: string; slots: MealSlot[]
}) {
  const order = (slot: MealSlot) => { const n = slots.indexOf(slot); return n === -1 ? 99 : n }
  return (
    <div className="space-y-2">
      {days.map(d => {
        const month = byMonth.get(monthOf(d))
        const isToday = d === today
        const weekend = fromDateOnly(d).getDay() % 6 === 0
        const closed = month?.published ? month.closed.find(c => c.date === d) : undefined
        const meals = month?.published
          ? month.entries.filter(e => e.date === d).sort((a, b) => order(a.slot) - order(b.slot))
          : []
        let empty: string | null = null
        if (!month?.published) empty = 'Menu not ready yet.'
        else if (closed) empty = `Closed${closed.reason ? ` · ${closed.reason}` : ''}`
        else if (meals.length === 0) empty = weekend ? 'No meals served.' : 'Not on the menu yet.'

        return (
          <div key={d}
            className={`rounded-2xl border bg-white shadow-sm ${empty && weekend ? 'px-4 py-2.5' : 'p-4'} ${isToday ? 'border-brand-600 ring-2 ring-brand-100' : 'border-border'} ${d < today ? 'opacity-75' : ''}`}>
            <p className={`flex items-center gap-2 text-sm font-bold ${empty ? '' : 'mb-2'}`}>
              {dayLabel(d)}
              {isToday && <span className="rounded-full bg-brand-600 px-2 text-[11px] leading-5 text-white">Today</span>}
              {empty && <span className="ml-auto text-xs font-normal text-text-muted">{empty}</span>}
            </p>
            {!empty && (
              <ul className="space-y-2.5">
                {meals.map(m => <Meal key={m.slot} meal={m} />)}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Meal({ meal }: { meal: PortalMenu['entries'][number] }) {
  const allergens = [...new Set(meal.foods.flatMap(f => f.allergens))]
  const foods = meal.foods.length > 0
    ? meal.foods.map(f => (f.serving_note ? `${f.name} (${f.serving_note})` : f.name)).join(', ')
    : meal.name
  return (
    <li className="text-[15px] leading-snug">
      <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-brand-700">{SLOT_LABELS[meal.slot]}</span>
      <span className="text-text-main">{foods}</span>
      {meal.note && <span className="block text-sm text-text-muted">{meal.note}</span>}
      {allergens.length > 0 && <span className="mt-1 block text-xs text-amber-800">Contains: {allergens.join(', ')}</span>}
    </li>
  )
}

function Box({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-border bg-white p-4 shadow-sm">{children}</section>
}

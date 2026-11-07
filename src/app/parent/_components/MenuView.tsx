import Link from 'next/link'
import { ChevronLeft, ChevronRight, Utensils } from 'lucide-react'
import { SLOT_LABELS, fromDateOnly, monthLabel, monthWeeks, type MealSlot } from '@/lib/menu'
import { loadPortalMenu, type PortalMenu } from '@/lib/server/parent-portal'

/**
 * The center's monthly menu on the parent page, read only: published months only, week by week, each weekday
 * with its meals in the center's serving order, the foods (with serving notes and allergens) and closed days.
 */

const dayLabel = (d: string) => fromDateOnly(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const monthParam = (m: string) => m.slice(0, 7)

function menuHref(childId: string, month: string | null) {
  const q = new URLSearchParams({ child: childId, tab: 'menu' })
  if (month) q.set('month', monthParam(month))
  return `/parent?${q.toString()}`
}

export async function MenuView({ tokenHash, childId, month }: { tokenHash: string; childId: string; month: string | null }) {
  const menu = await loadPortalMenu(tokenHash, month)
  if (!menu) return <Box><p className="text-sm text-text-muted">The menu is not available.</p></Box>

  const before = [...menu.months].reverse().find(m => m < menu.month) ?? null
  const after = menu.months.find(m => m > menu.month) ?? null
  const isThisMonth = menu.month === `${menu.today.slice(0, 7)}-01`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {before
          ? <Link href={menuHref(childId, before)} aria-label={`Menu for ${monthLabel(before)}`} className="rounded-xl border border-border bg-white p-2"><ChevronLeft className="h-5 w-5" /></Link>
          : <span className="w-10" />}
        <div className="text-center">
          <p className="text-base font-bold">{monthLabel(menu.month)}</p>
          {isThisMonth && <p className="text-xs text-muted">This month</p>}
        </div>
        {after
          ? <Link href={menuHref(childId, after)} aria-label={`Menu for ${monthLabel(after)}`} className="rounded-xl border border-border bg-white p-2"><ChevronRight className="h-5 w-5" /></Link>
          : <span className="w-10" />}
      </div>

      {!menu.published ? (
        <Box>
          <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-text-muted">
            <Utensils className="h-8 w-8 text-subtle" />
            The menu for {monthLabel(menu.month)} is not ready yet.
            {menu.months.length > 0 && (
              <span className="mt-1 flex flex-wrap justify-center gap-2">
                {menu.months.map(m => (
                  <Link key={m} href={menuHref(childId, m)} className="rounded-full border border-border bg-white px-3 py-1 text-xs font-semibold text-brand-600">{monthLabel(m)}</Link>
                ))}
              </span>
            )}
          </div>
        </Box>
      ) : (
        <>
          {isThisMonth && <a href="#today" className="block text-center text-sm font-semibold text-brand-600">Jump to today</a>}
          <MonthWeeks menu={menu} />
        </>
      )}
    </div>
  )
}

function MonthWeeks({ menu }: { menu: PortalMenu }) {
  const byDay = new Map<string, PortalMenu['entries']>()
  for (const e of menu.entries) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e])
  const closed = new Map(menu.closed.map(c => [c.date, c.reason]))
  const order = (slot: MealSlot) => { const n = menu.slots.indexOf(slot); return n === -1 ? 99 : n }

  return (
    <>
      {monthWeeks(menu.month).map(week => {
        const days = week.filter((d): d is string => d !== null)
        if (days.length === 0) return null
        const thisWeek = days[0] <= menu.today && menu.today <= days[days.length - 1]
        return (
          <section key={days[0]} aria-label={`Week of ${dayLabel(days[0])}`} className="space-y-2">
            <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted">{thisWeek ? 'This week' : `Week of ${dayLabel(days[0])}`}</h2>
            {days.map(d => {
              const today = d === menu.today
              const meals = (byDay.get(d) ?? []).slice().sort((a, b) => order(a.slot) - order(b.slot))
              return (
                <div key={d} id={today ? 'today' : undefined}
                  className={`scroll-mt-4 rounded-2xl border bg-white p-4 shadow-sm ${today ? 'border-brand-600 ring-2 ring-brand-100' : 'border-border'} ${d < menu.today ? 'opacity-75' : ''}`}>
                  <p className="mb-2 flex items-center gap-2 text-sm font-bold">
                    {dayLabel(d)}
                    {today && <span className="rounded-full bg-brand-600 px-2 text-[11px] leading-5 text-white">Today</span>}
                  </p>
                  {closed.has(d) ? (
                    <p className="text-sm text-text-muted">Closed{closed.get(d) ? ` · ${closed.get(d)}` : ''}</p>
                  ) : meals.length === 0 ? (
                    <p className="text-sm text-muted">Not on the menu yet.</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {meals.map(m => <Meal key={m.slot} meal={m} />)}
                    </ul>
                  )}
                </div>
              )
            })}
          </section>
        )
      })}
      <p className="px-1 text-center text-xs text-muted">Menus can change. Allergens are listed as the center entered them; ask the center about your child’s needs.</p>
    </>
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

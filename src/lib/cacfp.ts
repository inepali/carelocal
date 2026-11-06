/**
 * CACFP meal-pattern checks for children 1–12 (the 2017 child and adult meal pattern), run on what a menu puts
 * on the plate. Infant meal patterns are not covered.
 *
 *  - Breakfast: milk, grains, and a vegetable or fruit. A meat/meat alternate may stand in for the whole grains
 *    component, at most 3 times a week.
 *  - Lunch and supper: milk, meat/meat alternate, grains, vegetable and fruit. A second, different vegetable may
 *    stand in for the fruit.
 *  - Snacks: at least two different components.
 *  - Every day: at least one grain served must be whole grain-rich.
 *  - Grain-based desserts never count toward the grains component.
 *
 * These checks cover the components and the rules above only. Portion sizes, added-sugar limits on cereal and
 * yogurt, juice limits and milk type by age are the center's responsibility and its sponsor's to confirm.
 *
 * Pure functions with relative imports only, so `npm run test:cacfp` runs them in plain Node.
 */
import type { EntryFood, FoodComponent, MealSlot } from './menu'

export type CreditedComponent = Exclude<FoodComponent, 'other'>

export interface MealCheck {
  ok: boolean
  /** Components credited by this meal */
  present: CreditedComponent[]
  /** Short, plain-language problems ("Missing milk") */
  problems: string[]
  /** Breakfast used a meat/meat alternate in place of grains */
  meatForGrain: boolean
  /** Credited a whole grain-rich grain */
  wholeGrainRich: boolean
  /** Credited any grain */
  hasGrain: boolean
}

export interface DayCheck {
  date: string
  ok: boolean
  meals: Partial<Record<MealSlot, MealCheck>>
  /** Problems with the day as a whole (whole grain-rich) */
  problems: string[]
}

export interface WeekIssue { weekStart: string; message: string }

const LABEL: Record<CreditedComponent, string> = {
  milk: 'milk', grain: 'grains', meat_alt: 'meat/meat alternate', vegetable: 'vegetable', fruit: 'fruit',
}

/** What a food credits toward, if anything (grain-based desserts and "other" credit nothing) */
export function credits(food: Pick<EntryFood, 'component' | 'grain_dessert'>): CreditedComponent | null {
  if (food.component === 'other') return null
  if (food.component === 'grain' && food.grain_dessert) return null
  return food.component
}

export function checkMeal(slot: MealSlot, foods: EntryFood[]): MealCheck {
  const credited = foods.map(f => ({ f, c: credits(f) })).filter((x): x is { f: EntryFood; c: CreditedComponent } => x.c !== null)
  const has = (c: CreditedComponent) => credited.some(x => x.c === c)
  const distinctVegetables = new Set(credited.filter(x => x.c === 'vegetable').map(x => x.f.food_item_id)).size
  const problems: string[] = []
  let meatForGrain = false
  const hasGrain = has('grain')
  const wholeGrainRich = credited.some(x => x.c === 'grain' && x.f.whole_grain_rich)

  if (foods.some(f => f.component === 'grain' && f.grain_dessert)) {
    problems.push('Grain-based desserts don’t count as grains')
  }

  if (slot === 'breakfast') {
    if (!has('milk')) problems.push('Missing milk')
    if (!hasGrain) {
      if (has('meat_alt')) meatForGrain = true
      else problems.push('Missing grains')
    }
    if (!has('vegetable') && !has('fruit')) problems.push('Missing a vegetable or fruit')
  } else if (slot === 'lunch' || slot === 'supper') {
    for (const c of ['milk', 'meat_alt', 'grain', 'vegetable'] as const) if (!has(c)) problems.push(`Missing ${LABEL[c]}`)
    if (!has('fruit') && distinctVegetables < 2) problems.push('Missing fruit (or a second vegetable)')
  } else {
    const distinct = new Set(credited.map(x => x.c)).size
    if (distinct < 2) problems.push('A snack needs two different components')
  }

  // Grain-dessert note alone does not fail the meal if the components are still all there
  const blocking = problems.filter(p => !p.startsWith('Grain-based desserts'))
  const present = [...new Set(credited.map(x => x.c))]
  return { ok: blocking.length === 0, present, problems, meatForGrain, wholeGrainRich, hasGrain }
}

export function checkDay(date: string, meals: Partial<Record<MealSlot, EntryFood[]>>): DayCheck {
  const checks: Partial<Record<MealSlot, MealCheck>> = {}
  for (const [slot, foods] of Object.entries(meals) as [MealSlot, EntryFood[]][]) checks[slot] = checkMeal(slot, foods)
  const all = Object.values(checks) as MealCheck[]
  const problems: string[] = []
  if (all.some(m => m.hasGrain) && !all.some(m => m.wholeGrainRich)) {
    problems.push('No whole grain-rich grain today')
  }
  return { date, ok: problems.length === 0 && all.every(m => m.ok), meals: checks, problems }
}

/** Week-level rules: breakfast meat/meat alternate in place of grains at most 3 times per week */
export function checkWeeks(days: DayCheck[], mondayOf: (date: string) => string): WeekIssue[] {
  const counts = new Map<string, number>()
  for (const d of days) if (d.meals.breakfast?.meatForGrain) {
    const w = mondayOf(d.date)
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 3)
    .map(([weekStart, n]) => ({ weekStart, message: `Meat/meat alternate replaced grains at breakfast ${n} times (limit 3 a week)` }))
}

export interface MonthSummary {
  mealsPlanned: number
  mealsOk: number
  daysWithProblems: number
}

export function summarize(days: DayCheck[]): MonthSummary {
  let mealsPlanned = 0, mealsOk = 0, daysWithProblems = 0
  for (const d of days) {
    for (const m of Object.values(d.meals) as MealCheck[]) { mealsPlanned++; if (m.ok) mealsOk++ }
    if (!d.ok) daysWithProblems++
  }
  return { mealsPlanned, mealsOk, daysWithProblems }
}

export const COMPONENT_SHORT: Record<CreditedComponent, string> = {
  milk: 'M', grain: 'G', meat_alt: 'MA', vegetable: 'V', fruit: 'F',
}

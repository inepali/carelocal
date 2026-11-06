/** Menu planning: shared types, labels and month-grid helpers (center admin, cook and staff views) */

export type MealSlot = 'breakfast' | 'am_snack' | 'lunch' | 'pm_snack' | 'supper'
export type FoodComponent = 'milk' | 'grain' | 'meat_alt' | 'vegetable' | 'fruit' | 'other'
export type MenuMonthStatus = 'draft' | 'published'

/** Every slot in serving order; a center serves a subset (centers.menu_slots) */
export const ALL_SLOTS: MealSlot[] = ['breakfast', 'am_snack', 'lunch', 'pm_snack', 'supper']

export const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  am_snack: 'AM Snack',
  lunch: 'Lunch',
  pm_snack: 'PM Snack',
  supper: 'Supper',
}

/** Short labels for tight calendar cells */
export const SLOT_SHORT: Record<MealSlot, string> = {
  breakfast: 'B',
  am_snack: 'AM',
  lunch: 'L',
  pm_snack: 'PM',
  supper: 'S',
}

export const SLOT_STYLE: Record<MealSlot, string> = {
  breakfast: 'bg-amber-50 text-amber-800 border-amber-200',
  am_snack: 'bg-lime-50 text-lime-800 border-lime-200',
  lunch: 'bg-sky-50 text-sky-800 border-sky-200',
  pm_snack: 'bg-violet-50 text-violet-800 border-violet-200',
  supper: 'bg-rose-50 text-rose-800 border-rose-200',
}

export const COMPONENT_LABELS: Record<FoodComponent, string> = {
  milk: 'Milk',
  grain: 'Grain',
  meat_alt: 'Meat / Alternate',
  vegetable: 'Vegetable',
  fruit: 'Fruit',
  other: 'Other (not creditable)',
}

export const COMPONENTS: FoodComponent[] = ['milk', 'grain', 'meat_alt', 'vegetable', 'fruit', 'other']

/** Common allergens offered as quick picks; centers can type their own */
export const COMMON_ALLERGENS = ['milk', 'egg', 'wheat', 'soy', 'peanut', 'tree nut', 'fish', 'shellfish', 'sesame']

export interface FoodItem {
  id: string
  center_id: string
  name: string
  component: FoodComponent
  whole_grain_rich: boolean
  grain_dessert: boolean
  allergens: string[]
  is_active: boolean
  sort_order: number
}

export interface PresetItem {
  food_item_id: string
  serving_note: string | null
  sort_order: number
}

export interface MealPreset {
  id: string
  center_id: string
  name: string
  meal_types: MealSlot[]
  notes: string | null
  is_active: boolean
  sort_order: number
  items: PresetItem[]
}

/** The foods copied onto a menu entry when its preset was placed */
export interface EntryFood {
  food_item_id: string
  name: string
  component: FoodComponent
  whole_grain_rich: boolean
  grain_dessert: boolean
  allergens: string[]
  serving_note: string | null
}

export interface MenuEntry {
  id: string
  center_id: string
  /** YYYY-MM-DD */
  service_date: string
  slot: MealSlot
  preset_id: string | null
  preset_name: string
  items: EntryFood[]
  note: string | null
}

export interface MenuMonth {
  center_id: string
  /** First of the month, YYYY-MM-DD */
  month: string
  status: MenuMonthStatus
  published_at: string | null
  published_by_name: string | null
}

export interface ClosedDay {
  center_id: string
  service_date: string
  reason: string | null
}

/** Foods a preset would put on the plate, in order (used before an entry exists, e.g. in the palette) */
export function presetFoods(preset: MealPreset, foods: Map<string, FoodItem>): EntryFood[] {
  return [...preset.items]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(i => foods.get(i.food_item_id) ? { ...toEntryFood(foods.get(i.food_item_id)!), serving_note: i.serving_note } : null)
    .filter((f): f is EntryFood => f !== null)
}

function toEntryFood(f: FoodItem): EntryFood {
  return {
    food_item_id: f.id, name: f.name, component: f.component, whole_grain_rich: f.whole_grain_rich,
    grain_dessert: f.grain_dessert, allergens: f.allergens, serving_note: null,
  }
}

// ── Dates (local time, never toISOString) ────────────────────────────────────────────────────────────────────

export function toDateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fromDateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(dateOnly: string, days: number): string {
  const d = fromDateOnly(dateOnly)
  d.setDate(d.getDate() + days)
  return toDateOnly(d)
}

/** First of the month containing the date, YYYY-MM-DD */
export function monthOf(dateOnly: string): string {
  return `${dateOnly.slice(0, 7)}-01`
}

export function addMonths(month: string, n: number): string {
  const d = fromDateOnly(month)
  return toDateOnly(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

export function monthLabel(month: string): string {
  return fromDateOnly(month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/** Last day of the month, YYYY-MM-DD */
export function monthEnd(month: string): string {
  const d = fromDateOnly(month)
  return toDateOnly(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

/** 1 = Monday … 7 = Sunday */
export function isoDow(dateOnly: string): number {
  return fromDateOnly(dateOnly).getDay() || 7
}

/** Monday of the week containing the date */
export function mondayOf(dateOnly: string): string {
  return addDays(dateOnly, 1 - isoDow(dateOnly))
}

/**
 * Weeks of a month as Monday–Friday rows (child care menus are weekday menus). Days outside the month are
 * returned as null so the grid keeps its shape. Weekend days are left out.
 */
export function monthWeeks(month: string): (string | null)[][] {
  const end = monthEnd(month)
  const weeks: (string | null)[][] = []
  for (let monday = mondayOf(month); monday <= end; monday = addDays(monday, 7)) {
    const row: (string | null)[] = []
    for (let i = 0; i < 5; i++) {
      const day = addDays(monday, i)
      row.push(monthOf(day) === month ? day : null)
    }
    if (row.some(Boolean)) weeks.push(row)
  }
  return weeks
}

/** Every weekday of the month */
export function monthWeekdays(month: string): string[] {
  return monthWeeks(month).flat().filter((d): d is string => d !== null)
}

export const entryKey = (date: string, slot: MealSlot) => `${date}|${slot}`

// Self-contained on purpose (type-only imports, no path aliases) so the tests can load it with plain node.
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Daily activities: what teachers record about a child's day (meals, bottles, diapers or bathroom, activities,
 * notes). Reads and writes go through the database functions in 20261213000000_daily_entries.sql, with the
 * caller's own Supabase client, so the database decides who may log and who may remove an entry.
 */

export type DailyKind = 'nap' | 'sleep_check' | 'meal' | 'bottle' | 'medicine' | 'diaper' | 'bathroom' | 'photo' | 'activity' | 'note'

export type MealName = 'breakfast' | 'am_snack' | 'lunch' | 'pm_snack' | 'supper'
export type MealAmount = 'none' | 'little' | 'half' | 'all' | 'other'
export type BottleContents = 'formula' | 'breast_milk' | 'milk' | 'other'
export type DiaperResult = 'wet' | 'bm' | 'wet_bm' | 'dry'
export type BathroomResult = 'went' | 'tried' | 'accident'

export interface DailyDetails {
  meal?: MealName
  amount?: MealAmount
  oz?: number
  contents?: BottleContents
  other?: string
  result?: DiaperResult | BathroomResult
  type?: 'wet' | 'bm' | 'wet_bm'
  cream?: boolean
  text?: string
  note?: string
}

/** One row of daily_day() */
export interface DailyEntry {
  id: string
  kind: DailyKind
  at: string
  ends_at: string | null
  details: DailyDetails
  batch_id: string | null
  recorded_by: string | null
  mine: boolean
  can_void: boolean
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}

export const MEALS: { value: MealName; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'am_snack', label: 'AM snack' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'pm_snack', label: 'PM snack' },
  { value: 'supper', label: 'Supper' },
]
export const AMOUNTS: { value: MealAmount; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'little', label: 'Little' },
  { value: 'half', label: 'Half' },
  { value: 'all', label: 'All' },
  { value: 'other', label: 'Other' },
]
export const BOTTLE_CONTENTS: { value: BottleContents; label: string }[] = [
  { value: 'formula', label: 'Formula' },
  { value: 'breast_milk', label: 'Breast milk' },
  { value: 'milk', label: 'Milk' },
  { value: 'other', label: 'Other' },
]
export const DIAPER_RESULTS: { value: DiaperResult; label: string }[] = [
  { value: 'wet', label: 'Wet' },
  { value: 'bm', label: 'BM' },
  { value: 'wet_bm', label: 'Wet + BM' },
  { value: 'dry', label: 'Dry' },
]
export const BATHROOM_RESULTS: { value: BathroomResult; label: string }[] = [
  { value: 'went', label: 'Went' },
  { value: 'tried', label: 'Tried' },
  { value: 'accident', label: 'Accident' },
]
export const BATHROOM_TYPES: { value: 'wet' | 'bm' | 'wet_bm'; label: string }[] = [
  { value: 'wet', label: 'Wet' },
  { value: 'bm', label: 'BM' },
  { value: 'wet_bm', label: 'Both' },
]

/** 0.5 to 12 ounces in half ounces, for the bottle number pad */
export const BOTTLE_OUNCES = Array.from({ length: 24 }, (_, i) => (i + 1) / 2)

/** Bottles are offered for infants and toddlers (under 3 years) */
export const showsBottle = (ageMonths: number | null | undefined) => ageMonths != null && ageMonths < 36

/** The meal most likely being served now (center local time), to pre-select in the form */
export function mealForTime(d: Date = new Date()): MealName {
  const h = d.getHours() + d.getMinutes() / 60
  if (h < 9.5) return 'breakfast'
  if (h < 11) return 'am_snack'
  if (h < 13.5) return 'lunch'
  if (h < 17) return 'pm_snack'
  return 'supper'
}

const label = (list: { value: string; label: string }[], v: string | undefined) => list.find(x => x.value === v)?.label ?? ''
const oz = (n: number | undefined) => (n == null ? '' : `${Number.isInteger(n) ? n : n.toFixed(1)} oz`)

export const KIND_LABEL: Record<DailyKind, string> = {
  nap: 'Nap', sleep_check: 'Sleep check', meal: 'Meal', bottle: 'Bottle', medicine: 'Medicine',
  diaper: 'Diaper', bathroom: 'Bathroom', photo: 'Photo', activity: 'Activity', note: 'Note',
}

/** The words for one entry in today's list: "Lunch · Half", "Bottle · 4.5 oz formula", "Diaper · Wet + BM, cream" */
export function describeEntry(e: Pick<DailyEntry, 'kind' | 'details'>): { title: string; detail: string } {
  const d = e.details ?? {}
  switch (e.kind) {
    case 'meal':
      return { title: label(MEALS, d.meal) || 'Meal', detail: d.amount === 'other' ? (d.other ?? 'Other') : label(AMOUNTS, d.amount) }
    case 'bottle':
      return { title: 'Bottle', detail: [oz(d.oz), d.contents === 'other' ? d.other : label(BOTTLE_CONTENTS, d.contents).toLowerCase()].filter(Boolean).join(' ') }
    case 'diaper':
      return { title: 'Diaper', detail: [label(DIAPER_RESULTS, d.result), d.cream ? 'cream' : ''].filter(Boolean).join(', ') }
    case 'bathroom':
      return { title: 'Bathroom', detail: [label(BATHROOM_RESULTS, d.result), d.type ? `(${label(BATHROOM_TYPES, d.type).toLowerCase()})` : ''].filter(Boolean).join(' ') }
    case 'activity':
    case 'note':
      return { title: KIND_LABEL[e.kind], detail: d.text ?? '' }
    default:
      return { title: KIND_LABEL[e.kind] ?? 'Entry', detail: '' }
  }
}

/** "Today at a glance" chips from the day's entries (removed entries left out) */
export function glanceChips(entries: Pick<DailyEntry, 'kind' | 'details' | 'voided_at' | 'at'>[]): string[] {
  const live = entries.filter(e => !e.voided_at).sort((a, b) => a.at.localeCompare(b.at))
  const chips: string[] = []
  for (const m of MEALS) {
    const last = live.filter(e => e.kind === 'meal' && e.details.meal === m.value).pop()
    if (last) chips.push(`${m.label}: ${last.details.amount === 'other' ? 'other' : label(AMOUNTS, last.details.amount).toLowerCase()}`)
  }
  const bottles = live.filter(e => e.kind === 'bottle')
  if (bottles.length) chips.push(`${bottles.length} ${bottles.length === 1 ? 'bottle' : 'bottles'} · ${oz(bottles.reduce((s, e) => s + (e.details.oz ?? 0), 0))}`)
  const diapers = live.filter(e => e.kind === 'diaper').length
  if (diapers) chips.push(`${diapers} ${diapers === 1 ? 'diaper' : 'diapers'}`)
  const potty = live.filter(e => e.kind === 'bathroom')
  if (potty.length) {
    const accidents = potty.filter(e => e.details.result === 'accident').length
    chips.push(`${potty.length} bathroom${accidents ? ` · ${accidents} ${accidents === 1 ? 'accident' : 'accidents'}` : ''}`)
  }
  const acts = live.filter(e => e.kind === 'activity').length
  if (acts) chips.push(`${acts} ${acts === 1 ? 'activity' : 'activities'}`)
  return chips
}

type Failure = { success: false; error: string }

/** The database's own messages are written for teachers; fall back to a plain one */
export function friendlyDailyError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return 'Something went wrong.'
  const msg = error.message?.replace(/^.*?ERROR:\s*/, '')
  if (msg) return msg
  return error.code === '42501' ? 'You do not have access to this.' : 'Something went wrong.'
}

export const newKey = () => crypto.randomUUID()

export async function loadDay(supabase: SupabaseClient, centerId: string, childId: string, day?: string): Promise<{ success: true; entries: DailyEntry[] } | Failure> {
  const { data, error } = await supabase.rpc('daily_day', { p_center_id: centerId, p_child_id: childId, p_day: day ?? null })
  if (error) return { success: false, error: friendlyDailyError(error) }
  return { success: true, entries: (data ?? []) as DailyEntry[] }
}

/** One entry. Pass the same key when retrying a tap so it is saved once. */
export async function addEntry(supabase: SupabaseClient, centerId: string, childId: string, kind: DailyKind, details: DailyDetails,
  opts: { at?: string | null; key?: string } = {}): Promise<{ success: true; id: string } | Failure> {
  const { data, error } = await supabase.rpc('daily_entry_add', {
    p_center_id: centerId, p_child_id: childId, p_kind: kind, p_details: details, p_at: opts.at ?? null, p_client_key: opts.key ?? newKey(),
  })
  if (error) return { success: false, error: friendlyDailyError(error) }
  return { success: true, id: data as string }
}

/** The same kind for several children (Meal served, Activity with class). All or nothing. */
export async function addClassEntry(supabase: SupabaseClient, centerId: string, kind: 'meal' | 'activity' | 'note',
  items: { child_id: string; details: DailyDetails }[], opts: { at?: string | null; key?: string } = {}): Promise<{ success: true; count: number } | Failure> {
  const { data, error } = await supabase.rpc('daily_class_entry', {
    p_center_id: centerId, p_kind: kind, p_items: items, p_at: opts.at ?? null, p_batch_key: opts.key ?? newKey(),
  })
  if (error) return { success: false, error: friendlyDailyError(error) }
  return { success: true, count: data as number }
}

export async function voidEntry(supabase: SupabaseClient, entryId: string, reason: string): Promise<{ success: true } | Failure> {
  const { error } = await supabase.rpc('daily_entry_void', { p_entry_id: entryId, p_reason: reason })
  if (error) return { success: false, error: friendlyDailyError(error) }
  return { success: true }
}

/** "13:05" on today's date → an ISO time for p_at; null when the field is empty (the database uses now) */
export function timeToIso(hhmm: string, base: Date = new Date()): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const d = new Date(base)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d.toISOString()
}

/** Now as "HH:MM" for a time input */
export function nowHHMM(d: Date = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

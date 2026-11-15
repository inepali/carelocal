// Self-contained on purpose (type-only imports, no path aliases) so scripts/tuition/tuition.test.mjs can load it with plain node.
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Tuition fees and payment: the rate card per program, the fees on each child and who pays how.
 * The database (20270109000000_tuition_fees.sql) does the money math and decides what can be saved; everything here
 * calls its functions with the CALLER's Supabase client (owner or admin of the center, Tuition switched on).
 * The pure helpers below only format and pre-check, so the admin sees a problem before pressing Save.
 */

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'one_time'
export type FeeKind = 'tuition' | 'registration' | 'annual' | 'activity' | 'late_pickup' | 'other'
export type PayMethod = 'ach' | 'credit_card' | 'check' | 'other'
export type ShareType = 'fixed' | 'percent' | 'remainder'
export type PayerKind = 'family' | 'subsidy' | 'employer' | 'other'

export const FREQUENCIES: { value: Frequency; label: string; per: string }[] = [
  { value: 'weekly', label: 'Weekly', per: 'week' },
  { value: 'biweekly', label: 'Every 2 weeks', per: '2 weeks' },
  { value: 'monthly', label: 'Monthly', per: 'month' },
  { value: 'one_time', label: 'One time', per: 'one time' },
]
export const FEE_KINDS: { value: FeeKind; label: string }[] = [
  { value: 'tuition', label: 'Tuition' },
  { value: 'registration', label: 'Registration' },
  { value: 'annual', label: 'Annual / supply fee' },
  { value: 'activity', label: 'Activity' },
  { value: 'late_pickup', label: 'Late pick-up' },
  { value: 'other', label: 'Other' },
]
export const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: 'ach', label: 'ACH (bank draft)' },
  { value: 'credit_card', label: 'Credit / debit card' },
  { value: 'check', label: 'Check' },
  { value: 'other', label: 'Other' },
]
export const PAYER_KINDS: { value: PayerKind; label: string }[] = [
  { value: 'family', label: 'Family' },
  { value: 'subsidy', label: 'Subsidy / voucher' },
  { value: 'employer', label: 'Employer' },
  { value: 'other', label: 'Other' },
]

export const frequencyLabel = (f: string) => FREQUENCIES.find(x => x.value === f)?.label ?? f
export const frequencyPer = (f: string) => FREQUENCIES.find(x => x.value === f)?.per ?? f
export const feeKindLabel = (k: string) => FEE_KINDS.find(x => x.value === k)?.label ?? k
export const methodLabel = (m: string) => ({ ach: 'ACH', credit_card: 'Card', check: 'Check', other: 'Other' } as Record<string, string>)[m] ?? m

/** $1,234.50 */
export function money(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—'
  const v = typeof n === 'string' ? Number(n) : n
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/** A money field as the user typed it ("$1,200", "285.5") → number, or null when empty or not a number */
export function parseMoney(s: string | null | undefined): number | null {
  const t = (s ?? '').replace(/[$,\s]/g, '')
  if (t === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Number(t)
}

/** "15% off (Sibling)" / "$20.00 off" / "locked-in price $250.00" / "" */
export function discountLabel(d: { discount_type?: string | null; discount_value?: number | string | null; discount_reason?: string | null; override_amount?: number | string | null }) {
  if (d.override_amount != null && d.override_amount !== '') return `Locked-in price ${money(d.override_amount)}`
  if (d.discount_type === 'percent') return `${Number(d.discount_value)}% off${d.discount_reason ? ` (${d.discount_reason})` : ''}`
  if (d.discount_type === 'amount') return `${money(d.discount_value)} off${d.discount_reason ? ` (${d.discount_reason})` : ''}`
  return ''
}

/** "Fixed $200.00 / week" / "50%" / "The rest" */
export function shareLabel(p: { share_type: string; share_value?: number | string | null; fixed_frequency?: string | null }) {
  if (p.share_type === 'remainder') return 'The rest'
  if (p.share_type === 'percent') return `${Number(p.share_value)}%`
  return `${money(p.share_value)} / ${frequencyPer(p.fixed_frequency ?? 'weekly')}`
}

/** "ACH · Checking ····4417 · Wells Fargo" */
export function methodDetail(p: { method: string; account_type?: string | null; last4?: string | null; bank_name?: string | null; card_brand?: string | null; other_details?: string | null }) {
  const parts = [methodLabel(p.method)]
  if (p.method === 'ach') {
    if (p.account_type) parts.push(p.account_type === 'savings' ? 'Savings' : 'Checking')
    if (p.last4) parts.push(`····${p.last4}`)
    if (p.bank_name) parts.push(p.bank_name)
  } else if (p.method === 'credit_card') {
    if (p.card_brand) parts.push(p.card_brand)
    if (p.last4) parts.push(`····${p.last4}`)
  } else if (p.other_details) {
    parts.push(p.other_details)
  }
  return parts.join(' · ')
}

/** The Monday on or after a day (rate changes usually start on a period boundary) */
export function nextMonday(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  const add = (8 - d.getDay()) % 7 || 7
  d.setDate(d.getDate() + add)
  return isoOf(d)
}
/** The 1st of the month after a day */
export function nextFirstOfMonth(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return isoOf(new Date(d.getFullYear(), d.getMonth() + 1, 1, 12))
}
/**
 * The first day a new price starting on `from` is actually charged: every week (Monday) or month (the 1st) uses the
 * price in force on its first day, so a price from a Wednesday is first charged the next Monday. Two-week periods
 * count from each child's start day, so they return null (it differs per child).
 */
export function firstChargedOn(frequency: string, from: string): string | null {
  if (!from) return null
  if (frequency === 'weekly') return new Date(`${from}T12:00:00`).getDay() === 1 ? from : nextMonday(from)
  if (frequency === 'monthly') return from.endsWith('-01') ? from : nextFirstOfMonth(from)
  if (frequency === 'one_time') return from
  return null
}
/** A good default start for a new rate of a fee: the next period boundary after today */
export function suggestedRateStart(frequency: string, today: string) {
  return frequency === 'monthly' ? nextFirstOfMonth(today) : nextMonday(today)
}
function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---- Payer lines ---------------------------------------------------------------------------------------------

export interface PayerInput {
  payer_guardian_id?: string | null
  payer_name?: string | null
  payer_kind?: PayerKind
  share_type: ShareType
  share_value?: string            // as typed: "200", "50"
  fixed_frequency?: 'weekly' | 'biweekly' | 'monthly'
  method: PayMethod
  bank_name?: string
  account_type?: 'checking' | 'savings' | ''
  last4?: string
  card_brand?: string
  other_details?: string
  draft_day?: string
  authorization_on_file?: boolean
  authorization_signed_on?: string
  authorization_file_id?: string | null
}

/**
 * The same rules public.child_payment_plan_save() enforces, as one message for the first problem (or null):
 * a payer for each line, at most one "the rest", percents ≤ 100 and exactly 100 without "the rest",
 * a positive amount for fixed and percent lines, only the last 4 digits.
 */
export function checkPayers(lines: PayerInput[]): string | null {
  if (lines.length > 6) return 'Up to 6 payers per child.'
  for (const [i, l] of lines.entries()) {
    const who = l.payer_name?.trim() || `Payer ${i + 1}`
    if (!l.payer_guardian_id && !l.payer_name?.trim()) return `Pick a parent or name the payer (payer ${i + 1}).`
    if (!l.method) return `Pick how ${who} pays.`
    if (l.share_type !== 'remainder') {
      const v = Number(l.share_value)
      if (!l.share_value || !Number.isFinite(v) || v <= 0) return l.share_type === 'percent' ? `Give ${who}'s percentage.` : `Give ${who}'s fixed amount.`
      if (l.share_type === 'percent' && v > 100) return `${who}'s percentage is more than 100%.`
      if (l.share_type === 'fixed' && parseMoney(l.share_value) == null) return `${who}'s amount should look like 200 or 200.50.`
    }
    const last4 = (l.last4 ?? '').trim()
    if (last4 && !/^\d{4}$/.test(last4)) return `Enter only the last 4 digits of ${who}'s account or card.`
  }
  const rests = lines.filter(l => l.share_type === 'remainder').length
  if (rests > 1) return 'Only one payer can pay "the rest".'
  const pct = lines.filter(l => l.share_type === 'percent').reduce((s, l) => s + Number(l.share_value || 0), 0)
  if (pct > 100) return 'The percentages add up to more than 100%.'
  if (rests === 0 && pct > 0 && Math.abs(pct - 100) > 1e-9) return `The percentages add up to ${pct}%. Make them 100%, or let one payer pay "the rest".`
  return null
}

/**
 * Preview of how one period's total splits, the same way public.tuition_split() does it: fixed amounts (of that
 * frequency) first, percents of what is left (rounded down to the cent), then "the rest". Without "the rest", the
 * leftover cents go to the first percent line when the percents make 100%. Amounts in cents to avoid float drift.
 */
export function previewSplit(total: number, frequency: string, lines: PayerInput[]) {
  const T = Math.round(total * 100)
  const order = (l: PayerInput) => (l.share_type === 'fixed' ? 0 : l.share_type === 'percent' ? 1 : 2)
  const applies = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.share_type !== 'fixed' || (l.fixed_frequency ?? 'weekly') === frequency)
  const sorted = [...applies].sort((a, b) => order(a.l) - order(b.l) || a.i - b.i)
  const fixedSum = sorted.filter(x => x.l.share_type === 'fixed').reduce((s, x) => s + Math.round(Number(x.l.share_value || 0) * 100), 0)
  const left = Math.max(T - fixedSum, 0)
  const pctSum = sorted.filter(x => x.l.share_type === 'percent').reduce((s, x) => s + Number(x.l.share_value || 0), 0)
  const amounts = new Map<number, number>()
  let given = 0
  let firstPct: number | null = null
  let rest: number | null = null
  for (const { l, i } of sorted) {
    let a = 0
    if (l.share_type === 'fixed') a = Math.min(Math.round(Number(l.share_value || 0) * 100), Math.max(T - given, 0))
    else if (l.share_type === 'percent') { a = Math.floor(left * Number(l.share_value || 0) / 100); firstPct ??= i }
    else rest = i
    given += a
    amounts.set(i, a)
  }
  let unassigned = Math.max(T - given, 0)
  if (rest != null) { amounts.set(rest, unassigned); unassigned = 0 }
  else if (firstPct != null && Math.abs(pctSum - 100) < 1e-9) { amounts.set(firstPct, (amounts.get(firstPct) ?? 0) + unassigned); unassigned = 0 }
  return {
    amounts: lines.map((_, i) => (amounts.has(i) ? amounts.get(i)! / 100 : null)),
    unassigned: unassigned / 100,
    over: Math.max(fixedSum - T, 0) / 100,
  }
}

// ---- Shapes the database returns ------------------------------------------------------------------------------

export interface RateRow { id: string; amount: number; from: string; to: string | null; note: string | null; created_at?: string }
export interface FeeRow {
  id: string; program_id: string | null; name: string; kind: FeeKind; frequency: Frequency; is_active: boolean; sort_order: number
  children: number
  current: { id: string; amount: number; from: string; to: string | null } | null
  upcoming: { id: string; amount: number; from: string } | null
  rates: RateRow[]
}
export interface RateCard {
  can_manage: boolean; is_owner: boolean; today: string
  programs: { id: string; name: string; is_active: boolean }[]
  fees: FeeRow[]
}
export interface FeeOption { id: string; label: string; program_id: string | null; frequency: Frequency; kind: FeeKind; amount: number | null }

export interface TuitionLine {
  child_tuition_id: string; fee_id: string; fee_name: string; kind: FeeKind; frequency: Frequency; program_id: string | null
  period_start: string; period_end: string; rate_date: string; rate_id: string | null
  list_amount: number | null; discount_type: string | null; discount_value: number | null; discount_reason: string | null
  override_amount: number | null; discount_amount: number; net_amount: number | null; start_date: string; end_date: string | null
}
export interface Period {
  frequency: Frequency; period_start: string; period_end: string; total: number; unassigned: number; over: number
  payers: { payer_id: string; amount: number }[]
  lines: TuitionLine[]
}
export interface ChildFee {
  id: string; fee_id: string; label: string; frequency: Frequency; kind: FeeKind; start: string; end: string | null
  discount_type: 'percent' | 'amount' | null; discount_value: number | null; discount_reason: string | null; override_amount: number | null
  created_today: boolean
  upcoming_rate: { amount: number; from: string; charged_from: string } | null
}
export interface PayerRow {
  id: string; payer_guardian_id: string | null; payer_name: string; payer_kind: PayerKind; relationship: string | null
  share_type: ShareType; share_value: number | null; fixed_frequency: 'weekly' | 'biweekly' | 'monthly' | null
  method: PayMethod; bank_name: string | null; account_type: 'checking' | 'savings' | null; last4: string | null; card_brand: string | null
  other_details: string | null; draft_day: string | null; authorization_on_file: boolean; authorization_signed_on: string | null
  authorization_file_id: string | null; effective_from: string; effective_to: string | null; sort_order: number
}
export interface ChildTuition {
  today: string; is_owner: boolean
  child: { id: string; center_id: string; first_name: string; status: string; enrolled_on: string; withdrawn_on: string | null; program_id: string | null }
  periods: Period[]
  fees: ChildFee[]
  one_time: { id: string; label: string; on: string; net_amount: number | null; discount: string; created_today: boolean }[]
  history: { id: string; label: string; frequency: Frequency; start: string; end: string | null; terms: string; first_amount: number | null }[]
  payers: PayerRow[]
  upcoming_payers: PayerRow[]
  payer_history: { payer_name: string; share_type: ShareType; share_value: number | null; fixed_frequency: string | null; method: PayMethod; last4: string | null; from: string; to: string | null }[]
  guardians: { id: string; name: string; relationship: string | null; email: string | null; is_primary: boolean }[]
  files: { id: string; file_name: string }[]
  siblings: { id: string; first_name: string; last_name: string }[]
  options: FeeOption[]
}

/** A payer row from the database as an editable line */
export function payerToInput(p: PayerRow): PayerInput {
  return {
    payer_guardian_id: p.payer_guardian_id, payer_name: p.payer_name, payer_kind: p.payer_kind,
    share_type: p.share_type, share_value: p.share_value == null ? '' : String(Number(p.share_value)),
    fixed_frequency: p.fixed_frequency ?? 'weekly', method: p.method, bank_name: p.bank_name ?? '', account_type: p.account_type ?? '',
    last4: p.last4 ?? '', card_brand: p.card_brand ?? '', other_details: p.other_details ?? '', draft_day: p.draft_day ?? '',
    authorization_on_file: p.authorization_on_file, authorization_signed_on: p.authorization_signed_on ?? '',
    authorization_file_id: p.authorization_file_id,
  }
}

// ---- Database calls ------------------------------------------------------------------------------------------

type Failure = { success: false; error: string }
type Ok<T> = { success: true } & T

/** A message a person can act on, instead of a raw database error */
export function friendlyTuitionError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return 'Something went wrong.'
  const msg = error.message?.replace(/^.*?ERROR:\s*/, '') ?? ''
  if (error.code === '23505' || msg.includes('tuition_fees_name_unique')) return 'A fee with that name already exists for this program.'
  if (error.code === '23P01' && !msg.startsWith('The child')) return 'Those dates overlap dates already on file.'
  if (error.code === 'PGRST202') return 'Tuition is not set up on this database yet.'
  return msg || 'Something went wrong.'
}
const fail = (error: { code?: string; message?: string } | string | null | undefined): Failure =>
  ({ success: false, error: typeof error === 'string' ? error : friendlyTuitionError(error) })

async function call<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Ok<{ data: T }> | Failure> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return fail(error)
  return { success: true, data: data as T }
}

export const loadRateCard = (s: SupabaseClient, centerId: string) => call<RateCard>(s, 'tuition_fees_list', { p_center_id: centerId })

export interface FeeInput { id?: string; program_id: string | null; name: string; kind: FeeKind; frequency: Frequency; is_active?: boolean; sort_order?: number; amount?: string; from?: string }
export function saveFee(s: SupabaseClient, centerId: string, input: FeeInput) {
  if (!input.name.trim()) return Promise.resolve(fail('Give the fee a name.'))
  if (!input.id) {
    if (parseMoney(input.amount) == null) return Promise.resolve(fail('Give the amount, like 285 or 285.50.'))
    if (!input.from) return Promise.resolve(fail('Give the date the amount starts.'))
  }
  return call<string>(s, 'tuition_fee_save', {
    p_center_id: centerId,
    p: { ...input, name: input.name.trim(), amount: input.amount == null ? undefined : String(parseMoney(input.amount) ?? '') },
  })
}
export const deleteFee = (s: SupabaseClient, feeId: string) => call<null>(s, 'tuition_fee_delete', { p_fee_id: feeId })
export function setRate(s: SupabaseClient, feeId: string, amount: string, from: string, note?: string) {
  const a = parseMoney(amount)
  if (a == null) return Promise.resolve(fail('Give the amount, like 295 or 295.50.'))
  if (!from) return Promise.resolve(fail('Give the date the new amount starts.'))
  return call<string>(s, 'tuition_rate_set', { p_fee_id: feeId, p_amount: a, p_from: from, p_note: note?.trim() || null })
}
export const deleteRate = (s: SupabaseClient, rateId: string, note?: string) =>
  call<null>(s, 'tuition_rate_delete', { p_rate_id: rateId, p_note: note?.trim() || null })

export const loadChildTuition = (s: SupabaseClient, childId: string) => call<ChildTuition>(s, 'child_tuition_get', { p_child_id: childId })
export const loadFeeOptions = (s: SupabaseClient, centerId: string, programId: string | null) =>
  call<FeeOption[]>(s, 'tuition_fee_options', { p_center_id: centerId, p_program_id: programId })

export interface DiscountInput { discount_type: '' | 'percent' | 'amount' | 'override'; discount_value: string; discount_reason: string }
/** The discount form (one select: none / % / $ / locked-in price) → the database's fields */
export function discountArgs(d: DiscountInput) {
  if (d.discount_type === 'override') return { override_amount: String(parseMoney(d.discount_value) ?? '') }
  if (d.discount_type === 'percent' || d.discount_type === 'amount') {
    return { discount_type: d.discount_type, discount_value: d.discount_value.replace(/[$,%\s]/g, ''), discount_reason: d.discount_reason.trim() }
  }
  return {}
}
export function checkDiscount(d: DiscountInput): string | null {
  if (!d.discount_type) return null
  const raw = d.discount_value.replace(/[$,%\s]/g, '')
  const v = Number(raw)
  if (!raw || !Number.isFinite(v) || v < 0 || (d.discount_type !== 'override' && v === 0)) return 'Give the discount amount.'
  if (d.discount_type === 'percent' && v > 100) return 'A discount can’t be more than 100%.'
  if (d.discount_type !== 'percent' && parseMoney(raw) == null) return 'Amounts look like 20 or 20.50.'
  return null
}
export function discountInputOf(f: Pick<ChildFee, 'discount_type' | 'discount_value' | 'discount_reason' | 'override_amount'>): DiscountInput {
  if (f.override_amount != null) return { discount_type: 'override', discount_value: String(Number(f.override_amount)), discount_reason: '' }
  if (f.discount_type) return { discount_type: f.discount_type, discount_value: String(Number(f.discount_value)), discount_reason: f.discount_reason ?? '' }
  return { discount_type: '', discount_value: '', discount_reason: '' }
}

export function addChildFee(s: SupabaseClient, childId: string, feeId: string, start: string, d: DiscountInput) {
  const problem = checkDiscount(d)
  if (problem) return Promise.resolve(fail(problem))
  return call<string>(s, 'child_tuition_add', { p_child_id: childId, p: { fee_id: feeId, start, ...discountArgs(d) } })
}
export function changeChildFee(s: SupabaseClient, id: string, from: string, d: DiscountInput, note?: string) {
  const problem = checkDiscount(d)
  if (problem) return Promise.resolve(fail(problem))
  return call<string>(s, 'child_tuition_change', { p_id: id, p_from: from, p: discountArgs(d), p_note: note?.trim() || null })
}
/** End a fee after p_end (its last day), or remove it when p_end is null */
export const endChildFee = (s: SupabaseClient, id: string, end: string | null, note?: string) =>
  call<null>(s, 'child_tuition_end', { p_id: id, p_end: end, p_note: note?.trim() || null })

export function savePayers(s: SupabaseClient, childId: string, from: string, lines: PayerInput[], note?: string) {
  const problem = checkPayers(lines)
  if (problem) return Promise.resolve(fail(problem))
  const clean = lines.map(l => ({
    ...l,
    share_value: l.share_type === 'remainder' ? undefined : String(l.share_value ?? '').replace(/[$,%\s]/g, ''),
    fixed_frequency: l.share_type === 'fixed' ? (l.fixed_frequency ?? 'weekly') : undefined,
    last4: l.last4?.trim() || undefined,
  }))
  return call<number>(s, 'child_payment_plan_save', { p_child_id: childId, p_from: from, p_lines: clean, p_note: note?.trim() || null })
}
export const copyPayersToSibling = (s: SupabaseClient, fromChild: string, toChild: string, from: string) =>
  call<number>(s, 'child_payment_plan_copy', { p_from_child: fromChild, p_to_child: toChild, p_from: from })

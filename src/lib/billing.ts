// Self-contained on purpose (type-only imports, no path aliases) so scripts/billing/billing.test.mjs can load it with plain node.
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Run Billing: weekly or monthly billing runs on top of Tuition. The database (20270111000000_billing_runs.sql) works
 * out every amount and decides what can change; this file calls its functions with the CALLER's Supabase client
 * (owner or admin of the center, Tuition on) and holds a few pure helpers for the screens.
 */

export type RunFrequency = 'weekly' | 'monthly'
export type ChargeStatus = 'open' | 'partial' | 'paid' | 'ach_scheduled' | 'ach_sent' | 'returned' | 'void'
export type ChargeMethod = 'ach' | 'credit_card' | 'check' | 'other' | 'unassigned'
export type PaymentMethod = 'credit_card' | 'check' | 'cash' | 'other'
export type BatchStatus = 'scheduled' | 'exported' | 'sent' | 'settled' | 'void'

export interface PreviewLine {
  child_tuition_id: string; fee_id: string; fee_name: string; frequency: string; period_start: string; period_end: string
  list: number | null; discount: number; net: number; discount_label: string | null
}
export interface PreviewCharge {
  payer_id: string | null; payer_name: string; payer_kind: string | null; method: ChargeMethod
  account_type?: string | null; last4?: string | null; card_brand?: string | null
  amount: number; ach_ready: boolean; problem: string | null
}
export interface PreviewChild {
  child_id: string; name: string; classroom: string | null; status: string; enrolled_on: string; withdrawn_on: string | null
  billable: boolean; list: number; discount: number; total: number
  lines: PreviewLine[]; charges: PreviewCharge[]
  skipped: { frequency: string; run_id: string; reason: string }[]; warnings: string[]
}
export interface PreviewTotals {
  children: number; billable: number; list: number; discount: number; total: number
  ach_total: number; ach_count: number; manual_total: number; unassigned_total: number
  by_frequency: { weekly: number; biweekly: number; monthly: number; one_time: number }
}
export interface BillingPreview {
  frequency: RunFrequency; period_start: string; period_end: string; label: string
  children: PreviewChild[]; totals: PreviewTotals
  today: string; is_owner: boolean; default_draft_date: string; center_bank: boolean
  runs: { id: string; status: 'submitted' | 'void'; total: number; child_count: number; submitted_at: string }[]
  credits?: Record<string, number>   // payer id → credit the run will use
}

export interface Payment {
  receipt_id?: string | null
  id: string; kind: 'payment' | 'ach' | 'ach_return' | 'credit'; amount: number; method: string; reference: string | null
  received_on: string; note: string | null; voided: boolean; void_reason: string | null; recorded_by: string; created_at: string
}
export interface Charge {
  id: string; bill_id: string; payer_id: string | null; payer_name: string; payer_kind: string | null; method: ChargeMethod
  account_type: string | null; last4: string | null; amount: number; paid: number; balance: number; status: ChargeStatus
  ach_batch_id: string | null; ach_return_code: string | null; note: string | null; payments: Payment[]
}
export interface BillLine {
  fee_name: string; frequency: string; period_start: string; period_end: string
  list: number | null; discount: number; net: number; discount_label: string | null
}
export interface AchBatch {
  id: string; status: BatchStatus; draft_date: string; file_stale: boolean; export_count: number
  exported_at: string | null; sent_at: string | null; settled_at: string | null; count: number; pending_total: number
}
export interface RunSummary {
  id: string; frequency: RunFrequency; period_start: string; period_end: string; label: string; draft_date: string | null
  status: 'submitted' | 'void'; child_count: number; list_total: number; discount_total: number; total: number
  ach_total: number; manual_total: number; credit_total?: number; note: string | null; paid: number; balance: number
  submitted_at: string; submitted_by: string; voided_at: string | null; voided_by: string | null; void_reason: string | null
  ach: AchBatch | null
}
export interface RunBill {
  id: string; child_id: string; child_name: string; classroom_name: string | null
  list: number; discount: number; total: number; paid: number; balance: number; voided: boolean
  lines: BillLine[]; charges: Charge[]
}
export interface RunDetail { run: RunSummary; is_owner: boolean; today: string; bills: RunBill[] }
export interface HistoryBill {
  id: string; run_id: string; frequency: RunFrequency; period_start: string; period_end: string; label: string
  list: number; discount: number; total: number; paid: number; balance: number; voided: boolean; billed_at: string
  lines: BillLine[]; charges: Charge[]
}
export interface ChildBillingHistory {
  year: number; today: string; years: number[]
  ytd: { bills: number; list: number; discount: number; total: number; paid: number; balance: number }
  balance_all: number
  bills: HistoryBill[]
}

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'check', label: 'Check' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit / debit card' },
  { value: 'other', label: 'Other' },
]

export const chargeMethodLabel = (m: string) =>
  ({ ach: 'ACH', credit_card: 'Card', debit_card: 'Debit card', check: 'Check', other: 'Other', unassigned: 'No payer', cash: 'Cash' } as Record<string, string>)[m] ?? m

export const CHARGE_STATUS: Record<ChargeStatus, { label: string; tone: string }> = {
  open: { label: 'Due', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  partial: { label: 'Partly paid', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  paid: { label: 'Paid', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  ach_scheduled: { label: 'ACH scheduled', tone: 'border-sky-200 bg-sky-50 text-sky-800' },
  ach_sent: { label: 'ACH sent', tone: 'border-sky-200 bg-sky-50 text-sky-800' },
  returned: { label: 'ACH returned', tone: 'border-red-200 bg-red-50 text-red-700' },
  void: { label: 'Void', tone: 'border-border bg-surface text-muted' },
}

export const BATCH_STATUS: Record<BatchStatus, string> = {
  scheduled: 'Ready to download',
  exported: 'File downloaded',
  sent: 'Sent to bank',
  settled: 'Cleared',
  void: 'Void',
}

/** "2026-11-16" → Date at local noon (no time-zone drift) */
function d(iso: string) { const [y, m, dd] = iso.split('-').map(Number); return new Date(y, m - 1, dd, 12) }
function iso(x: Date) { return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

/** The Monday of the week holding a day */
export function mondayOf(day: string): string {
  const x = d(day)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return iso(x)
}
export function addDays(day: string, n: number): string { const x = d(day); x.setDate(x.getDate() + n); return iso(x) }
export function monthStart(day: string): string { return `${day.slice(0, 7)}-01` }
export function addMonths(day: string, n: number): string {
  const x = d(monthStart(day)); x.setMonth(x.getMonth() + n); return iso(x)
}
/** The window a run covers */
export function billingWindow(frequency: RunFrequency, day: string): { start: string; end: string } {
  if (frequency === 'weekly') { const start = mondayOf(day); return { start, end: addDays(start, 6) } }
  const start = monthStart(day)
  return { start, end: addDays(addMonths(start, 1), -1) }
}
/**
 * Child care is billed in advance (prepay), so a run opens on the next window: next week's Monday, or the 1st of
 * next month. Children starting any day in that window are billed in it.
 */
export function defaultWindowDay(frequency: RunFrequency, today: string): string {
  return frequency === 'weekly' ? addDays(mondayOf(today), 7) : addMonths(today, 1)
}

/** Sum of money values to the cent (no float drift) */
export function sumMoney(values: (number | string | null | undefined)[]): number {
  return values.reduce<number>((t, v) => t + Math.round(Number(v ?? 0) * 100), 0) / 100
}

/** A payment form before it goes to the database. Returns the problem, or null */
export function checkPayment(input: { amount: string; method: string; received_on: string }, balance: number, today: string): string | null {
  const t = (input.amount ?? '').replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) <= 0) return 'Enter the amount paid.'
  if (Math.round(Number(t) * 100) > Math.round(balance * 100)) return `That is more than the ${balance.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} still due.`
  if (!PAYMENT_METHODS.some(m => m.value === input.method)) return 'Pick how it was paid.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.received_on)) return 'Enter the date it was paid.'
  if (input.received_on > today) return 'The payment date can’t be in the future.'
  return null
}

// --- Database calls -------------------------------------------------------------------------------------------

type Failure = { success: false; error: string }
type Ok<T> = { success: true; data: T }

export function friendlyBillingError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return 'Something went wrong.'
  const msg = error.message?.replace(/^.*?ERROR:\s*/, '') ?? ''
  if (error.code === 'PGRST202') return 'Billing is not set up on this database yet.'
  if (error.code === '23505' && msg.includes('billing_bill_lines_once')) return 'Some of these fees were just billed by someone else. Review the run again.'
  return msg || 'Something went wrong.'
}

async function call<T>(s: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Ok<T> | Failure> {
  const { data, error } = await s.rpc(fn, args)
  if (error) return { success: false, error: friendlyBillingError(error) }
  return { success: true, data: data as T }
}

export const loadPreview = (s: SupabaseClient, centerId: string, frequency: RunFrequency, day: string) =>
  call<BillingPreview>(s, 'billing_preview', { p_center_id: centerId, p_frequency: frequency, p_day: day })

export const submitRun = (s: SupabaseClient, centerId: string, frequency: RunFrequency, day: string, expectedTotal: number, draftDate: string | null, note: string) =>
  call<string>(s, 'billing_run_submit', {
    p_center_id: centerId, p_frequency: frequency, p_day: day, p_expected_total: expectedTotal,
    p_draft_date: draftDate || null, p_note: note.trim() || null,
  })

export const loadRuns = (s: SupabaseClient, centerId: string) => call<RunSummary[]>(s, 'billing_runs_list', { p_center_id: centerId, p_limit: 52 })
export const loadRun = (s: SupabaseClient, runId: string) => call<RunDetail>(s, 'billing_run_get', { p_run_id: runId })
export const loadChildHistory = (s: SupabaseClient, childId: string, year: number | null) =>
  call<ChildBillingHistory>(s, 'billing_child_history', { p_child_id: childId, p_year: year })

export const recordPayment = (s: SupabaseClient, chargeId: string, p: { amount: string; method: string; reference: string; received_on: string; note: string }) =>
  call<string>(s, 'billing_payment_record', {
    p_charge_id: chargeId,
    p: { amount: p.amount.replace(/[$,\s]/g, ''), method: p.method, reference: p.reference.trim() || null, received_on: p.received_on, note: p.note.trim() || null },
  })
export const voidPayment = (s: SupabaseClient, paymentId: string, reason: string) =>
  call<null>(s, 'billing_payment_void', { p_payment_id: paymentId, p_reason: reason })
export const markBatch = (s: SupabaseClient, batchId: string, status: 'sent' | 'settled') =>
  call<null>(s, 'billing_ach_batch_mark', { p_batch_id: batchId, p_status: status })
export const returnAch = (s: SupabaseClient, chargeId: string, code: string, note: string) =>
  call<null>(s, 'billing_charge_ach_return', { p_charge_id: chargeId, p_code: code, p_note: note.trim() || null })
export const voidRun = (s: SupabaseClient, runId: string, reason: string) =>
  call<null>(s, 'billing_run_void', { p_run_id: runId, p_reason: reason })

// --- Payment card (take a payment on the child's file) -----------------------------------------------------------

export type ReceiptMethod = 'credit_card' | 'debit_card' | 'check' | 'cash' | 'other'
export const RECEIPT_METHODS: { value: ReceiptMethod; label: string }[] = [
  { value: 'credit_card', label: 'Credit card' },
  { value: 'debit_card', label: 'Debit card' },
  { value: 'check', label: 'Check' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
]
export const CARD_BRANDS = ['Visa', 'Mastercard', 'Amex', 'Discover', 'Other']
export const receiptMethodLabel = (m: string) => RECEIPT_METHODS.find(x => x.value === m)?.label ?? chargeMethodLabel(m)

export interface AccountCharge { id: string; label: string; period_start: string; amount: number; paid: number; balance: number; status: ChargeStatus }
export interface AccountPayer {
  payer_id: string; payer_name: string; method: string; last4: string | null; card_brand: string | null; active: boolean
  due: number; credit: number; charges: AccountCharge[]
}
export interface Receipt {
  id: string; payer_name: string; amount: number; method: ReceiptMethod; card_brand: string | null; last4: string | null
  reference: string | null; received_on: string; note: string | null; applied: number; credit_left: number
  voided: boolean; void_reason: string | null; recorded_by: string; created_at: string
}
export interface ChildAccount {
  today: string; payers: AccountPayer[]; total_due: number; total_credit: number; unassigned_due: number; receipts: Receipt[]
}
export interface ReceiptInput {
  payer_id: string; amount: string; method: ReceiptMethod; card_brand: string; last4: string; reference: string; received_on: string; note: string
}

const cents = (v: number | string) => Math.round(Number(v) * 100)
const parseAmount = (t: string) => (t ?? '').replace(/[$,\s]/g, '')

/**
 * What a payment of `amount` would do for one payer, the way the database applies it: the oldest due first
 * (drafts already sent to the bank are skipped), a partial amount leaves the rest due, anything over is credit.
 */
export function planPayment(amount: number, charges: AccountCharge[]): { applied: number; credit: number; stillDue: number; paidCharges: number } {
  let left = cents(amount), applied = 0, n = 0, due = 0
  for (const c of charges) {
    if (c.status === 'ach_sent' || c.status === 'void') continue
    const bal = cents(c.balance)
    due += bal
    if (left <= 0 || bal <= 0) continue
    const part = Math.min(left, bal)
    left -= part; applied += part; n += 1
  }
  return { applied: applied / 100, credit: left / 100, stillDue: (due - applied) / 100, paidCharges: n }
}

/** A payment form before it goes to the database. Returns the problem, or null */
export function checkReceipt(r: ReceiptInput, today: string): string | null {
  if (!r.payer_id) return 'Pick who is paying.'
  const t = parseAmount(r.amount)
  if (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) <= 0) return 'Enter the amount paid.'
  if (Number(t) > 100000) return 'That amount is too large for one payment.'
  if (!RECEIPT_METHODS.some(m => m.value === r.method)) return 'Pick how it was paid.'
  if ((r.method === 'credit_card' || r.method === 'debit_card') && r.last4 && !/^\d{4}$/.test(r.last4)) return 'Enter only the last 4 digits of the card.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.received_on)) return 'Enter the date it was paid.'
  if (r.received_on > today) return 'The payment date can’t be in the future.'
  return null
}

export const loadChildAccount = (s: SupabaseClient, childId: string) => call<ChildAccount>(s, 'billing_child_account', { p_child_id: childId })
export const receivePayment = (s: SupabaseClient, childId: string, r: ReceiptInput) => {
  const card = r.method === 'credit_card' || r.method === 'debit_card'
  return call<{ receipt_id: string; applied: number; credit: number; charges: number; credit_total: number }>(s, 'billing_receive_payment', {
    p_child_id: childId,
    p: {
      payer_id: r.payer_id, amount: parseAmount(r.amount), method: r.method,
      card_brand: card ? r.card_brand || null : null, last4: card ? r.last4 || null : null,
      reference: r.reference.trim() || null, received_on: r.received_on, note: r.note.trim() || null,
    },
  })
}
export const voidReceipt = (s: SupabaseClient, receiptId: string, reason: string) =>
  call<null>(s, 'billing_receipt_void', { p_receipt_id: receiptId, p_reason: reason })

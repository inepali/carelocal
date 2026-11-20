/**
 * The parent page's Billing tab: what parent_billing_summary / _bills / _bill return
 * (20270122000000_parent_billing.sql), and the plain words each charge's status is shown with.
 * Only the parent's own charges and payments are ever here; bank details are last 4 only.
 */

export type ChargeStatus = 'open' | 'partial' | 'paid' | 'ach_scheduled' | 'ach_sent' | 'returned' | 'void'

export interface ParentCharge {
  id: string
  status: ChargeStatus
  method: 'ach' | 'credit_card' | 'check' | 'other' | 'unassigned'
  amount: number
  paid: number
  due: number
  account_type: 'checking' | 'savings' | null
  last4: string | null
  return_code: string | null
  draft_date: string | null
  sent_at: string | null
  settled_at: string | null
}

export interface ParentBill {
  bill_id: string
  child: string
  frequency: 'weekly' | 'monthly'
  period_start: string
  period_end: string
  bill_total: number
  share: number
  paid: number
  due: number
  charges: ParentCharge[]
}

export interface ParentBillDetail extends Omit<ParentBill, 'share' | 'paid' | 'due' | 'charges'> {
  list_amount: number
  discount_amount: number
  lines: { fee: string; frequency: string; list: number | null; discount: number; net: number; discount_label: string | null }[]
  charges: (ParentCharge & { payments: { date: string; kind: 'payment' | 'ach' | 'ach_return' | 'credit'; method: string; amount: number }[] })[]
}

export interface ParentPayment {
  kind: 'receipt' | 'ach' | 'ach_return'
  date: string
  method: string
  card_brand?: string | null
  last4: string | null
  account_type?: 'checking' | 'savings' | null
  amount: number
  credit_left?: number
  return_code?: string | null
  child: string
}

export interface ParentPayMethod {
  child: string
  method: 'ach' | 'credit_card' | 'check' | 'other'
  bank_name: string | null
  account_type: 'checking' | 'savings' | null
  last4: string | null
  card_brand: string | null
  share_type: 'percent' | 'fixed' | 'remainder'
  share_value: number | null
  fixed_frequency: 'weekly' | 'biweekly' | 'monthly' | null
  authorization_signed_on: string | null
  ach_ready: boolean
}

export interface ParentBillingSummary {
  center: { name: string; phone: string | null; email: string | null; today: string }
  due: number
  credit: number
  ach_scheduled: { date: string; amount: number; last4: string | null; account_type: 'checking' | 'savings' | null }[]
  ach_sent: number
  ytd: { year: number; billed: number; paid: number; due: number }
  methods: ParentPayMethod[]
  payments: ParentPayment[]
}

/** Common ACH return reasons, in words a parent understands */
export const RETURN_REASONS: Record<string, string> = {
  R01: 'not enough funds',
  R02: 'the account is closed',
  R03: 'no account found',
  R04: 'the account number is not valid',
  R07: 'the authorization was revoked',
  R08: 'payment was stopped',
  R09: 'funds not available',
  R10: 'the bank says it wasn’t authorized',
  R16: 'the account is frozen',
  R20: 'the account can’t take this payment',
  R29: 'not authorized for this account',
}

const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
export const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)
export const account = (type: 'checking' | 'savings' | null | undefined, last4: string | null | undefined) =>
  last4 ? `${type === 'savings' ? 'Savings' : 'Checking'} ••${last4}` : 'your bank account'

export type Tone = 'good' | 'info' | 'due' | 'bad' | 'muted'

/** One charge's status as the parent sees it */
export function chargeStatus(c: ParentCharge): { label: string; tone: Tone } {
  switch (c.status) {
    case 'ach_scheduled':
      return { label: `ACH draft${c.draft_date ? ` ${shortDay(c.draft_date)}` : ''} from ${account(c.account_type, c.last4)}`, tone: 'info' }
    case 'ach_sent':
      return { label: `Sent to your bank${c.sent_at ? ` ${shortDay(c.sent_at)}` : ''} (${account(c.account_type, c.last4)})`, tone: 'info' }
    case 'paid':
      return { label: c.method === 'ach' ? `Paid by ACH (${account(c.account_type, c.last4)})` : 'Paid', tone: 'good' }
    case 'returned': {
      const why = c.return_code ? RETURN_REASONS[c.return_code] : null
      return { label: `Returned by your bank${c.return_code ? ` (${c.return_code}${why ? `: ${why}` : ''})` : ''}: ${usd(c.due)} due`, tone: 'bad' }
    }
    case 'partial':
      return { label: `${usd(c.due)} due · ${usd(c.paid)} paid`, tone: 'due' }
    case 'open':
      return { label: `${usd(c.due)} due: pay at the center`, tone: 'due' }
    default:
      return { label: 'Canceled', tone: 'muted' }
  }
}

/** A bill's overall status for this parent: the most urgent of their charges on it */
export function billStatus(b: Pick<ParentBill, 'charges'>): { label: string; tone: Tone } {
  const order: ChargeStatus[] = ['returned', 'open', 'partial', 'ach_scheduled', 'ach_sent', 'paid', 'void']
  const first = [...b.charges].sort((a, z) => order.indexOf(a.status) - order.indexOf(z.status))[0]
  return first ? chargeStatus(first) : { label: 'Canceled', tone: 'muted' }
}

/** "Week of Nov 24" or "November 2026" */
export function periodLabel(b: { frequency: 'weekly' | 'monthly'; period_start: string }) {
  const d = new Date(`${b.period_start}T12:00:00Z`)
  return b.frequency === 'monthly'
    ? d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })
    : `Week of ${d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}`
}

/** How a payer line splits the bill: "Pays 50%", "Pays $100 a week", "Pays the rest" */
export function shareLabel(m: Pick<ParentPayMethod, 'share_type' | 'share_value' | 'fixed_frequency'>) {
  if (m.share_type === 'percent') return `Pays ${Number(m.share_value)}%`
  if (m.share_type === 'fixed') {
    const per = m.fixed_frequency === 'monthly' ? 'a month' : m.fixed_frequency === 'biweekly' ? 'every 2 weeks' : 'a week'
    return `Pays ${usd(Number(m.share_value))} ${per}`
  }
  return 'Pays the rest'
}

/** A payment line in the Payments list */
export function paymentLabel(p: ParentPayment) {
  if (p.kind === 'ach') return `ACH draft (${account(p.account_type, p.last4)})`
  if (p.kind === 'ach_return') return `ACH returned${p.return_code ? ` (${p.return_code})` : ''}`
  switch (p.method) {
    case 'credit_card': return `Credit card${p.card_brand ? ` ${p.card_brand}` : ''}${p.last4 ? ` ••${p.last4}` : ''}`
    case 'debit_card': return `Debit card${p.card_brand ? ` ${p.card_brand}` : ''}${p.last4 ? ` ••${p.last4}` : ''}`
    case 'check': return 'Check'
    case 'cash': return 'Cash'
    case 'credit': return 'Credit from the center'
    default: return 'Payment'
  }
}

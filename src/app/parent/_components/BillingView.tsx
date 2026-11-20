import Link from 'next/link'
import { CalendarClock, ChevronDown, ChevronUp, Landmark, Phone, Receipt, Wallet } from 'lucide-react'
import { loadPortalBill, loadPortalBills } from '@/lib/server/parent-portal'
import {
  account, billStatus, chargeStatus, paymentLabel, periodLabel, shareLabel, usd,
  type ParentBillingSummary, type Tone,
} from '@/lib/parent-billing'

/**
 * The Billing tab on the parent page: what this parent owes and has paid, for the whole family. Only their own share
 * of each bill, their own payments and credit; bank details are last 4 only (the database enforces all of it).
 *   ?tab=billing&bill=<id>  open one bill   ?before=YYYY-MM-DD  older bills
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
const draftDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })

const TONE: Record<Tone, string> = {
  good: 'bg-brand-50 text-brand-700 border-brand-100',
  info: 'bg-sky-50 text-sky-800 border-sky-100',
  due: 'bg-amber-50 text-amber-900 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200',
  muted: 'bg-surface text-muted border-border',
}

function link(childId: string, extra: Record<string, string | null>) {
  const q = new URLSearchParams({ child: childId, tab: 'billing' })
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v)
  return `/parent?${q.toString()}`
}

export async function BillingView({ tokenHash, childId, summary, billId, before }: {
  tokenHash: string; childId: string; summary: ParentBillingSummary; billId: string | null; before: string | null
}) {
  const open = billId && UUID.test(billId) ? billId : null
  const older = before && DAY.test(before) ? before : null
  const [bills, detail] = await Promise.all([
    loadPortalBills(tokenHash, older),
    open ? loadPortalBill(tokenHash, open) : Promise.resolve(null),
  ])
  const s = summary
  const oldest = bills.length ? bills[bills.length - 1].period_start : null

  return (
    <div className="space-y-4">
      {/* What's owed and what's coming */}
      <section className="rounded-2xl border border-border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Due now</p>
            <p className={`text-2xl font-bold ${s.due > 0 ? 'text-amber-800' : 'text-text-main'}`}>{usd(s.due)}</p>
            {s.due > 0 && <p className="text-xs text-text-muted">Pay at the center</p>}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Credit</p>
            <p className="text-2xl font-bold text-text-main">{usd(s.credit)}</p>
            {s.credit > 0 && <p className="text-xs text-text-muted">Used by your next bill</p>}
          </div>
        </div>
        {(s.ach_scheduled.length > 0 || s.ach_sent > 0) && (
          <ul className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
            {s.ach_scheduled.map((d, i) => (
              <li key={i} className="flex items-start gap-2">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <span><b>{usd(d.amount)}</b> ACH draft on {draftDay(d.date)} from {account(d.account_type, d.last4)}</span>
              </li>
            ))}
            {s.ach_sent > 0 && (
              <li className="flex items-start gap-2">
                <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <span><b>{usd(s.ach_sent)}</b> sent to your bank, on its way</span>
              </li>
            )}
          </ul>
        )}
      </section>

      {/* Bills */}
      <section className="rounded-2xl border border-border bg-white shadow-sm">
        <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-bold"><Receipt className="h-4 w-4 text-brand-600" /> Bills</h2>
        {bills.length === 0 ? (
          <p className="p-4 text-sm text-text-muted">{older ? 'No older bills.' : 'No bills yet. You’ll get an email when the center bills you.'}</p>
        ) : (
          <ul className="divide-y divide-border">
            {bills.map(b => {
              const st = billStatus(b)
              const split = Math.abs(Number(b.bill_total) - Number(b.share)) >= 0.01
              const isOpen = open === b.bill_id
              return (
                <li key={b.bill_id}>
                  <Link href={link(childId, { bill: isOpen ? null : b.bill_id, before: older })} scroll={false} aria-expanded={isOpen}
                    className="flex items-start justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-text-main">{periodLabel(b)} · {b.child}</span>
                      <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-xs ${TONE[st.tone]}`}>{st.label}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-bold">{usd(b.share)}</span>
                      {split && <span className="block text-xs text-text-muted">your share of {usd(b.bill_total)}</span>}
                      {isOpen ? <ChevronUp className="ml-auto h-4 w-4 text-muted" /> : <ChevronDown className="ml-auto h-4 w-4 text-muted" />}
                    </span>
                  </Link>
                  {isOpen && (
                    detail ? (
                      <div className="space-y-3 bg-surface/60 px-4 pb-4 pt-1 text-sm">
                        <p className="text-xs text-text-muted">{shortDate(detail.period_start)} – {shortDate(detail.period_end)}</p>
                        <table className="w-full text-sm">
                          <tbody>
                            {detail.lines.map((l, i) => (
                              <tr key={i} className="align-top">
                                <td className="py-1 pr-2">
                                  {l.fee}
                                  {Number(l.discount) > 0 && <span className="block text-xs text-text-muted">{l.discount_label || 'Discount'}: −{usd(l.discount)}</span>}
                                </td>
                                <td className="py-1 text-right">{usd(l.net)}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-border font-semibold">
                              <td className="py-1.5">Bill total</td>
                              <td className="py-1.5 text-right">{usd(detail.bill_total)}</td>
                            </tr>
                            {split && (
                              <tr className="font-semibold">
                                <td className="py-1">Your share</td>
                                <td className="py-1 text-right">{usd(b.share)}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                        {detail.charges.map(c => (
                          <div key={c.id} className="rounded-xl border border-border bg-white p-3">
                            <p className={`inline-block rounded-full border px-2 py-0.5 text-xs ${TONE[chargeStatus(c).tone]}`}>{chargeStatus(c).label}</p>
                            {c.payments.length > 0 && (
                              <ul className="mt-2 space-y-1 text-xs text-text-muted">
                                {c.payments.map((p, i) => (
                                  <li key={i} className="flex justify-between gap-2">
                                    <span>{shortDate(p.date)} · {p.kind === 'credit' ? 'From your credit' : p.kind === 'ach' ? 'ACH draft' : p.kind === 'ach_return' ? 'ACH returned' : 'Payment'}</span>
                                    <span>{usd(p.amount)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : <p className="px-4 pb-4 text-sm text-text-muted">This bill isn’t available.</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {(older || bills.length >= 20) && (
          <div className="flex justify-between border-t border-border px-4 py-3 text-sm font-semibold text-brand-600">
            {older ? <Link href={link(childId, {})}>Newest bills</Link> : <span />}
            {bills.length >= 20 && oldest && <Link href={link(childId, { before: oldest })}>Older bills</Link>}
          </div>
        )}
      </section>

      {/* Payments */}
      <section className="rounded-2xl border border-border bg-white shadow-sm">
        <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-bold"><Wallet className="h-4 w-4 text-brand-600" /> Payments</h2>
        {s.payments.length === 0 ? <p className="p-4 text-sm text-text-muted">No payments in the last 12 months.</p> : (
          <ul className="divide-y divide-border">
            {s.payments.map((p, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <span className="block font-semibold text-text-main">{paymentLabel(p)}</span>
                  <span className="text-xs text-text-muted">{shortDate(p.date)} · {p.child}{p.credit_left && p.credit_left > 0 ? ` · ${usd(p.credit_left)} credit left` : ''}</span>
                </span>
                <span className={`shrink-0 font-bold ${p.kind === 'ach_return' ? 'text-red-700' : ''}`}>{usd(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-3 gap-2 border-t border-border px-4 py-3 text-center text-xs">
          <div><p className="text-muted">Billed in {s.ytd.year}</p><p className="font-bold">{usd(s.ytd.billed)}</p></div>
          <div><p className="text-muted">Paid</p><p className="font-bold">{usd(s.ytd.paid)}</p></div>
          <div><p className="text-muted">Due</p><p className="font-bold">{usd(s.ytd.due)}</p></div>
        </div>
      </section>

      {/* How they pay */}
      {s.methods.length > 0 && (
        <section className="rounded-2xl border border-border bg-white shadow-sm">
          <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-bold"><Landmark className="h-4 w-4 text-brand-600" /> How you pay</h2>
          <ul className="divide-y divide-border">
            {s.methods.map((m, i) => (
              <li key={i} className="px-4 py-3 text-sm">
                <span className="block font-semibold text-text-main">{m.child} · {shareLabel(m)}</span>
                <span className="text-xs text-text-muted">
                  {m.method === 'ach'
                    ? `ACH from ${m.bank_name ? `${m.bank_name} ` : ''}${account(m.account_type, m.last4)}${m.ach_ready
                        ? (m.authorization_signed_on ? ` · authorization signed ${shortDate(m.authorization_signed_on)}` : '')
                        : ' · not set up yet, pay at the center for now'}`
                    : m.method === 'credit_card' ? `Card${m.card_brand ? ` ${m.card_brand}` : ''}${m.last4 ? ` ••${m.last4}` : ''}, at the center`
                    : m.method === 'check' ? 'Check, cash or card at the center' : 'Other, at the center'}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-4 py-3 text-xs text-text-muted">To change your bank account or how you pay, please contact {s.center.name}.</p>
        </section>
      )}

      {s.center.phone && (
        <p className="text-center text-xs text-text-muted">
          Questions about a bill? <a href={`tel:${s.center.phone}`} className="inline-flex items-center gap-1 font-semibold text-brand-600"><Phone className="h-3 w-3" /> Call {s.center.name}</a>
        </p>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgePercent, CreditCard, Loader2, Undo2, Wallet, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/compliance'
import { money, type Period } from '@/lib/tuition'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'
import {
  CARD_BRANDS, RECEIPT_METHODS, addAdjustment, addDays, addMonths, billingWindow, checkReceipt, defaultWindowDay, giveCredit,
  loadChildAccount, planPayment, receiptMethodLabel, receivePayment, voidAdjustment, voidReceipt,
  type AccountPayer, type ChildAccount, type ReceiptInput, type RunFrequency,
} from '@/lib/billing'
import { BTN, BTN_PRIMARY, BTN_QUIET, FLD, LBL, Modal } from './ui'

const PER: Record<string, string> = { weekly: 'week', biweekly: '2 weeks', monthly: 'month' }
/** What can be paid here now (an ACH draft already at the bank isn't) */
const payableNow = (p: AccountPayer) => planPayment(1e9, p.charges).applied

/**
 * Fee & Payment → Payment: what each payer owes and has in credit, and "Take payment" for a parent paying at the
 * center. Any amount: a partial payment leaves the rest due; more than due is kept as credit that the next billing
 * run uses. Card payments are recorded only for now (run on the center's terminal); a card processor comes later.
 */
export function PaymentCard({ childId, childName, periods }: { childId: string; childName: string; periods: Period[] }) {
  const [acct, setAcct] = useState<ChildAccount | null>(null)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState<string | null>(null)   // payer id the dialog opens on
  const [adjusting, setAdjusting] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    const res = await loadChildAccount(createClient(), childId)
    if (!res.success) { setError(res.error); return }
    setError('')
    setAcct(res.data)
  }, [childId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function removeDiscount(id: string, amount: number, label: string) {
    if (!await showConfirm(`Remove the ${money(amount)} one-time discount for the ${label}?`, { title: 'Remove discount', confirmLabel: 'Remove', tone: 'danger' })) return
    const res = await voidAdjustment(createClient(), id)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  async function undo(id: string, amount: number, payer: string) {
    const reason = await showPrompt(`Void ${payer}'s ${money(amount)} payment? Anything it paid is due again and any credit it left is removed. Give a reason.`, '', { title: 'Void payment', tone: 'danger', confirmLabel: 'Void payment' })
    if (reason == null) return
    if (!reason.trim()) { showAlert('Give a reason for voiding the payment.'); return }
    const res = await voidReceipt(createClient(), id, reason)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  if (error) return <section className="rounded-2xl border border-border bg-white p-5 text-sm text-muted shadow-sm">{error}</section>
  if (!acct) return <section className="flex items-center justify-center rounded-2xl border border-border bg-white p-5 shadow-sm"><Loader2 className="h-5 w-5 animate-spin text-brand-600" /></section>

  const receipts = showAll ? acct.receipts : acct.receipts.slice(0, 4)
  const canPay = acct.payers.length > 0

  return (
    <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-heading">Payment</h3>
        <div className="flex gap-1.5">
          <button className={BTN_QUIET} disabled={!canPay} title={canPay ? 'One-time discount or credit' : 'Add who pays first (Payers below)'} onClick={() => setAdjusting(true)}>
            <BadgePercent className="h-3.5 w-3.5" /> Adjust
          </button>
          <button className={BTN} disabled={!canPay} title={canPay ? undefined : 'Add who pays first (Payers below)'}
            onClick={() => setPaying((acct.payers.find(p => p.active && p.due > 0) ?? acct.payers.find(p => p.active) ?? acct.payers[0]).payer_id)}>
            <CreditCard className="h-3.5 w-3.5" /> Take payment
          </button>
        </div>
      </div>

      {acct.payers.length === 0 ? (
        <p className="text-sm text-muted">Set who pays for {childName} first, then payments can be taken here.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {acct.payers.map(p => (
            <li key={p.payer_id} className="flex items-center justify-between gap-3">
              <button className="min-w-0 text-left hover:underline" onClick={() => setPaying(p.payer_id)}>
                <span className="text-text-main">{p.payer_name}</span>
                {!p.active && <span className="text-xs text-muted"> (past payer)</span>}
              </button>
              <span className="flex shrink-0 items-center gap-3">
                {p.credit > 0 && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">{money(p.credit)} credit</span>}
                <span className={`font-semibold ${p.due > 0 ? 'text-heading' : 'text-muted'}`}>{p.due > 0 ? `${money(p.due)} due` : 'Nothing due'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex justify-between border-t border-border pt-3 text-base">
        <span className="font-bold text-heading">Balance due</span>
        <span className="font-black text-heading">{money(acct.total_due + acct.unassigned_due)}</span>
      </div>
      {acct.total_credit > 0 && <p className="mt-1 text-right text-xs text-emerald-700">{money(acct.total_credit)} credit is used by the next bill</p>}
      {acct.adjustments.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-900">
          {acct.adjustments.map(a => (
            <li key={a.id} className="flex items-baseline justify-between gap-2">
              <span>One-time discount · {a.label}: {a.reason}{a.payer_name ? ` (${a.payer_name})` : ''}</span>
              <span className="flex items-center gap-1.5 font-semibold">
                −{money(a.amount)}
                <button className="text-emerald-700 hover:text-red-700" title="Remove" onClick={() => removeDiscount(a.id, a.amount, a.label)}><X className="h-3 w-3" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {acct.unassigned_due > 0 && <p className="mt-1 text-xs text-amber-700">{money(acct.unassigned_due)} was billed with no payer set. Collect it from the Billing history tab.</p>}

      {acct.receipts.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Recent payments</div>
          <ul className="space-y-1.5 text-xs">
            {receipts.map(r => (
              <li key={r.id} className={`flex flex-wrap items-baseline justify-between gap-x-3 ${r.voided ? 'text-muted line-through' : ''}`}>
                <span className="min-w-0">
                  {formatDate(r.received_on)} · {r.payer_name} · {receiptMethodLabel(r.method)}{r.method === 'credit' && r.note ? `: ${r.note}` : ''}
                  {r.card_brand ? ` ${r.card_brand}` : ''}{r.last4 ? ` ····${r.last4}` : ''}{r.reference ? ` #${r.reference}` : ''}
                  {!r.voided && r.credit_left > 0 && <span className="text-emerald-700 no-underline"> · {money(r.credit_left)} credit left</span>}
                  {r.voided && <span className="text-red-700"> · voided: {r.void_reason}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{money(r.amount)}</span>
                  {!r.voided && (
                    <button className="inline-flex items-center gap-0.5 text-muted hover:text-red-700" title="Void this payment" onClick={() => undo(r.id, r.amount, r.payer_name)}>
                      <Undo2 className="h-3 w-3" />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {acct.receipts.length > 4 && (
            <button className="mt-1.5 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show fewer' : `Show all ${acct.receipts.length}`}
            </button>
          )}
        </div>
      )}

      {adjusting && (
        <AdjustDialog acct={acct} periods={periods} childId={childId}
          onClose={() => setAdjusting(false)} onSaved={() => { setAdjusting(false); load() }} />
      )}
      {paying && (
        <TakePaymentDialog acct={acct} payerId={paying} periods={periods} childId={childId}
          onClose={() => setPaying(null)} onSaved={() => { setPaying(null); load() }} />
      )}
    </section>
  )
}

function TakePaymentDialog({ acct, payerId, periods, childId, onClose, onSaved }: {
  acct: ChildAccount; payerId: string; periods: Period[]; childId: string; onClose: () => void; onSaved: () => void
}) {
  const first = acct.payers.find(p => p.payer_id === payerId) ?? acct.payers[0]
  const [form, setForm] = useState<ReceiptInput>({
    payer_id: first.payer_id, amount: payableNow(first) > 0 ? payableNow(first).toFixed(2) : '', method: 'credit_card',
    card_brand: '', last4: '', reference: '', received_on: acct.today, note: '',
  })
  const [saving, setSaving] = useState(false)
  const payer: AccountPayer = acct.payers.find(p => p.payer_id === form.payer_id) ?? first
  const set = <K extends keyof ReceiptInput>(k: K, v: ReceiptInput[K]) => setForm(f => ({ ...f, [k]: v }))
  const card = form.method === 'credit_card' || form.method === 'debit_card'

  // This payer's share of the current week / month, for "pay ahead" buttons
  const shares = useMemo(() => periods
    .map(p => ({ per: PER[p.frequency] ?? p.frequency, amount: Number(p.payers.find(x => x.payer_id === form.payer_id)?.amount ?? 0) }))
    .filter(s => s.amount > 0), [periods, form.payer_id])

  const amountNum = Number(form.amount.replace(/[$,\s]/g, ''))
  const plan = Number.isFinite(amountNum) && amountNum > 0 ? planPayment(amountNum, payer.charges) : null

  function pickPayer(id: string) {
    const p = acct.payers.find(x => x.payer_id === id)
    setForm(f => ({ ...f, payer_id: id, amount: p && payableNow(p) > 0 ? payableNow(p).toFixed(2) : '' }))
  }

  async function save() {
    const problem = checkReceipt(form, acct.today)
    if (problem) { showAlert(problem); return }
    setSaving(true)
    const res = await receivePayment(createClient(), childId, form)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    const d = res.data
    showAlert([
      `Recorded ${money(Number(d.applied) + Number(d.credit))} from ${payer.payer_name}.`,
      Number(d.applied) > 0 ? `${money(d.applied)} paid ${d.charges} ${d.charges === 1 ? 'bill' : 'bills'}.` : '',
      Number(d.credit) > 0 ? `${money(d.credit)} kept as credit for the next bill.` : '',
    ].filter(Boolean).join(' '), { title: 'Payment recorded' })
    onSaved()
  }

  const dueNow = payableNow(payer)
  const quick: { label: string; amount: number }[] = []
  if (dueNow > 0) quick.push({ label: `Amount due · ${money(dueNow)}`, amount: dueNow })
  for (const s of shares) {
    if (dueNow > 0) quick.push({ label: `Due + next ${s.per} · ${money(dueNow + s.amount)}`, amount: Math.round((dueNow + s.amount) * 100) / 100 })
    else quick.push({ label: `Next ${s.per} · ${money(s.amount)}`, amount: s.amount })
  }

  return (
    <Modal title="Take payment" onClose={onClose} footer={<>
      <button className={BTN_QUIET} onClick={onClose}>Cancel</button>
      <button className={BTN_PRIMARY} onClick={save} disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Record {plan ? money(amountNum) : ''} payment
      </button>
    </>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LBL}>Who is paying</label>
            <select className={FLD} value={form.payer_id} onChange={e => pickPayer(e.target.value)}>
              {acct.payers.map(p => <option key={p.payer_id} value={p.payer_id}>{p.payer_name}{p.due > 0 ? ` · ${money(p.due)} due` : ''}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">
              {payer.due > 0 ? `${money(payer.due)} due` : 'Nothing due right now'}{payer.due > dueNow ? ` (${money(payer.due - dueNow)} is an ACH draft at the bank)` : ''}{payer.credit > 0 ? ` · ${money(payer.credit)} credit` : ''}
            </p>
          </div>
          <div>
            <label className={LBL}>Amount</label>
            <input className={FLD} inputMode="decimal" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" autoFocus />
          </div>
        </div>

        {quick.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {quick.map(q => (
              <button key={q.label} type="button" onClick={() => set('amount', q.amount.toFixed(2))}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${Math.round(amountNum * 100) === Math.round(q.amount * 100) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-border bg-white text-text-main hover:bg-surface'}`}>
                {q.label}
              </button>
            ))}
          </div>
        )}

        {plan && (
          <div className={`rounded-xl border px-3 py-2 text-sm ${plan.credit > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : plan.stillDue > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-border bg-surface text-text-main'}`}>
            {plan.applied > 0 && <>Pays {money(plan.applied)} on {plan.paidCharges} {plan.paidCharges === 1 ? 'bill' : 'bills'}, oldest first. </>}
            {plan.stillDue > 0 && <>{money(plan.stillDue)} will still be due. </>}
            {plan.credit > 0 && <>{money(plan.credit)} is kept as credit and used by the next bill.</>}
          </div>
        )}

        <div>
          <span className={LBL}>Paid by</span>
          <div className="flex flex-wrap gap-1.5">
            {RECEIPT_METHODS.map(m => (
              <button key={m.value} type="button" onClick={() => set('method', m.value)}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold ${form.method === m.value ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-text-main hover:bg-surface'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {card && (
          <div className="space-y-3 rounded-xl border border-border p-3">
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-surface px-3 py-3 text-sm text-muted">
              <CreditCard className="h-5 w-5 shrink-0" />
              <span>Card tap and card entry arrive with the card processor. For now, run the card on your center&apos;s terminal and record it here.</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={LBL}>Card</label>
                <select className={FLD} value={form.card_brand} onChange={e => set('card_brand', e.target.value)}>
                  <option value="">—</option>
                  {CARD_BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>Last 4</label>
                <input className={FLD} inputMode="numeric" maxLength={4} value={form.last4} onChange={e => set('last4', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4242" />
              </div>
              <div>
                <label className={LBL}>Approval / receipt #</label>
                <input className={FLD} maxLength={60} value={form.reference} onChange={e => set('reference', e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted">Only the last 4 digits are kept, never the full card number.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {!card && (
            <div>
              <label className={LBL}>{form.method === 'check' ? 'Check number' : 'Reference'} <span className="font-normal text-muted">(optional)</span></label>
              <input className={FLD} maxLength={60} value={form.reference} onChange={e => set('reference', e.target.value)} />
            </div>
          )}
          <div>
            <label className={LBL}>Date paid</label>
            <input type="date" className={FLD} max={acct.today} value={form.received_on} onChange={e => set('received_on', e.target.value)} />
          </div>
          <div className={card ? '' : 'sm:col-span-2'}>
            <label className={LBL}>Note <span className="font-normal text-muted">(optional)</span></label>
            <input className={FLD} maxLength={300} value={form.note} onChange={e => set('note', e.target.value)} />
          </div>
        </div>

        {payer.charges.length > 0 && (
          <details className="text-xs text-muted">
            <summary className="flex cursor-pointer items-center gap-1"><Wallet className="h-3.5 w-3.5" /> {payer.charges.length} open {payer.charges.length === 1 ? 'bill' : 'bills'} for {payer.payer_name}</summary>
            <ul className="mt-1.5 space-y-0.5 pl-5">
              {payer.charges.map(c => (
                <li key={c.id} className="flex justify-between gap-3">
                  <span>{c.label[0].toUpperCase() + c.label.slice(1)}{c.status === 'ach_sent' ? ' (ACH draft at the bank)' : c.status === 'ach_scheduled' ? ' (ACH draft queued: paying here takes it out)' : ''}</span>
                  <span>{money(c.balance)} of {money(c.amount)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Modal>
  )
}

/**
 * One-time adjustments: a discount on a week / month that isn't billed yet (shows on that bill), or a credit to the
 * payer's account (comes off what's due now; the rest is used by the next bill).
 */
function AdjustDialog({ acct, periods, childId, onClose, onSaved }: {
  acct: ChildAccount; periods: Period[]; childId: string; onClose: () => void; onSaved: () => void
}) {
  const frequency: RunFrequency = periods.some(p => p.frequency === 'weekly') || !periods.some(p => p.frequency === 'monthly') ? 'weekly' : 'monthly'
  const unit = frequency === 'weekly' ? 'week' : 'month'
  const [kind, setKind] = useState<'discount' | 'credit'>('discount')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [day, setDay] = useState(() => defaultWindowDay(frequency, acct.today))
  const [payerId, setPayerId] = useState(kind === 'credit' ? acct.payers[0]?.payer_id ?? '' : '')
  const [saving, setSaving] = useState(false)
  const win = billingWindow(frequency, day)
  const step = (n: number) => setDay(frequency === 'weekly' ? addDays(win.start, 7 * n) : addMonths(day, n))
  const credit = kind === 'credit'
  const payer = acct.payers.find(p => p.payer_id === payerId)
  const amt = Number(amount.replace(/[$,\s]/g, ''))
  const plan = credit && payer && amt > 0 ? planPayment(amt, payer.charges) : null

  async function save() {
    if (!/^\d+(\.\d{1,2})?$/.test(amount.replace(/[$,\s]/g, '')) || amt <= 0) { showAlert('Enter the amount.'); return }
    if (!reason.trim()) { showAlert(credit ? 'Give a reason for the credit.' : 'Give a reason (it shows on the bill).'); return }
    if (credit && !payerId) { showAlert('Pick whose account gets the credit.'); return }
    setSaving(true)
    const supabase = createClient()
    const res = credit
      ? await giveCredit(supabase, childId, { payer_id: payerId, amount, reason, today: acct.today })
      : await addAdjustment(supabase, childId, { amount, reason, frequency, day: win.start, payer_id: payerId })
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    onSaved()
  }

  return (
    <Modal title="One-time adjustment" onClose={onClose} footer={<>
      <button className={BTN_QUIET} onClick={onClose}>Cancel</button>
      <button className={BTN_PRIMARY} onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} {credit ? 'Give credit' : 'Add discount'}</button>
    </>}>
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ['discount', 'Discount on a bill', `Comes off one ${unit}'s bill that isn't billed yet, e.g. a holiday closure next ${unit}.`],
            ['credit', 'Credit to account', 'For a week already billed: comes off what is due now, the rest is used by the next bill.'],
          ] as const).map(([k, title, desc]) => (
            <button key={k} type="button" onClick={() => { setKind(k); if (k === 'credit' && !payerId) setPayerId(acct.payers[0]?.payer_id ?? '') }}
              className={`rounded-xl border p-3 text-left ${kind === k ? 'border-brand-600 bg-brand-50' : 'border-border hover:bg-surface'}`}>
              <div className="text-sm font-bold text-heading">{title}</div>
              <div className="mt-0.5 text-xs text-muted">{desc}</div>
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LBL}>Amount</label>
            <input className={FLD} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus />
          </div>
          <div>
            <label className={LBL}>{credit ? 'Whose account' : 'Comes off'} </label>
            <select className={FLD} value={payerId} onChange={e => setPayerId(e.target.value)}>
              {!credit && <option value="">The payer of the rest (default)</option>}
              {acct.payers.map(p => <option key={p.payer_id} value={p.payer_id}>{p.payer_name}</option>)}
            </select>
          </div>
        </div>

        {!credit && (
          <div>
            <span className={LBL}>Which {unit}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button className={BTN_QUIET} onClick={() => step(-1)} aria-label="Previous">‹</button>
              <span className="min-w-52 rounded-xl border border-border px-3 py-2 text-center text-sm font-semibold text-text-main">
                {frequency === 'weekly' ? `${formatDate(win.start)} – ${formatDate(win.end)}` : new Date(`${win.start}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </span>
              <button className={BTN_QUIET} onClick={() => step(1)} aria-label="Next">›</button>
            </div>
            <p className="mt-1 text-xs text-muted">It shows on that {unit}&apos;s bill as a one-time discount. If that {unit} is already billed, use a credit instead.</p>
          </div>
        )}

        <div>
          <label className={LBL}>Reason</label>
          <input className={FLD} maxLength={120} value={reason} onChange={e => setReason(e.target.value)}
            placeholder={credit ? 'e.g. Snow day closure' : 'e.g. Thanksgiving closure'} />
        </div>

        {plan && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {plan.applied > 0 && <>Takes {money(plan.applied)} off what {payer?.payer_name} owes. </>}
            {plan.credit > 0 && <>{money(plan.credit)} is kept as credit for the next bill.</>}
          </div>
        )}
      </div>
    </Modal>
  )
}

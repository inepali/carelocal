'use client'

import { useState } from 'react'
import { Ban, Banknote, Loader2, RotateCcw, Undo2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/compliance'
import { money } from '@/lib/tuition'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'
import {
  CHARGE_STATUS, PAYMENT_METHODS, chargeMethodLabel, checkPayment, recordPayment, returnAch, voidPayment,
  type Charge, type ChargeStatus,
} from '@/lib/billing'
import { BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD, LBL, Modal, Pill } from '../../children/_components/ui'

export function ChargeStatusPill({ status }: { status: ChargeStatus }) {
  const s = CHARGE_STATUS[status] ?? CHARGE_STATUS.open
  return <Pill className={s.tone}>{s.label}</Pill>
}

/** "ACH · Checking ····4417" / "Card ····2222" / "Check" */
export function chargeMethodDetail(c: Pick<Charge, 'method' | 'account_type' | 'last4'>) {
  const parts = [chargeMethodLabel(c.method)]
  if (c.method === 'ach' && c.account_type) parts.push(c.account_type === 'savings' ? 'Savings' : 'Checking')
  if (c.last4) parts.push(`····${c.last4}`)
  return parts.join(' · ')
}

const paymentLabel = (kind: string, method: string) =>
  kind === 'ach' ? 'ACH draft cleared' : kind === 'ach_return' ? 'ACH returned' : kind === 'credit' ? `Paid from credit (${chargeMethodLabel(method)})` : chargeMethodLabel(method)

/** Record money received on one payer charge. `card`: Run Credit Card (card on file, the approval number as reference) */
export function RecordPaymentDialog({ charge, today, onClose, onSaved, card }: { charge: Charge; today: string; onClose: () => void; onSaved: () => void; card?: boolean }) {
  const [form, setForm] = useState({
    amount: charge.balance.toFixed(2),
    method: card || charge.method === 'credit_card' ? 'credit_card' : 'check',
    reference: '', received_on: today, note: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function save() {
    const problem = checkPayment(form, charge.balance, today)
    if (problem) { showAlert(problem); return }
    if (charge.status === 'ach_scheduled' && !await showConfirm(
      `${charge.payer_name} is set to be drafted by ACH. Recording this payment takes the draft out of the ACH batch.`,
      { title: 'Paid another way', confirmLabel: 'Record payment' })) return
    setSaving(true)
    const res = await recordPayment(createClient(), charge.id, form)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    onSaved()
  }

  return (
    <Modal title={card ? 'Record card charge' : 'Record payment'} onClose={onClose} footer={<>
      <button className={BTN_QUIET} onClick={onClose}>Cancel</button>
      <button className={BTN_PRIMARY} onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} {card ? 'Record charge' : 'Record payment'}</button>
    </>}>
      <p className="mb-4 text-sm text-muted">
        {charge.payer_name} · {money(charge.amount)} billed{charge.paid > 0 ? `, ${money(charge.paid)} paid` : ''} · <b className="text-text-main">{money(charge.balance)} due</b>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className={LBL}>Amount</label><input className={FLD} inputMode="decimal" value={form.amount} onChange={set('amount')} /></div>
        <div>
          <label className={LBL}>Paid by</label>
          <select className={FLD} value={form.method} onChange={set('method')}>
            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className={LBL}>{form.method === 'check' ? 'Check number' : form.method === 'credit_card' ? 'Approval number' : 'Reference'} <span className="font-normal text-muted">(optional)</span></label>
          <input className={FLD} maxLength={60} value={form.reference} onChange={set('reference')} placeholder={form.method === 'credit_card' ? 'From the terminal receipt' : ''} />
        </div>
        <div><label className={LBL}>Date paid</label><input type="date" className={FLD} max={today} value={form.received_on} onChange={set('received_on')} /></div>
        <div className="sm:col-span-2"><label className={LBL}>Note <span className="font-normal text-muted">(optional)</span></label><input className={FLD} maxLength={300} value={form.note} onChange={set('note')} /></div>
      </div>
    </Modal>
  )
}

/**
 * The payer charges of one bill: what each payer owes, what came in, and the actions (record a payment, mark an ACH
 * draft returned, void a payment entered by mistake).
 */
export function ChargeList({ charges, today, onChanged, readOnly }: { charges: Charge[]; today: string; onChanged: () => void; readOnly?: boolean }) {
  const [paying, setPaying] = useState<Charge | null>(null)

  async function markReturned(c: Charge) {
    const code = await showPrompt(`The bank's return code for ${c.payer_name}'s draft of ${money(c.amount)} (R01 = insufficient funds, R02 = account closed, R03 = no account…)`, 'R01', { title: 'ACH draft returned' })
    if (code == null) return
    const res = await returnAch(createClient(), c.id, code, '')
    if (!res.success) { showAlert(res.error); return }
    onChanged()
  }
  async function undoPayment(paymentId: string, amount: number) {
    const reason = await showPrompt(`Void this ${money(amount)} payment? Give a reason (it stays in the history as voided).`, '', { title: 'Void payment', tone: 'danger', confirmLabel: 'Void payment' })
    if (reason == null) return
    if (!reason.trim()) { showAlert('Give a reason for voiding the payment.'); return }
    const res = await voidPayment(createClient(), paymentId, reason)
    if (!res.success) { showAlert(res.error); return }
    onChanged()
  }

  if (!charges.length) return <p className="text-sm text-muted">Nothing to collect.</p>

  return (
    <div className="divide-y divide-border rounded-xl border border-border">
      {charges.map(c => {
        const canPay = !readOnly && c.balance > 0 && c.status !== 'ach_sent' && c.status !== 'void'
        // A sent draft, or a cleared one whose ACH money hasn't already been reversed
        const achNet = c.payments.filter(p => !p.voided && (p.kind === 'ach' || p.kind === 'ach_return')).reduce((t, p) => t + Math.round(p.amount * 100), 0)
        const canReturn = !readOnly && (c.status === 'ach_sent' || achNet > 0)
        return (
          <div key={c.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-48 flex-1">
                <div className="text-sm font-semibold text-text-main">{c.payer_name}</div>
                <div className="text-xs text-muted">{chargeMethodDetail(c)}{c.ach_return_code ? ` · returned ${c.ach_return_code}` : ''}</div>
              </div>
              <div className="w-24 text-right text-sm"><div className="text-xs text-muted">Billed</div>{money(c.amount)}</div>
              <div className="w-24 text-right text-sm"><div className="text-xs text-muted">Paid</div>{money(c.paid)}</div>
              <div className="w-24 text-right text-sm font-semibold"><div className="text-xs font-normal text-muted">Due</div>{money(c.balance)}</div>
              <div className="w-28"><ChargeStatusPill status={c.status} /></div>
              <div className="flex gap-1.5">
                {canPay && <button className={BTN_QUIET_SM} onClick={() => setPaying(c)}><Banknote className="h-3.5 w-3.5" /> Record payment</button>}
                {canReturn && <button className={BTN_QUIET_SM} onClick={() => markReturned(c)}><RotateCcw className="h-3.5 w-3.5" /> Returned</button>}
              </div>
            </div>
            {c.note && <p className="mt-1.5 text-xs text-amber-700">{c.note}</p>}
            {c.payments.length > 0 && (
              <ul className="mt-2 space-y-1 border-l-2 border-border pl-3">
                {c.payments.map(p => (
                  <li key={p.id} className={`flex flex-wrap items-center gap-x-3 text-xs ${p.voided ? 'text-muted line-through' : 'text-text-main'}`}>
                    <span className="w-24">{formatDate(p.received_on)}</span>
                    <span className="w-20 text-right font-semibold">{money(p.amount)}</span>
                    <span>{paymentLabel(p.kind, p.method)}{p.reference ? ` #${p.reference}` : ''}</span>
                    {p.note && <span className="text-muted">{p.note}</span>}
                    <span className="text-muted">by {p.recorded_by}</span>
                    {p.voided && <span className="no-underline text-red-700">voided: {p.void_reason}</span>}
                    {p.receipt_id && !p.voided && <span className="text-muted">· from the Payment card</span>}
                    {!readOnly && !p.voided && p.kind === 'payment' && !p.receipt_id && (
                      <button className="inline-flex items-center gap-1 text-muted hover:text-red-700" onClick={() => undoPayment(p.id, p.amount)} title="Void this payment">
                        <Undo2 className="h-3 w-3" /> Void
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      {paying && <RecordPaymentDialog charge={paying} today={today} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); onChanged() }} />}
    </div>
  )
}

export function VoidBadge() {
  return <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-muted"><Ban className="h-3 w-3" /> Voided</span>
}

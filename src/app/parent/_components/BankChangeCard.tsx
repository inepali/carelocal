'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import { parentCancelBankChange, parentRequestBankChange } from '@/app/actions/parent-billing.actions'
import { account, bankChangeLabel, bankChangeStatus, checkRouting, type BankChangeKind, type ParentBankChanges, type Tone } from '@/lib/parent-billing'

/**
 * Billing → How you pay → Request a change. The parent picks which children, types the new account (or asks to stop
 * ACH) and their PIN. The center prints an authorization form for them to sign before anything changes.
 */

const TONE: Record<Tone, string> = {
  good: 'bg-brand-50 text-brand-700 border-brand-100',
  info: 'bg-sky-50 text-sky-800 border-sky-100',
  due: 'bg-amber-50 text-amber-900 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200',
  muted: 'bg-surface text-muted border-border',
}
const input = 'w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:opacity-60'
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function BankChangeCard({ data, centerName }: { data: ParentBankChanges; centerName: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<BankChangeKind>('new_account')
  const [picked, setPicked] = useState<string[]>(() => data.lines.map(l => l.payer_id))
  const [f, setF] = useState({ holder: '', bank: '', routing: '', account: '', confirm: '', type: 'checking' as 'checking' | 'savings', pin: '' })
  const [error, setError] = useState<{ text: string; field?: string } | null>(null)
  const [sent, setSent] = useState(false)

  const openReq = data.requests.find(r => r.status === 'pending')
  const recent = data.requests.filter(r => r.status !== 'pending').slice(0, 3)
  const lines = kind === 'stop_ach' ? data.lines.filter(l => l.method === 'ach') : data.lines
  const chosen = picked.filter(id => lines.some(l => l.payer_id === id))
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(v => ({ ...v, [k]: e.target.value }))
  const err = (field: string) => error?.field === field ? 'border-red-400' : ''

  function submit() {
    setError(null)
    if (chosen.length === 0) return setError({ text: 'Choose which children this is for.', field: 'children' })
    if (kind === 'new_account') {
      if (!f.holder.trim()) return setError({ text: 'Enter the name on the account.', field: 'holder' })
      if (!checkRouting(f.routing.replace(/\D/g, ''))) return setError({ text: 'That routing number isn’t valid. It’s the 9-digit number at the bottom left of a check.', field: 'routing' })
      if (!/^\d{4,17}$/.test(f.account.replace(/[\s-]/g, ''))) return setError({ text: 'The account number is 4 to 17 digits.', field: 'account' })
      if (f.account.replace(/[\s-]/g, '') !== f.confirm.replace(/[\s-]/g, '')) return setError({ text: 'The two account numbers don’t match.', field: 'accountConfirm' })
    }
    if (!/^\d{6}$/.test(f.pin)) return setError({ text: 'Enter your 6-digit PIN to confirm.', field: 'pin' })
    start(async () => {
      const res = await parentRequestBankChange({
        kind, payerIds: chosen, holderName: f.holder, bankName: f.bank, routing: f.routing, account: f.account, accountConfirm: f.confirm,
        accountType: f.type, pin: f.pin,
      })
      if (!res.ok) { setError({ text: res.error, field: res.field }); if (res.field === 'pin') setF(v => ({ ...v, pin: '' })); return }
      setF({ holder: '', bank: '', routing: '', account: '', confirm: '', type: 'checking', pin: '' })
      setOpen(false); setSent(true)
      router.refresh()
    })
  }

  function cancel(id: string) {
    start(async () => {
      await parentCancelBankChange(id)
      setSent(false)
      router.refresh()
    })
  }

  return (
    <div className="border-t border-border px-4 py-3">
      {openReq ? (
        <div className="space-y-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-text-main">{bankChangeLabel(openReq)}</p>
              <p className="text-xs text-text-muted">For {openReq.children.map(c => c.name).join(', ')} · sent {shortDate(openReq.created_at)}</p>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE.due}`}>Waiting for the center</span>
          </div>
          <p className="text-xs text-text-muted">
            {openReq.kind === 'new_account'
              ? `${centerName} will ask you to sign an authorization form. Your drafts stay on your current account until they switch it.`
              : `${centerName} will confirm. Drafts already scheduled may still go out.`}
          </p>
          <button type="button" onClick={() => cancel(openReq.id)} disabled={pending} className="text-xs font-semibold text-red-700 disabled:opacity-50">Cancel this request</button>
        </div>
      ) : !open ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-muted">{sent ? 'Request sent. We emailed you a copy.' : 'New bank account, or want to stop ACH drafts?'}</p>
          {data.lines.length > 0 && (
            <button type="button" onClick={() => { setOpen(true); setError(null) }} className="shrink-0 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">Request a change</button>
          )}
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); submit() }} className="space-y-3 text-sm" autoComplete="off">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Request a change</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-surface"><X className="h-4 w-4" /></button>
          </div>

          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {(['new_account', 'stop_ach'] as const).map(k => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                disabled={k === 'stop_ach' && !data.lines.some(l => l.method === 'ach')}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-40 ${kind === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-border text-text-main'}`}>
                {k === 'new_account' ? 'New bank account' : 'Stop ACH drafts'}
              </button>
            ))}
          </div>

          <fieldset className={`space-y-1 rounded-xl border p-2 ${error?.field === 'children' ? 'border-red-400' : 'border-border'}`}>
            <legend className="px-1 text-xs font-semibold text-muted">For</legend>
            {lines.map(l => (
              <label key={l.payer_id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={picked.includes(l.payer_id)} onChange={e => setPicked(p => e.target.checked ? [...p, l.payer_id] : p.filter(x => x !== l.payer_id))} />
                <span>{l.child}</span>
                <span className="text-xs text-text-muted">· now {l.method === 'ach' ? account(l.account_type, l.last4) : l.method === 'credit_card' ? 'card' : 'at the center'}</span>
              </label>
            ))}
          </fieldset>

          {kind === 'new_account' && (
            <div className="grid grid-cols-2 gap-2">
              <input className={`${input} col-span-2 ${err('holder')}`} placeholder="Name on the account" value={f.holder} onChange={set('holder')} maxLength={120} />
              <input className={input} placeholder="Bank (optional)" value={f.bank} onChange={set('bank')} maxLength={80} />
              <select className={input} value={f.type} onChange={set('type')}>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
              </select>
              <input className={`${input} col-span-2 font-mono ${err('routing')}`} placeholder="Routing number (9 digits)" inputMode="numeric" value={f.routing} onChange={set('routing')} maxLength={11} />
              <input className={`${input} font-mono ${err('account')}`} placeholder="Account number" inputMode="numeric" value={f.account} onChange={set('account')} maxLength={20} autoComplete="off" />
              <input className={`${input} font-mono ${err('accountConfirm')}`} placeholder="Account number again" inputMode="numeric" value={f.confirm} onChange={set('confirm')} maxLength={20} autoComplete="off" onPaste={e => e.preventDefault()} />
            </div>
          )}

          <p className="text-xs text-text-muted">
            {kind === 'new_account'
              ? `Nothing changes yet. ${centerName} will give you an authorization form to sign, then switch your drafts. Drafts already scheduled stay on your current account.`
              : `${centerName} will confirm, then stop drafting your account. Drafts already scheduled may still go out.`}
          </p>

          <div>
            <label htmlFor="bank-change-pin" className="mb-1 block text-xs font-semibold text-muted">Your PIN, to confirm</label>
            <input id="bank-change-pin" className={`${input} font-mono tracking-[0.3em] ${err('pin')}`} type="password" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} value={f.pin} onChange={e => setF(v => ({ ...v, pin: e.target.value.replace(/\D/g, '') }))} />
          </div>

          {error && <p role="alert" className="text-sm font-medium text-red-600">{error.text}</p>}
          <button type="submit" disabled={pending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Send request
          </button>
        </form>
      )}

      {recent.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-2">
          {recent.map(r => {
            const st = bankChangeStatus(r)
            return (
              <li key={r.id} className="flex items-start justify-between gap-2 text-xs">
                <span className="text-text-muted">{bankChangeLabel(r)} · {shortDate(r.created_at)}{r.status === 'declined' && r.decision_note ? ` · “${r.decision_note}”` : ''}</span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 font-semibold ${TONE[st.tone]}`}>{st.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

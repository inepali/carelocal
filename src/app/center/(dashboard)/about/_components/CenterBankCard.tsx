'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2, Eye, EyeOff, History, Loader2, Lock, Pencil, ShieldCheck, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { abaValid, friendlyTuitionError } from '@/lib/tuition'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'
import { revealCenterBankAccount, saveCenterBankAccount, type CenterBankInput } from '@/app/actions/center-bank.actions'
import { useCenterContext } from '../../context'
import { BTN_PRIMARY, BTN_QUIET, FLD, LBL, Modal } from '../../children/_components/ui'

interface Account {
  id: string; account_holder_name: string; account_holder_type: 'business' | 'individual'; bank_name: string
  account_type: 'checking' | 'savings'; routing_number: string; last4: string; created_at: string; created_by: string
}
interface BankData {
  is_owner: boolean
  current: Account | null
  history: { id: string; account_holder_name: string; bank_name: string; account_type: string; routing_number: string; last4: string; status: 'replaced' | 'removed'; created_at: string; ended_at: string; end_note: string | null }[]
  events: { action: 'added' | 'replaced' | 'removed' | 'viewed'; at: string; who: string; summary: string | null }[]
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const EMPTY: CenterBankInput = { account_holder_name: '', account_holder_type: 'business', bank_name: '', account_type: 'checking', routing_number: '', account_number: '', account_number_confirm: '', note: '' }
const ACTION_LABEL = { added: 'Added', replaced: 'Replaced', removed: 'Removed', viewed: 'Viewed' } as const

/**
 * Center Profile → Bank account: where the center's payments are deposited (ACH tuition, once it is connected).
 * Owners and admins see it with the account number masked; only the owner adds, replaces or removes it and can view the
 * full number. Every change and view is logged below.
 */
export default function CenterBankCard() {
  const { centerId, role } = useCenterContext()
  const allowed = role === 'owner' || role === 'admin'
  const [data, setData] = useState<BankData | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<CenterBankInput | null>(null)
  const [confirmOwn, setConfirmOwn] = useState(false)
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [full, setFull] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [showLog, setShowLog] = useState(false)

  const load = useCallback(async () => {
    if (!centerId) return
    const { data: d, error: e } = await createClient().rpc('center_bank_get', { p_center_id: centerId })
    if (e) { setError(friendlyTuitionError(e)); return }
    setError('')
    setData(d as BankData)
  }, [centerId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (allowed) load() }, [allowed, load])
  useEffect(() => {
    if (!full) return
    const t = setTimeout(() => setFull(null), 30_000)
    return () => clearTimeout(t)
  }, [full])

  if (!allowed || !centerId) return null

  const replacing = !!data?.current
  const digits = (s: string) => s.replace(/[\s-]/g, '')
  const routingBad = (form?.routing_number.length ?? 0) === 9 && !abaValid(form?.routing_number)
  const typed = digits(form?.account_number ?? '')
  const confirm = digits(form?.account_number_confirm ?? '')

  async function save() {
    if (!form || !centerId) return
    if (!confirmOwn) { showAlert('Confirm that this account belongs to the center or its owner.'); return }
    setSaving(true)
    const res = await saveCenterBankAccount(centerId, form)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    setForm(null); setFull(null)
    load()
  }

  async function remove() {
    if (!centerId || !data?.current) return
    const note = await showPrompt(`Remove ${data.current.bank_name} ····${data.current.last4}? No account will be on file to receive payments. Why?`, '', { title: 'Remove bank account', tone: 'danger' })
    if (note == null) return
    const { error: e } = await createClient().rpc('center_bank_remove', { p_center_id: centerId, p_note: note })
    if (e) { showAlert(friendlyTuitionError(e)); return }
    setFull(null)
    load()
  }

  async function reveal() {
    if (!centerId) return
    if (!await showConfirm('Show the full account number? This is recorded in the bank account log.', { title: 'Show account number', confirmLabel: 'Show' })) return
    setRevealing(true)
    const res = await revealCenterBankAccount(centerId)
    setRevealing(false)
    if (!res.success) { showAlert(res.error); return }
    setFull(res.account_number)
    load()
  }

  const set = <K extends keyof CenterBankInput>(k: K, v: CenterBankInput[K]) => setForm(f => (f ? { ...f, [k]: v } : f))
  const cur = data?.current

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/50 p-5">
        <div className="flex items-center gap-3">
          <Building2 className="h-5 w-5 text-brand-600" />
          <h2 className="text-base font-semibold text-text-main">Bank account for payments</h2>
        </div>
        {data?.is_owner && (
          <div className="flex gap-2">
            {cur && <button onClick={remove} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-bold text-muted hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /> Remove</button>}
            <button onClick={() => { setForm({ ...EMPTY, account_holder_name: cur?.account_holder_name ?? '', account_holder_type: cur?.account_holder_type ?? 'business' }); setConfirmOwn(false); setShow(false) }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800">
              <Pencil className="h-3.5 w-3.5" /> {cur ? 'Replace account' : 'Add account'}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-5 p-6">
        <p className="text-sm text-muted">
          Where your center&apos;s payments are deposited, such as tuition collected by ACH once payments are connected. The account
          number is encrypted before it is saved.
        </p>

        {error ? <p className="text-sm text-red-700">{error}</p> : !data ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
        ) : cur ? (
          <div className="rounded-2xl border border-border p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-heading">{cur.bank_name}</div>
                <div className="text-sm text-text-main">{cur.account_holder_name} <span className="text-muted">· {cur.account_holder_type === 'business' ? 'Business' : 'Personal'} {cur.account_type}</span></div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-xs text-brand-600"><ShieldCheck className="h-3.5 w-3.5" /> On file</span>
            </div>
            <dl className="mt-4 grid gap-3 font-mono text-sm sm:grid-cols-2">
              <div><dt className="font-sans text-xs text-muted">Routing number</dt><dd className="text-heading">{cur.routing_number}</dd></div>
              <div>
                <dt className="font-sans text-xs text-muted">Account number</dt>
                <dd className="flex items-center gap-2 text-heading">
                  {full ?? `····${cur.last4}`}
                  {data.is_owner && (
                    <button onClick={full ? () => setFull(null) : reveal} disabled={revealing} className="font-sans text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50">
                      {revealing ? 'Opening…' : full ? 'Hide' : 'Show'}
                    </button>
                  )}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted">Added {when(cur.created_at)} by {cur.created_by}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
            <Lock className="mx-auto mb-2 h-6 w-6 text-brand-200" />
            No bank account on file.{data.is_owner ? ' Add the account payments should be deposited to.' : ' The center’s owner can add it.'}
          </div>
        )}

        {data && !data.is_owner && <p className="flex items-center gap-1.5 text-xs text-muted"><Lock className="h-3.5 w-3.5" /> Only the center&apos;s owner can change this account or see the full number.</p>}

        {data && (data.events.length > 0 || data.history.length > 0) && (
          <div>
            <button onClick={() => setShowLog(v => !v)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
              <History className="h-4 w-4" /> {showLog ? 'Hide' : 'Show'} history and access log
            </button>
            {showLog && (
              <div className="mt-3 grid gap-5 md:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Earlier accounts</h3>
                  {data.history.length === 0 ? <p className="text-sm text-muted">None.</p> : (
                    <ul className="space-y-2 text-sm">
                      {data.history.map(h => (
                        <li key={h.id}>
                          <span className="font-semibold text-heading">{h.bank_name} ····{h.last4}</span>{' '}
                          <span className="text-muted">· {h.status === 'replaced' ? 'replaced' : 'removed'} {when(h.ended_at)}{h.end_note ? ` · ${h.end_note}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Access log</h3>
                  <ul className="space-y-2 text-sm">
                    {data.events.map((e, i) => (
                      <li key={i}>
                        <span className="font-semibold text-heading">{ACTION_LABEL[e.action]}</span>{' '}
                        <span className="text-muted">· {when(e.at)} · {e.who}{e.summary && e.action !== 'viewed' ? ` · ${e.summary}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {form && (
        <Modal wide title={replacing ? 'Replace bank account' : 'Add bank account'} onClose={() => setForm(null)} footer={
          <>
            <button onClick={() => setForm(null)} className={BTN_QUIET}>Cancel</button>
            <button onClick={save} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save account</button>
          </>
        }>
          <div className="space-y-4">
            {replacing && cur && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Payments will go to the new account instead of {cur.bank_name} ····{cur.last4}. The old account stays in the history.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="cb-holder" className={LBL}>Name on the account *</label>
                <input id="cb-holder" value={form.account_holder_name} onChange={e => set('account_holder_name', e.target.value)} maxLength={120} className={FLD} placeholder="Legal business name, e.g. Acme Kids LLC" autoFocus />
              </div>
              <div>
                <label htmlFor="cb-htype" className={LBL}>Account holder</label>
                <select id="cb-htype" value={form.account_holder_type} onChange={e => set('account_holder_type', e.target.value as CenterBankInput['account_holder_type'])} className={FLD}>
                  <option value="business">Business</option><option value="individual">Individual (sole owner)</option>
                </select>
              </div>
              <div>
                <label htmlFor="cb-type" className={LBL}>Account type *</label>
                <select id="cb-type" value={form.account_type} onChange={e => set('account_type', e.target.value as CenterBankInput['account_type'])} className={FLD}>
                  <option value="checking">Checking</option><option value="savings">Savings</option>
                </select>
              </div>
              <div>
                <label htmlFor="cb-bank" className={LBL}>Bank name *</label>
                <input id="cb-bank" value={form.bank_name} onChange={e => set('bank_name', e.target.value)} maxLength={80} className={FLD} placeholder="Truist" />
              </div>
              <div>
                <label htmlFor="cb-routing" className={LBL}>Routing number *</label>
                <input id="cb-routing" value={form.routing_number} onChange={e => set('routing_number', e.target.value.replace(/\D/g, '').slice(0, 9))} inputMode="numeric" autoComplete="off" maxLength={9} className={`${FLD} font-mono`} placeholder="9 digits" />
                <p className={`mt-1 text-[11px] ${routingBad ? 'text-red-600' : 'text-subtle'}`}>{routingBad ? 'This isn’t a valid routing number. Check the 9 digits.' : 'Bottom left of a check.'}</p>
              </div>
              <div>
                <label htmlFor="cb-acct" className={LBL}>Account number *</label>
                <div className="relative">
                  <input id="cb-acct" type={show ? 'text' : 'password'} value={form.account_number} onChange={e => set('account_number', e.target.value.replace(/[^\d\s-]/g, '').slice(0, 21))}
                    inputMode="numeric" autoComplete="off" data-1p-ignore data-lpignore="true" className={`${FLD} pr-10 font-mono`} placeholder="4 to 17 digits" />
                  <button type="button" onClick={() => setShow(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-surface" aria-label={show ? 'Hide account number' : 'Show account number'}>
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="cb-acct2" className={LBL}>Confirm account number *</label>
                <input id="cb-acct2" type={show ? 'text' : 'password'} value={form.account_number_confirm} onChange={e => set('account_number_confirm', e.target.value.replace(/[^\d\s-]/g, '').slice(0, 21))}
                  onPaste={e => e.preventDefault()} inputMode="numeric" autoComplete="off" data-1p-ignore data-lpignore="true" className={`${FLD} font-mono`} placeholder="Type it again" />
                {confirm.length > 0 && typed.length > 0 && (
                  <p className={`mt-1 text-[11px] ${confirm === typed ? 'text-emerald-700' : 'text-red-600'}`}>{confirm === typed ? 'Numbers match.' : 'Numbers don’t match yet.'}</p>
                )}
              </div>
              {replacing && (
                <div className="sm:col-span-2">
                  <label htmlFor="cb-note" className={LBL}>Reason for the change</label>
                  <input id="cb-note" value={form.note ?? ''} onChange={e => set('note', e.target.value)} maxLength={200} className={FLD} placeholder="Moved banks, new business account…" />
                </div>
              )}
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-surface p-3 text-sm text-text-main">
              <input type="checkbox" checked={confirmOwn} onChange={e => setConfirmOwn(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
              <span>This account belongs to the center&apos;s business or its owner, and I&apos;m authorized to receive the center&apos;s payments into it.</span>
            </label>
            <p className="flex items-start gap-1.5 text-[11px] text-subtle"><Lock className="mt-0.5 h-3 w-3 shrink-0" /> The account number is encrypted before it is saved. Afterwards only the last 4 digits show; the owner can view it in full, and every view and change is logged.</p>
          </div>
        </Modal>
      )}
    </div>
  )
}

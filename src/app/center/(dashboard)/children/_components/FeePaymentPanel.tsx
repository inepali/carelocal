'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Copy, CreditCard, Eye, EyeOff, FileCheck2, History, Building2, Loader2, Lock, Pencil, Plus, Receipt, Trash2, Users } from 'lucide-react'
import type { Child } from '@/lib/child-types'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/compliance'
import { showAlert, showConfirm } from '@/lib/dialog'
import {
  PAY_METHODS, PAYER_KINDS, addChildFee, changeChildFee, checkPayers, copyPayersToSibling, discountInputOf, discountLabel,
  endChildFee, frequencyLabel, frequencyPer, loadChildTuition, methodDetail, money, nextFirstOfMonth, nextMonday, payerToInput,
  abaValid, previewSplit, shareLabel,
  type ChildFee, type ChildTuition, type DiscountInput, type PayerInput, type PayerRow, type Period,
} from '@/lib/tuition'
import { BTN, BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD, LBL, Modal, Pill } from './ui'
import { DiscountFields, NO_DISCOUNT, optionLabel } from './TuitionFields'
import { revealBankAccount, saveChildPayers } from '@/app/actions/tuition-bank.actions'

const PERIOD_TITLE: Record<string, string> = { weekly: 'This week', biweekly: 'These two weeks', monthly: 'This month' }
const range = (a: string, b: string) => (a === b ? formatDate(a) : `${formatDate(a)} – ${formatDate(b)}`)

type FeeDialog =
  | { mode: 'add'; fee_id: string; start: string; discount: DiscountInput }
  | { mode: 'change'; fee: ChildFee; from: string; discount: DiscountInput; note: string }
  | { mode: 'end'; fee: ChildFee; end: string; note: string }

/**
 * A child's fees from the rate card, what the current week / month costs, and who pays it how. Owners and admins
 * only, with Tuition on. Prices come from the dated rate card; changes keep the old terms for earlier days.
 */
export function FeePaymentPanel({ child }: { child: Child }) {
  const [data, setData] = useState<ChildTuition | null>(null)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<FeeDialog | null>(null)
  const [payersOpen, setPayersOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await loadChildTuition(createClient(), child.id)
    if (!res.success) { setError(res.error); return }
    setError('')
    setData(res.data)
  }, [child.id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  if (error) return <div className="rounded-2xl border border-border bg-white p-8 text-center text-sm text-muted">{error}</div>
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>

  const withdrawn = data.child.status !== 'enrolled'
  const today = data.today
  const past = (d: string) => d < today

  async function saveFeeDialog() {
    if (!dialog || !data) return
    const supabase = createClient()
    let res
    if (dialog.mode === 'add') {
      if (!dialog.fee_id) { showAlert('Pick a fee.'); return }
      setSaving(true)
      res = await addChildFee(supabase, child.id, dialog.fee_id, dialog.start, dialog.discount)
    } else if (dialog.mode === 'change') {
      if (past(dialog.from) && !dialog.note.trim()) { showAlert('Give a reason for a change dated before today.'); return }
      setSaving(true)
      res = await changeChildFee(supabase, dialog.fee.id, dialog.from, dialog.discount, dialog.note)
    } else {
      if (past(dialog.end) && !dialog.note.trim()) { showAlert('Give a reason for ending a fee before today.'); return }
      setSaving(true)
      res = await endChildFee(supabase, dialog.fee.id, dialog.end, dialog.note)
    }
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    setDialog(null)
    load()
  }

  async function removeFee(f: { id: string; label: string }) {
    if (!await showConfirm(`Remove ${f.label} from ${child.first_name}? Use this for a fee added by mistake. To stop a fee, use End instead.`, { title: 'Remove fee', confirmLabel: 'Remove', tone: 'danger' })) return
    const res = await endChildFee(createClient(), f.id, null)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  async function copyTo(siblingId: string, name: string) {
    if (!await showConfirm(`Copy today's payers to ${name}, starting today? Parents are matched by email. Check fixed amounts afterwards: they copy unchanged.`, { title: 'Copy to sibling', confirmLabel: 'Copy' })) return
    const res = await copyPayersToSibling(createClient(), child.id, siblingId, today)
    showAlert(res.success ? `Copied ${res.data} ${res.data === 1 ? 'payer' : 'payers'} to ${name}.` : res.error)
  }

  const current = data.fees.filter(f => f.start <= today)
  const upcoming = data.fees.filter(f => f.start > today)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div className="max-w-2xl">
          <h2 className="text-lg font-bold text-heading">Fee &amp; Payment</h2>
          <p className="mt-1 text-sm text-muted">
            Fees come from your rate card (About → Manage Data → Tuition Fees). Each week or month uses the price in force on its
            first day. Changes keep the old terms for earlier days and are logged in Activity. Only the last 4 digits of an
            account or card are kept, never the full number.
          </p>
        </div>
        {!withdrawn && (
          <button className={BTN} disabled={data.options.length === 0}
            title={data.options.length === 0 ? 'Add fees to your rate card first' : undefined}
            onClick={() => setDialog({ mode: 'add', fee_id: data.options[0]?.id ?? '', start: today < data.child.enrolled_on ? data.child.enrolled_on : today, discount: NO_DISCOUNT })}>
            <Plus className="h-3.5 w-3.5" /> Add fee
          </button>
        )}
      </div>

      {withdrawn && (
        <div className="rounded-2xl border border-border bg-surface px-5 py-3 text-sm text-muted">
          {child.first_name} was withdrawn{data.child.withdrawn_on ? ` on ${formatDate(data.child.withdrawn_on)}` : ''}. Fees and payers ended that day; the history is below.
        </div>
      )}

      {/* What the current periods cost, and who pays */}
      {data.periods.length === 0 && current.length === 0 && upcoming.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center text-sm text-muted">
          <Receipt className="mx-auto mb-2 h-8 w-8 text-brand-200" />
          {data.options.length === 0
            ? 'Your rate card has no fees yet. Add them in About → Manage Data → Tuition Fees.'
            : `No fees on ${child.first_name} yet. Use Add fee to pick from your rate card.`}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.periods.map(p => <PeriodCard key={p.frequency} period={p} payers={data.payers} />)}
        </div>
      )}

      {(current.length > 0 || upcoming.length > 0) && (
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-base font-bold text-heading">Fees</h3>
          <ul className="divide-y divide-border">
            {[...current, ...upcoming].map(f => (
              <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-heading">{f.label}</span>
                    <Pill className="border-border bg-surface text-muted">{frequencyLabel(f.frequency)}</Pill>
                    {f.start > today && <Pill className="border-amber-200 bg-amber-50 text-amber-800">Starts {formatDate(f.start)}</Pill>}
                  </div>
                  <p className="mt-0.5 text-sm text-text-main">{discountLabel(f) || 'List price'}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    From {formatDate(f.start)}{f.end ? ` to ${formatDate(f.end)}` : ''}
                    {f.upcoming_rate && <> · <span className="font-semibold text-amber-800">price {money(f.upcoming_rate.amount)} from {formatDate(f.upcoming_rate.charged_from ?? f.upcoming_rate.from)}</span></>}
                  </p>
                </div>
                {!withdrawn && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button className={BTN_QUIET_SM} onClick={() => setDialog({ mode: 'change', fee: f, from: f.start > today ? f.start : (f.frequency === 'monthly' ? nextFirstOfMonth(today) : nextMonday(today)), discount: discountInputOf(f), note: '' })}>
                      <Pencil className="h-3.5 w-3.5" /> Discount
                    </button>
                    {f.created_today || f.start > today
                      ? <button className={BTN_QUIET_SM} onClick={() => removeFee(f)}><Trash2 className="h-3.5 w-3.5" /> Remove</button>
                      : <button className={BTN_QUIET_SM} onClick={() => setDialog({ mode: 'end', fee: f, end: today, note: '' })}>End</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.one_time.length > 0 && (
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-base font-bold text-heading">One-time fees</h3>
          <ul className="divide-y divide-border text-sm">
            {data.one_time.map(o => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span><span className="font-semibold text-heading">{o.label}</span> <span className="text-muted">· {formatDate(o.on)}{o.discount !== 'list price' ? ` · ${o.discount}` : ''}</span></span>
                <span className="flex items-center gap-3">
                  <span className="font-bold text-heading">{money(o.net_amount)}</span>
                  {!withdrawn && (o.created_today || o.on > today) && (
                    <button className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600" onClick={() => removeFee(o)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Who pays */}
      <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-bold text-heading"><Users className="h-4 w-4 text-brand-600" /> Who pays</h3>
          {!withdrawn && (
            <div className="flex flex-wrap gap-2">
              {data.siblings.length > 0 && data.payers.length > 0 && data.siblings.map(s => (
                <button key={s.id} className={BTN_QUIET_SM} onClick={() => copyTo(s.id, s.first_name)}><Copy className="h-3.5 w-3.5" /> Copy to {s.first_name}</button>
              ))}
              <button className={BTN} onClick={() => setPayersOpen(true)}><CreditCard className="h-3.5 w-3.5" /> {data.payers.length ? 'Change payers' : 'Set payers'}</button>
            </div>
          )}
        </div>
        {data.payers.length === 0 ? (
          <p className="text-sm text-muted">No payment instructions on file{withdrawn ? '' : ` for ${child.first_name}`}.</p>
        ) : (
          <ul className="space-y-2">{data.payers.map(p => <PayerItem key={p.id} p={p} files={data.files} />)}</ul>
        )}
        {data.upcoming_payers.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-900">From {formatDate(data.upcoming_payers[0].effective_from)}</p>
            <ul className="space-y-2">{data.upcoming_payers.map(p => <PayerItem key={p.id} p={p} files={data.files} />)}</ul>
          </div>
        )}
      </section>

      {/* History */}
      <section className="rounded-2xl border border-border bg-white shadow-sm">
        <button onClick={() => setShowHistory(v => !v)} className="flex w-full items-center gap-2 px-5 py-4 text-left text-base font-bold text-heading">
          {showHistory ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} <History className="h-4 w-4 text-muted" /> History
        </button>
        {showHistory && (
          <div className="grid gap-6 border-t border-border p-5 md:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Fees</h4>
              {data.history.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
                <ul className="space-y-2 text-sm">
                  {data.history.map(h => (
                    <li key={h.id}>
                      <span className="font-semibold text-heading">{h.label}</span>{' '}
                      <span className="text-muted">· {h.frequency === 'one_time' ? formatDate(h.start) : `${formatDate(h.start)} – ${h.end ? formatDate(h.end) : 'now'}`} · {h.terms}{h.first_amount != null ? ` · ${money(h.first_amount)} at start` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Earlier payers</h4>
              {data.payer_history.length === 0 ? <p className="text-sm text-muted">None.</p> : (
                <ul className="space-y-2 text-sm">
                  {data.payer_history.map((h, i) => (
                    <li key={i}>
                      <span className="font-semibold text-heading">{h.payer_name}</span>{' '}
                      <span className="text-muted">· {shareLabel(h)} · {methodDetail(h)} · {range(h.from, h.to ?? h.from)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted">Every change, with who made it, is also in the Activity tab.</p>
            </div>
          </div>
        )}
      </section>

      {dialog && (
        <Modal wide onClose={() => setDialog(null)}
          title={dialog.mode === 'add' ? 'Add fee' : dialog.mode === 'change' ? `Discount: ${dialog.fee.label}` : `End ${dialog.fee.label}`}
          footer={
            <>
              <button onClick={() => setDialog(null)} className={BTN_QUIET}>Cancel</button>
              <button onClick={saveFeeDialog} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
            </>
          }>
          {dialog.mode === 'add' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
                <div>
                  <label htmlFor="fp-fee" className={LBL}>Fee *</label>
                  <select id="fp-fee" value={dialog.fee_id} onChange={e => setDialog({ ...dialog, fee_id: e.target.value })} className={FLD}>
                    {data.options.map(o => (
                      <option key={o.id} value={o.id}>{o.program_id && o.program_id === data.child.program_id ? '★ ' : ''}{optionLabel(o)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="fp-start" className={LBL}>{data.options.find(o => o.id === dialog.fee_id)?.frequency === 'one_time' ? 'Charged on *' : 'Starts *'}</label>
                  <input id="fp-start" type="date" value={dialog.start} min={data.child.enrolled_on} onChange={e => setDialog({ ...dialog, start: e.target.value })} className={FLD} />
                </div>
              </div>
              <DiscountFields idPrefix="fp-add" value={dialog.discount} onChange={d => setDialog({ ...dialog, discount: d })} />
              <p className="text-xs text-muted">
                ★ = the program of {child.first_name}&apos;s home room. For a child who has been here a while, start the fee on the day it first applied so the history is right.
              </p>
            </div>
          )}
          {dialog.mode === 'change' && (
            <div className="space-y-4">
              <p className="text-sm text-muted">Now: <strong className="text-heading">{discountLabel(dialog.fee) || 'List price'}</strong>. The new terms apply from the date you pick; earlier days keep the old ones.</p>
              <DiscountFields idPrefix="fp-change" value={dialog.discount} onChange={d => setDialog({ ...dialog, discount: d })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="fp-from" className={LBL}>From *</label>
                  <input id="fp-from" type="date" value={dialog.from} min={dialog.fee.start} onChange={e => setDialog({ ...dialog, from: e.target.value })} className={FLD} />
                </div>
                <div>
                  <label htmlFor="fp-note" className={LBL}>Note{past(dialog.from) ? ' *' : ''}</label>
                  <input id="fp-note" value={dialog.note} onChange={e => setDialog({ ...dialog, note: e.target.value })} maxLength={200} className={FLD} />
                </div>
              </div>
              <PastHint show={past(dialog.from)} owner={data.is_owner} />
            </div>
          )}
          {dialog.mode === 'end' && (
            <div className="space-y-4">
              <p className="text-sm text-muted">The fee is charged through the last day you pick, then stops. It stays in the history.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="fp-end" className={LBL}>Last day *</label>
                  <input id="fp-end" type="date" value={dialog.end} min={dialog.fee.start} onChange={e => setDialog({ ...dialog, end: e.target.value })} className={FLD} />
                </div>
                <div>
                  <label htmlFor="fp-end-note" className={LBL}>Note{past(dialog.end) ? ' *' : ''}</label>
                  <input id="fp-end-note" value={dialog.note} onChange={e => setDialog({ ...dialog, note: e.target.value })} maxLength={200} className={FLD} placeholder="Moved to Preschool, schedule change…" />
                </div>
              </div>
              <PastHint show={past(dialog.end)} owner={data.is_owner} />
            </div>
          )}
        </Modal>
      )}

      {payersOpen && <PayersDialog data={data} onClose={() => setPayersOpen(false)} onSaved={() => { setPayersOpen(false); load() }} />}
    </div>
  )
}

function PastHint({ show, owner }: { show: boolean; owner: boolean }) {
  if (!show) return null
  return (
    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      {owner ? 'This date is in the past, so it changes what earlier periods cost. Give a reason; it goes in the Activity log.'
             : 'Only the center’s owner can make a change dated before today. Pick today or a later date.'}
    </p>
  )
}

function PeriodCard({ period: p, payers }: { period: Period; payers: PayerRow[] }) {
  const byId = new Map(payers.map(x => [x.id, x]))
  return (
    <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-heading">{PERIOD_TITLE[p.frequency] ?? frequencyLabel(p.frequency)}</h3>
        <span className="text-xs text-muted">{range(p.period_start, p.period_end)}</span>
      </div>
      <ul className="space-y-2 text-sm">
        {p.lines.map(l => (
          <li key={l.child_tuition_id}>
            <div className="flex justify-between gap-3">
              <span className="text-text-main">{l.fee_name}</span>
              <span className="font-semibold text-heading">{l.list_amount == null ? 'No price' : money(l.override_amount ?? l.list_amount)}</span>
            </div>
            {l.override_amount == null && Number(l.discount_amount) > 0 && (
              <div className="flex justify-between gap-3 pl-3 text-xs text-muted">
                <span>{discountLabel(l)}</span><span>−{money(l.discount_amount)}</span>
              </div>
            )}
            {l.override_amount != null && <div className="pl-3 text-xs text-muted">Locked-in price (list {money(l.list_amount)})</div>}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-between border-t border-border pt-3 text-base">
        <span className="font-bold text-heading">Total per {frequencyPer(p.frequency)}</span>
        <span className="font-black text-heading">{money(p.total)}</span>
      </div>
      {p.payers.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {p.payers.map(x => {
            const who = byId.get(x.payer_id)
            return (
              <li key={x.payer_id} className="flex justify-between gap-3">
                <span className="text-muted">{who?.payer_name ?? 'Payer'} <span className="text-xs">({who ? shareLabel(who) : ''}, {who ? methodDetail({ method: who.method }) : ''})</span></span>
                <span className="font-semibold text-text-main">{money(x.amount)}</span>
              </li>
            )
          })}
        </ul>
      )}
      {(Number(p.unassigned) > 0 || Number(p.over) > 0) && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {Number(p.unassigned) > 0
            ? `${money(p.unassigned)} of this ${frequencyPer(p.frequency)} isn’t covered by any payer. Change payers, or let one pay “the rest”.`
            : `Fixed amounts are ${money(p.over)} more than the total, so they were cut down. Check the payers.`}
        </p>
      )}
      {p.payers.length === 0 && Number(p.total) > 0 && <p className="mt-3 text-xs text-muted">No payers set.</p>}
    </section>
  )
}

function PayerItem({ p, files }: { p: PayerRow; files: { id: string; file_name: string }[] }) {
  const file = files.find(f => f.id === p.authorization_file_id)
  return (
    <li className="rounded-xl border border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-heading">
          {p.payer_name}{p.relationship ? <span className="font-normal text-muted"> ({p.relationship})</span> : p.payer_kind !== 'family' ? <span className="font-normal text-muted"> ({PAYER_KINDS.find(k => k.value === p.payer_kind)?.label})</span> : null}
        </span>
        <Pill className="border-brand-100 bg-brand-50 text-brand-600">{shareLabel(p)}</Pill>
      </div>
      <p className="mt-1 text-sm text-text-main">{methodDetail({ ...p, last4: p.method === 'ach' && p.has_account_number ? null : p.last4 })}{p.draft_day ? ` · ${p.draft_day}` : ''}</p>
      {p.method === 'ach' && (p.routing_number || p.has_account_number) && <BankNumbers p={p} />}
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
        {p.authorization_on_file
          ? <><FileCheck2 className="h-3.5 w-3.5 text-emerald-600" /> Authorization on file{p.authorization_signed_on ? `, signed ${formatDate(p.authorization_signed_on)}` : ''}{file ? ` · ${file.file_name}` : ''}</>
          : (p.method === 'ach' || p.method === 'credit_card') ? <span className="text-amber-800">No signed authorization on file</span> : null}
      </p>
    </li>
  )
}

const BLANK_PAYER: PayerInput = { share_type: 'remainder', method: 'ach', payer_kind: 'family', account_type: 'checking', fixed_frequency: 'weekly', authorization_on_file: false }

/** Set who pays from a date: one or more payer lines with a share and a method, previewed against today's totals */
function PayersDialog({ data, onClose, onSaved }: { data: ChildTuition; onClose: () => void; onSaved: () => void }) {
  const today = data.today
  const startFrom = data.upcoming_payers.length ? data.upcoming_payers : data.payers
  const [lines, setLines] = useState<PayerInput[]>(() =>
    startFrom.length ? startFrom.map(payerToInput)
      : [{ ...BLANK_PAYER, payer_guardian_id: data.guardians.find(g => g.is_primary)?.id ?? data.guardians[0]?.id ?? null }])
  const [from, setFrom] = useState(data.upcoming_payers[0]?.effective_from ?? today)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const problem = checkPayers(lines)
  const update = (i: number, patch: Partial<PayerInput>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const freqs = useMemo(() => data.periods.map(p => ({ frequency: p.frequency, total: Number(p.total) })), [data.periods])

  async function save() {
    if (problem) { showAlert(problem); return }
    if (from < today && !note.trim()) { showAlert('Give a reason for a change dated before today.'); return }
    setSaving(true)
    const res = await saveChildPayers(data.child.id, from, lines, note)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    onSaved()
  }

  return (
    <Modal wide title="Who pays" onClose={onClose} footer={
      <>
        <button onClick={onClose} className={BTN_QUIET}>Cancel</button>
        <button onClick={save} disabled={saving || (from < today && !data.is_owner)} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save payers</button>
      </>
    }>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Fixed amounts come off first, then percentages of what is left, then one payer can pay &ldquo;the rest&rdquo;.
          Two parents 50/50: two lines of 50%. Subsidy plus co-pay: the subsidy as a fixed amount, the parent as &ldquo;the rest&rdquo;.
        </p>

        {lines.map((l, i) => {
          const g = data.guardians.find(x => x.id === l.payer_guardian_id)
          return (
            <div key={i} className="rounded-2xl border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-bold text-heading">Payer {i + 1}</span>
                {lines.length > 1 && <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="text-xs font-semibold text-muted hover:text-red-600">Remove</button>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`py-who-${i}`} className={LBL}>Who *</label>
                  <select id={`py-who-${i}`} value={l.payer_guardian_id ?? ''} className={FLD}
                    onChange={e => update(i, e.target.value ? { payer_guardian_id: e.target.value, payer_kind: 'family' } : { payer_guardian_id: null, payer_name: l.payer_name ?? '', payer_kind: 'subsidy' })}>
                    {data.guardians.map(x => <option key={x.id} value={x.id}>{x.name}{x.relationship ? ` (${x.relationship})` : ''}</option>)}
                    <option value="">Someone else (subsidy, employer…)</option>
                  </select>
                </div>
                {!l.payer_guardian_id ? (
                  <div className="grid grid-cols-[1fr_9rem] gap-2">
                    <div>
                      <label htmlFor={`py-name-${i}`} className={LBL}>Name *</label>
                      <input id={`py-name-${i}`} value={l.payer_name ?? ''} onChange={e => update(i, { payer_name: e.target.value })} maxLength={120} className={FLD} placeholder="NC DCDEE subsidy" />
                    </div>
                    <div>
                      <label htmlFor={`py-kind-${i}`} className={LBL}>Kind</label>
                      <select id={`py-kind-${i}`} value={l.payer_kind ?? 'other'} onChange={e => update(i, { payer_kind: e.target.value as PayerInput['payer_kind'] })} className={FLD}>
                        {PAYER_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                      </select>
                    </div>
                  </div>
                ) : <div className="self-end pb-2.5 text-xs text-muted">{g?.email ?? 'No email on file'}</div>}

                <div>
                  <label htmlFor={`py-share-${i}`} className={LBL}>Pays *</label>
                  <select id={`py-share-${i}`} value={l.share_type} onChange={e => update(i, { share_type: e.target.value as PayerInput['share_type'], share_value: '' })} className={FLD}>
                    <option value="remainder">The rest</option>
                    <option value="percent">A percentage</option>
                    <option value="fixed">A fixed amount</option>
                  </select>
                </div>
                {l.share_type === 'percent' && (
                  <div>
                    <label htmlFor={`py-pct-${i}`} className={LBL}>Percent *</label>
                    <input id={`py-pct-${i}`} value={l.share_value ?? ''} onChange={e => update(i, { share_value: e.target.value })} inputMode="decimal" className={FLD} placeholder="50" />
                  </div>
                )}
                {l.share_type === 'fixed' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor={`py-amt-${i}`} className={LBL}>Amount *</label>
                      <input id={`py-amt-${i}`} value={l.share_value ?? ''} onChange={e => update(i, { share_value: e.target.value })} inputMode="decimal" className={FLD} placeholder="200.00" />
                    </div>
                    <div>
                      <label htmlFor={`py-per-${i}`} className={LBL}>Per</label>
                      <select id={`py-per-${i}`} value={l.fixed_frequency ?? 'weekly'} onChange={e => update(i, { fixed_frequency: e.target.value as PayerInput['fixed_frequency'] })} className={FLD}>
                        <option value="weekly">Week</option><option value="biweekly">2 weeks</option><option value="monthly">Month</option>
                      </select>
                    </div>
                  </div>
                )}
                {l.share_type === 'remainder' && <div />}

                <div>
                  <label htmlFor={`py-method-${i}`} className={LBL}>Method *</label>
                  <select id={`py-method-${i}`} value={l.method} onChange={e => update(i, { method: e.target.value as PayerInput['method'] })} className={FLD}>
                    {PAY_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`py-draft-${i}`} className={LBL}>{l.method === 'check' ? 'When' : 'Draft day'}</label>
                  <input id={`py-draft-${i}`} value={l.draft_day ?? ''} onChange={e => update(i, { draft_day: e.target.value })} maxLength={20} className={FLD} placeholder={l.method === 'check' ? 'Mondays' : 'Friday, or the 1st'} />
                </div>

                {l.method === 'ach' && <AchFields i={i} l={l} update={update} />}
                {l.method === 'credit_card' && (
                  <>
                    <div>
                      <label htmlFor={`py-brand-${i}`} className={LBL}>Card</label>
                      <input id={`py-brand-${i}`} value={l.card_brand ?? ''} onChange={e => update(i, { card_brand: e.target.value })} maxLength={20} className={FLD} placeholder="Visa" />
                    </div>
                    <Last4 id={`py-l4-${i}`} value={l.last4 ?? ''} onChange={v => update(i, { last4: v })} />
                  </>
                )}
                {(l.method === 'other' || l.method === 'check') && (
                  <div className="sm:col-span-2">
                    <label htmlFor={`py-other-${i}`} className={LBL}>Details</label>
                    <input id={`py-other-${i}`} value={l.other_details ?? ''} onChange={e => update(i, { other_details: e.target.value })} maxLength={300} className={FLD}
                      placeholder={l.method === 'check' ? 'Payable to…, drop box at the front desk' : 'Zelle, voucher number, paid monthly by the state…'} />
                  </div>
                )}

                <div className="sm:col-span-2 grid gap-3 rounded-xl bg-surface p-3 sm:grid-cols-[auto_10rem_1fr] sm:items-end">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-text-main">
                    <input type="checkbox" checked={!!l.authorization_on_file} onChange={e => update(i, { authorization_on_file: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                    Signed authorization on file
                  </label>
                  {l.authorization_on_file && (
                    <>
                      <div>
                        <label htmlFor={`py-signed-${i}`} className={LBL}>Signed on</label>
                        <input id={`py-signed-${i}`} type="date" value={l.authorization_signed_on ?? ''} max={today} onChange={e => update(i, { authorization_signed_on: e.target.value })} className={FLD} />
                      </div>
                      <div>
                        <label htmlFor={`py-file-${i}`} className={LBL}>Form (from Records)</label>
                        <select id={`py-file-${i}`} value={l.authorization_file_id ?? ''} onChange={e => update(i, { authorization_file_id: e.target.value || null })} className={FLD}>
                          <option value="">Not uploaded</option>
                          {data.files.map(f => <option key={f.id} value={f.id}>{f.file_name}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {lines.length < 6 && (
          <button onClick={() => setLines(ls => [...ls, { ...BLANK_PAYER, share_type: ls.some(x => x.share_type === 'remainder') ? 'percent' : 'remainder', payer_guardian_id: data.guardians.find(g => !ls.some(x => x.payer_guardian_id === g.id))?.id ?? null }])}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
            <Plus className="h-4 w-4" /> Add a payer
          </button>
        )}

        {freqs.length > 0 && !problem && (
          <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-600">At today&apos;s prices</p>
            {freqs.map(fq => {
              const s = previewSplit(fq.total, fq.frequency, lines)
              return (
                <div key={fq.frequency} className="mb-2 text-sm last:mb-0">
                  <div className="font-semibold text-heading">{money(fq.total)} per {frequencyPer(fq.frequency)}</div>
                  <ul className="pl-3 text-text-main">
                    {lines.map((l, i) => s.amounts[i] == null ? null : (
                      <li key={i}>{l.payer_guardian_id ? data.guardians.find(g => g.id === l.payer_guardian_id)?.name : (l.payer_name || `Payer ${i + 1}`)}: {money(s.amounts[i])}</li>
                    ))}
                  </ul>
                  {s.unassigned > 0 && <p className="text-xs text-amber-800">{money(s.unassigned)} not covered by anyone.</p>}
                  {s.over > 0 && <p className="text-xs text-amber-800">Fixed amounts are {money(s.over)} over the total.</p>}
                </div>
              )
            })}
          </div>
        )}
        {problem && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="py-from" className={LBL}>These payers start *</label>
            <input id="py-from" type="date" value={from} onChange={e => setFrom(e.target.value)} className={FLD} />
          </div>
          <div>
            <label htmlFor="py-note" className={LBL}>Note{from < today ? ' *' : ''}</label>
            <input id="py-note" value={note} onChange={e => setNote(e.target.value)} maxLength={200} className={FLD} />
          </div>
        </div>
        <PastHint show={from < today} owner={data.is_owner} />
        <p className="text-xs text-muted">Payers before this date stay in the history. Keep the signed ACH or card form under Records and pick it above. For cards, only the brand and last 4 digits are kept.</p>
      </div>
    </Modal>
  )
}

/**
 * ACH details: bank, account type, routing number and the full account number (typed twice). The account number goes
 * only to the server, which encrypts it. When one is already on file it stays unless "Replace" is used.
 */
function AchFields({ i, l, update }: { i: number; l: PayerInput; update: (i: number, patch: Partial<PayerInput>) => void }) {
  const [show, setShow] = useState(false)
  const routing = (l.routing_number ?? '').trim()
  const routingBad = routing.length === 9 && !abaValid(routing)
  const typed = (l.account_number ?? '').replace(/[\s-]/g, '')
  const confirm = (l.account_number_confirm ?? '').replace(/[\s-]/g, '')
  const digitsOnly = (v: string, max: number) => v.replace(/[^\d\s-]/g, '').slice(0, max)
  return (
    <div className="sm:col-span-2 grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
      <p className="sm:col-span-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted"><Building2 className="h-3.5 w-3.5" /> Bank account</p>
      <div>
        <label htmlFor={`py-bank-${i}`} className={LBL}>Bank name *</label>
        <input id={`py-bank-${i}`} value={l.bank_name ?? ''} onChange={e => update(i, { bank_name: e.target.value })} maxLength={80} className={FLD} placeholder="Wells Fargo" />
      </div>
      <div>
        <label htmlFor={`py-acct-${i}`} className={LBL}>Account type *</label>
        <select id={`py-acct-${i}`} value={l.account_type || 'checking'} onChange={e => update(i, { account_type: e.target.value as PayerInput['account_type'] })} className={FLD}>
          <option value="checking">Checking</option><option value="savings">Savings</option>
        </select>
      </div>
      <div>
        <label htmlFor={`py-routing-${i}`} className={LBL}>Routing number *</label>
        <input id={`py-routing-${i}`} value={l.routing_number ?? ''} onChange={e => update(i, { routing_number: e.target.value.replace(/\D/g, '').slice(0, 9) })}
          inputMode="numeric" autoComplete="off" maxLength={9} className={`${FLD} font-mono`} placeholder="9 digits" />
        <p className={`mt-1 text-[11px] ${routingBad ? 'text-red-600' : 'text-subtle'}`}>
          {routingBad ? 'This isn’t a valid routing number. Check the 9 digits.' : 'Bottom left of a check.'}
        </p>
      </div>
      {l.keep_account_from && !l.account_number ? (
        <div className="self-start">
          <span className={LBL}>Account number *</span>
          <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm">
            <span className="flex items-center gap-1.5 font-mono text-text-main"><Lock className="h-3.5 w-3.5 text-muted" /> ····{l.last4 || '••••'} on file</span>
            <button type="button" onClick={() => update(i, { keep_account_from: null, account_number: '', account_number_confirm: '' })} className="text-xs font-semibold text-brand-600 hover:underline">Replace</button>
          </div>
        </div>
      ) : (
        <>
          <div>
            <label htmlFor={`py-acctno-${i}`} className={LBL}>Account number *</label>
            <div className="relative">
              <input id={`py-acctno-${i}`} type={show ? 'text' : 'password'} value={l.account_number ?? ''} onChange={e => update(i, { account_number: digitsOnly(e.target.value, 21) })}
                inputMode="numeric" autoComplete="off" data-1p-ignore data-lpignore="true" className={`${FLD} pr-10 font-mono`} placeholder="4 to 17 digits" />
              <button type="button" onClick={() => setShow(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-surface" aria-label={show ? 'Hide account number' : 'Show account number'}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="sm:col-start-2">
            <label htmlFor={`py-acctno2-${i}`} className={LBL}>Confirm account number *</label>
            <input id={`py-acctno2-${i}`} type={show ? 'text' : 'password'} value={l.account_number_confirm ?? ''} onChange={e => update(i, { account_number_confirm: digitsOnly(e.target.value, 21) })}
              onPaste={e => e.preventDefault()} inputMode="numeric" autoComplete="off" data-1p-ignore data-lpignore="true" className={`${FLD} font-mono`} placeholder="Type it again" />
            {confirm.length > 0 && typed.length > 0 && (
              <p className={`mt-1 text-[11px] ${confirm === typed ? 'text-emerald-700' : 'text-red-600'}`}>{confirm === typed ? 'Numbers match.' : 'Numbers don’t match yet.'}</p>
            )}
          </div>
        </>
      )}
      <p className="sm:col-span-2 flex items-start gap-1.5 text-[11px] text-subtle">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" /> The account number is encrypted before it is saved. Afterwards it shows as the last 4 digits; owners and admins can view it in full, and every view is logged.
      </p>
    </div>
  )
}

/** Routing number and the masked account number, with a logged "Show" for owners and admins (hides again after 30s) */
function BankNumbers({ p }: { p: PayerRow }) {
  const [full, setFull] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!full) return
    const t = setTimeout(() => setFull(null), 30_000)
    return () => clearTimeout(t)
  }, [full])
  async function reveal() {
    if (!await showConfirm(`Show ${p.payer_name}'s full account number? This is recorded in the child's Activity.`, { title: 'Show account number', confirmLabel: 'Show' })) return
    setBusy(true)
    const res = await revealBankAccount(p.id)
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    setFull(res.account_number)
  }
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
      {p.routing_number && <span>Routing {p.routing_number}</span>}
      {p.has_account_number && (
        <span className="inline-flex items-center gap-1.5">
          Account {full ?? `····${p.last4 ?? ''}`}
          <button type="button" onClick={full ? () => setFull(null) : reveal} disabled={busy} className="font-sans font-semibold text-brand-600 hover:underline disabled:opacity-50">
            {busy ? 'Opening…' : full ? 'Hide' : 'Show'}
          </button>
        </span>
      )}
    </p>
  )
}

/** Only the last 4 digits: anything longer is refused here and by the database */
function Last4({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className={LBL}>Last 4</label>
      <input id={id} value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="off" maxLength={4} className={FLD} placeholder="4417" />
    </div>
  )
}

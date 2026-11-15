'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, History, Loader2, Pencil, Plus, Receipt, Tag, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/compliance'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'
import {
  FEE_KINDS, FREQUENCIES, deleteFee, deleteRate, feeKindLabel, frequencyLabel, frequencyPer, loadRateCard, money, parseMoney,
  firstChargedOn, saveFee, setRate, suggestedRateStart, type FeeInput, type FeeRow, type RateCard,
} from '@/lib/tuition'
import { BTN, BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD, LBL, Modal, Pill } from '../../children/_components/ui'

type RateForm = { fee: FeeRow; amount: string; from: string; note: string }

/**
 * The center's tuition rate card, inside Manage Data. Fees are grouped by program; each has dated rates. Changing a
 * price adds a rate from a date, so every earlier week or month keeps the price it had. Changes dated before today
 * are for the owner, with a reason.
 */
export function TuitionFeesPanel({ centerId }: { centerId: string }) {
  const [card, setCard] = useState<RateCard | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<FeeInput | null>(null)
  const [rate, setRateForm] = useState<RateForm | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await loadRateCard(createClient(), centerId)
    if (!res.success) { setError(res.error); setCard(null); return }
    setError('')
    setCard(res.data)
  }, [centerId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function saveFeeForm() {
    if (!editing) return
    setSaving(true)
    const res = await saveFee(createClient(), centerId, editing)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    setEditing(null)
    load()
  }

  async function saveRate() {
    if (!rate || !card) return
    if (rate.from < card.today && !rate.note.trim()) { showAlert('Give a reason for a change dated before today.'); return }
    setSaving(true)
    const res = await setRate(createClient(), rate.fee.id, rate.amount, rate.from, rate.note)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    setRateForm(null)
    setOpen(o => ({ ...o, [rate.fee.id]: true }))
    load()
  }

  async function removeRate(r: FeeRow['rates'][number]) {
    if (!card) return
    let note = ''
    if (r.from < card.today) {
      const given = await showPrompt(`This rate started ${formatDate(r.from)}. Removing it changes what earlier periods cost. Why?`, '', { title: 'Remove a past rate' })
      if (given == null) return
      note = given
    } else if (!await showConfirm(`Remove the ${money(r.amount)} rate from ${formatDate(r.from)}? The rate before it carries on in its place.`, { title: 'Remove rate', confirmLabel: 'Remove' })) {
      return
    }
    const res = await deleteRate(createClient(), r.id, note)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  async function removeFee(fee: FeeRow) {
    if (!await showConfirm(`Delete ${fee.name} and its rates? No child has had it, so nothing else changes.`, { title: 'Delete fee', confirmLabel: 'Delete', tone: 'danger' })) return
    const res = await deleteFee(createClient(), fee.id)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  async function toggleActive(fee: FeeRow) {
    if (fee.is_active && !await showConfirm(`Turn off ${fee.name}? It can't be added to more children. The ${fee.children || 'no'} ${fee.children === 1 ? 'child who has' : 'children who have'} it keep it.`, { title: 'Turn off fee', confirmLabel: 'Turn off' })) return
    const res = await saveFee(createClient(), centerId, { id: fee.id, program_id: fee.program_id, name: fee.name, kind: fee.kind, frequency: fee.frequency, is_active: !fee.is_active })
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  if (error) {
    return <div className="p-8 text-center text-sm text-muted"><Receipt className="mx-auto mb-3 h-10 w-10 text-brand-200" />{error}</div>
  }
  if (!card) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>

  const groups = [
    ...card.programs.map(p => ({ id: p.id as string | null, name: p.name, inactive: !p.is_active })),
    { id: null, name: 'Any program', inactive: false },
  ].map(g => ({ ...g, fees: card.fees.filter(f => f.program_id === g.id) }))
    .filter(g => g.fees.length > 0 || (g.id !== null && !g.inactive))

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface/50 p-6">
        <div className="max-w-xl">
          <h2 className="text-xl font-black text-text-main">Tuition Fees</h2>
          <p className="text-sm font-medium text-muted">
            Your rate card, by program. To change a price, add a new amount from a date: earlier weeks and months keep the
            price they had. Each week or month uses the price in force on its first day.
          </p>
        </div>
        <button onClick={() => setEditing({ program_id: card.programs.find(p => p.is_active)?.id ?? null, name: '', kind: 'tuition', frequency: 'weekly', amount: '', from: card.today })}
          className="flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 font-bold text-heading shadow-sm transition-all hover:bg-amber-500">
          <Plus className="h-4 w-4" /> Add fee
        </button>
      </div>

      <div className="space-y-6 p-6">
        {card.programs.length === 0 && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Add your programs (Infant, Toddler, Preschool…) under About → Programs to group fees by program. Fees for any program work without them.
          </p>
        )}
        {groups.map(g => (
          <section key={g.id ?? 'any'}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted">
              {g.name}{g.inactive && <Pill className="border-border bg-surface text-muted">Inactive program</Pill>}
            </h3>
            {g.fees.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted">No fees for {g.name} yet.</p>
            ) : (
              <ul className="space-y-2">
                {g.fees.map(f => {
                  const expanded = !!open[f.id]
                  return (
                    <li key={f.id} className={`rounded-2xl border border-border bg-white ${f.is_active ? '' : 'opacity-70'}`}>
                      <div className="flex flex-wrap items-center gap-3 p-4">
                        <button onClick={() => setOpen(o => ({ ...o, [f.id]: !expanded }))} className="rounded-lg p-1 text-muted hover:bg-surface" aria-label={expanded ? 'Hide rate history' : 'Show rate history'}>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-heading">{f.name}</span>
                            <Pill className="border-border bg-surface text-muted">{frequencyLabel(f.frequency)}</Pill>
                            {f.kind !== 'tuition' && <Pill className="border-brand-100 bg-brand-50 text-brand-600">{feeKindLabel(f.kind)}</Pill>}
                            {!f.is_active && <Pill className="border-border bg-surface text-muted">Off</Pill>}
                            {f.upcoming && (
                              <Pill className="border-amber-200 bg-amber-50 text-amber-800">{money(f.upcoming.amount)} from {formatDate(f.upcoming.from)}</Pill>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted">
                            {f.children} {f.children === 1 ? 'child' : 'children'}
                            {f.current ? ` · since ${formatDate(f.current.from)}` : ' · no price in force today'}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-black text-heading">{f.current ? money(f.current.amount) : '—'}</div>
                          <div className="text-xs text-muted">{f.frequency === 'one_time' ? 'one time' : `per ${frequencyPer(f.frequency)}`}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button className={BTN} onClick={() => setRateForm({ fee: f, amount: '', from: suggestedRateStart(f.frequency, card.today), note: '' })}>
                            <Tag className="h-3.5 w-3.5" /> Change price
                          </button>
                          <button className={BTN_QUIET_SM} onClick={() => setEditing({ id: f.id, program_id: f.program_id, name: f.name, kind: f.kind, frequency: f.frequency, is_active: f.is_active })}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                          <button className={BTN_QUIET_SM} onClick={() => toggleActive(f)}>{f.is_active ? 'Turn off' : 'Turn on'}</button>
                          {f.children === 0 && f.rates.length <= 1 && (
                            <button className={BTN_QUIET_SM} onClick={() => removeFee(f)} title="Delete (no child has had this fee)"><Trash2 className="h-3.5 w-3.5" /></button>
                          )}
                        </div>
                      </div>
                      {expanded && (
                        <div className="border-t border-border px-4 py-3">
                          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted"><History className="h-3.5 w-3.5" /> Price history</p>
                          <ul className="divide-y divide-border text-sm">
                            {f.rates.map(r => {
                              const state = r.from > card.today ? 'Upcoming' : (!r.to || r.to >= card.today) ? 'Current' : 'Past'
                              const canRemove = f.rates.length > 1 && (r.from >= card.today || card.is_owner)
                              return (
                                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                                  <span className="w-28 font-bold text-heading">{money(r.amount)}</span>
                                  <span className="flex-1 text-text-main">
                                    {formatDate(r.from)} – {r.to ? formatDate(r.to) : 'until changed'}
                                    {r.note && <span className="text-muted"> · {r.note}</span>}
                                  </span>
                                  <Pill className={state === 'Current' ? 'border-brand-100 bg-brand-50 text-brand-600' : state === 'Upcoming' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-border bg-surface text-muted'}>{state}</Pill>
                                  {canRemove && <button className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600" onClick={() => removeRate(r)} aria-label="Remove rate"><Trash2 className="h-3.5 w-3.5" /></button>}
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))}
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit fee' : 'Add fee'} onClose={() => setEditing(null)} footer={
          <>
            <button onClick={() => setEditing(null)} className={BTN_QUIET}>Cancel</button>
            <button onClick={saveFeeForm} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
          </>
        }>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={LBL}>Program</label>
              <select value={editing.program_id ?? ''} onChange={e => setEditing({ ...editing, program_id: e.target.value || null })} className={FLD}>
                {card.programs.filter(p => p.is_active || p.id === editing.program_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value="">Any program</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={LBL}>Name *</label>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} maxLength={80} className={FLD} placeholder="For example: Full-time (5 days)" autoFocus />
            </div>
            <div>
              <label className={LBL}>Type</label>
              <select value={editing.kind} onChange={e => setEditing({ ...editing, kind: e.target.value as FeeInput['kind'] })} className={FLD}>
                {FEE_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
            <div>
              <label className={LBL}>Charged</label>
              <select value={editing.frequency} onChange={e => setEditing({ ...editing, frequency: e.target.value as FeeInput['frequency'] })} className={FLD}>
                {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            {!editing.id && (
              <>
                <div>
                  <label className={LBL}>Amount *</label>
                  <input value={editing.amount ?? ''} onChange={e => setEditing({ ...editing, amount: e.target.value })} inputMode="decimal" className={FLD} placeholder="285.00" />
                  {editing.amount && parseMoney(editing.amount) == null && <p className="mt-1 text-xs text-red-600">Use a number like 285 or 285.50.</p>}
                </div>
                <div>
                  <label className={LBL}>Price starts *</label>
                  <input type="date" value={editing.from ?? ''} onChange={e => setEditing({ ...editing, from: e.target.value })} className={FLD} />
                </div>
              </>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            {editing.id
              ? 'To change the price, use Change price, so earlier periods keep their price. How often a fee is charged can’t change once a child has it.'
              : 'For fees you already charge, set the date the price first applied, so children already enrolled get the right history.'}
          </p>
        </Modal>
      )}

      {rate && (
        <Modal title={`Change price: ${rate.fee.name}`} onClose={() => setRateForm(null)} footer={
          <>
            <button onClick={() => setRateForm(null)} className={BTN_QUIET}>Cancel</button>
            <button onClick={saveRate} disabled={saving || (rate.from < card.today && !card.is_owner)} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save new price</button>
          </>
        }>
          <p className="mb-4 text-sm text-muted">
            Now {rate.fee.current ? <strong className="text-heading">{money(rate.fee.current.amount)}</strong> : 'no price'} {rate.fee.frequency === 'one_time' ? '(one time)' : `per ${frequencyPer(rate.fee.frequency)}`}.
            The new price applies from the date you pick until the next change{rate.fee.frequency === 'monthly' ? ', starting with the month that begins on or after it' : rate.fee.frequency === 'weekly' ? ', starting with the week (Monday) that begins on or after it' : ''}.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LBL}>New amount *</label>
              <input value={rate.amount} onChange={e => setRateForm({ ...rate, amount: e.target.value })} inputMode="decimal" className={FLD} placeholder="295.00" autoFocus />
            </div>
            <div>
              <label className={LBL}>Starts *</label>
              <input type="date" value={rate.from} onChange={e => setRateForm({ ...rate, from: e.target.value })} className={FLD} />
            </div>
            <div className="sm:col-span-2">
              <label className={LBL}>Note{rate.from < card.today ? ' *' : ''}</label>
              <input value={rate.note} onChange={e => setRateForm({ ...rate, note: e.target.value })} maxLength={300} className={FLD} placeholder={rate.from < card.today ? 'Why the past price is being corrected' : 'For example: 2027 annual increase'} />
            </div>
          </div>
          {(() => {
            const charged = firstChargedOn(rate.fee.frequency, rate.from)
            if (!charged || charged === rate.from) return null
            return (
              <p className="mt-3 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-800">
                {rate.fee.frequency === 'monthly' ? 'Each month' : 'Each week'} uses the price in force on its first day, so this price is first charged on <strong>{formatDate(charged)}</strong>.
              </p>
            )
          })()}
          {rate.from < card.today && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {card.is_owner
                ? 'This date is in the past, so it changes what earlier periods cost. Give a reason; it is kept with the rate.'
                : 'Only the center’s owner can change a past price. Pick today or a later date.'}
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}

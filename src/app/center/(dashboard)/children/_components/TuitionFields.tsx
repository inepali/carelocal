'use client'

import { useEffect, useState } from 'react'
import { Plus, Receipt, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  addChildFee, frequencyLabel, frequencyPer, loadFeeOptions, money,
  type DiscountInput, type FeeOption,
} from '@/lib/tuition'
import { FLD, LBL } from './ui'

export const NO_DISCOUNT: DiscountInput = { discount_type: '', discount_value: '', discount_reason: '' }

/** One select (none / % off / $ off / locked-in price) and its amount and reason */
export function DiscountFields({ value, onChange, idPrefix }: { value: DiscountInput; onChange: (d: DiscountInput) => void; idPrefix: string }) {
  const t = value.discount_type
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <label htmlFor={`${idPrefix}-dtype`} className={LBL}>Discount</label>
        <select id={`${idPrefix}-dtype`} value={t} onChange={e => onChange({ ...value, discount_type: e.target.value as DiscountInput['discount_type'] })} className={FLD}>
          <option value="">None (list price)</option>
          <option value="percent">% off</option>
          <option value="amount">$ off</option>
          <option value="override">Locked-in price</option>
        </select>
      </div>
      {t && (
        <div>
          <label htmlFor={`${idPrefix}-dval`} className={LBL}>{t === 'percent' ? 'Percent off' : t === 'amount' ? 'Amount off' : 'Price'}</label>
          <input id={`${idPrefix}-dval`} value={value.discount_value} onChange={e => onChange({ ...value, discount_value: e.target.value })} inputMode="decimal" className={FLD}
            placeholder={t === 'percent' ? '10' : t === 'amount' ? '20.00' : '250.00'} />
        </div>
      )}
      {(t === 'percent' || t === 'amount') && (
        <div>
          <label htmlFor={`${idPrefix}-dreason`} className={LBL}>Reason</label>
          <input id={`${idPrefix}-dreason`} value={value.discount_reason} onChange={e => onChange({ ...value, discount_reason: e.target.value })} maxLength={120} className={FLD} placeholder="Sibling, Staff, Military…" />
        </div>
      )}
      {t === 'override' && <p className="self-end pb-2.5 text-xs text-muted">Ignores the rate card, including future price changes.</p>}
    </div>
  )
}

/** A fee picked while enrolling: added to the child right after the child is created */
export interface PickedFee { fee_id: string; start: string; discount: DiscountInput }

export function optionLabel(o: FeeOption) {
  return `${o.label} · ${o.amount == null ? 'no price today' : money(o.amount)}${o.frequency === 'one_time' ? ' one time' : ` / ${frequencyPer(o.frequency)}`}`
}

/**
 * The optional Tuition part of Add a child / Enroll from a tour: pick fees from the rate card (the home room's
 * program first). Nothing shows when Tuition is off or there are no fees yet.
 */
export function EnrollFeesSection({ centerId, programId, startDefault, value, onChange }: {
  centerId: string
  programId: string | null
  startDefault: string
  value: PickedFee[]
  onChange: (v: PickedFee[]) => void
}) {
  const [options, setOptions] = useState<FeeOption[] | null>(null)

  useEffect(() => {
    let live = true
    loadFeeOptions(createClient(), centerId, programId).then(res => { if (live) setOptions(res.success ? res.data : []) })
    return () => { live = false }
  }, [centerId, programId])

  if (!options || options.length === 0) return null
  const used = new Set(value.map(v => v.fee_id))
  const suggested = options.filter(o => o.program_id === programId && programId)

  const update = (i: number, patch: Partial<PickedFee>) => onChange(value.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  const add = (feeId?: string) => {
    const pick = feeId ?? options.find(o => !used.has(o.id))?.id
    if (pick) onChange([...value, { fee_id: pick, start: startDefault, discount: NO_DISCOUNT }])
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-bold text-text-main"><Receipt className="h-4 w-4 text-brand-600" /> Tuition (optional)</div>
      <p className="mb-3 text-xs text-muted">Pick the child’s fees from your rate card. You can also add them later on the child’s Fee &amp; Payment tab.</p>
      {value.length === 0 && suggested.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {suggested.slice(0, 4).map(o => (
            <button key={o.id} type="button" onClick={() => add(o.id)} className="rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50">
              + {optionLabel(o)}
            </button>
          ))}
        </div>
      )}
      <ul className="space-y-3">
        {value.map((v, i) => (
          <li key={i} className="rounded-xl border border-border bg-white p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
              <div>
                <label htmlFor={`enroll-fee-${i}`} className={LBL}>Fee</label>
                <select id={`enroll-fee-${i}`} value={v.fee_id} onChange={e => update(i, { fee_id: e.target.value })} className={FLD}>
                  {options.filter(o => o.id === v.fee_id || !used.has(o.id)).map(o => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`enroll-fee-start-${i}`} className={LBL}>{options.find(o => o.id === v.fee_id)?.frequency === 'one_time' ? 'Charged on' : 'Starts'}</label>
                <input id={`enroll-fee-start-${i}`} type="date" value={v.start} onChange={e => update(i, { start: e.target.value })} className={FLD} />
              </div>
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="self-end rounded-lg p-2.5 text-muted hover:bg-surface" aria-label="Remove fee"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3"><DiscountFields idPrefix={`enroll-fee-${i}`} value={v.discount} onChange={d => update(i, { discount: d })} /></div>
          </li>
        ))}
      </ul>
      {value.length < options.length && (
        <button type="button" onClick={() => add()} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
          <Plus className="h-4 w-4" /> {value.length ? 'Add another fee' : 'Add a fee'}
        </button>
      )}
      {value.some(v => options.find(o => o.id === v.fee_id)?.frequency === 'biweekly') && (
        <p className="mt-2 text-xs text-muted">{frequencyLabel('biweekly')} periods count from the fee’s start date.</p>
      )}
    </div>
  )
}

/** Add the fees picked while enrolling. Returns the problems, if any, so the child is still created and opened. */
export async function applyEnrollFees(childId: string, picked: PickedFee[]): Promise<string[]> {
  const problems: string[] = []
  const supabase = createClient()
  for (const p of picked) {
    const res = await addChildFee(supabase, childId, p.fee_id, p.start, p.discount)
    if (!res.success) problems.push(res.error)
  }
  return problems
}

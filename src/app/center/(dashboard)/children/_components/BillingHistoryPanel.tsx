'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import type { Child } from '@/lib/child-types'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/compliance'
import { money } from '@/lib/tuition'
import { loadChildHistory, type ChildBillingHistory } from '@/lib/billing'
import { ChargeList, VoidBadge } from '../../billing/_components/charges'

/**
 * A child's billing history: every bill posted by a billing run (billing amount, discount, total), what each payer paid,
 * and the year-to-date totals. Payments can be recorded here too.
 */
export function BillingHistoryPanel({ child }: { child: Child }) {
  const [year, setYear] = useState<number | null>(null)
  const [data, setData] = useState<ChildBillingHistory | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    const res = await loadChildHistory(createClient(), child.id, year)
    if (!res.success) { setError(res.error); return }
    setError('')
    setData(res.data)
  }, [child.id, year])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  if (error) return <div className="rounded-2xl border border-border bg-white p-8 text-center text-sm text-muted">{error}</div>
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>

  const years = Array.from(new Set([...data.years, data.year, Number(data.today.slice(0, 4))])).sort((a, b) => b - a)
  const y = data.ytd

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div className="max-w-2xl">
          <h2 className="text-lg font-bold text-heading">Billing history</h2>
          <p className="mt-1 text-sm text-muted">
            Bills posted by <Link href="/center/billing" className="font-semibold text-brand-700 hover:underline">Billing</Link> runs, split by who pays.
            Record card, check or cash payments here; ACH drafts are tracked on the run.
            {data.balance_all > 0 && <> All-time balance due: <b className="text-text-main">{money(data.balance_all)}</b>.</>}
          </p>
        </div>
        <select className="rounded-xl border border-border bg-white px-3 py-2 text-sm" value={data.year} onChange={e => setYear(Number(e.target.value))} aria-label="Year">
          {years.map(yr => <option key={yr} value={yr}>{yr}</option>)}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={`Bill amount YTD ${data.year}`} value={money(y.list)} />
        <Stat label="Discount YTD" value={y.discount > 0 ? `−${money(y.discount)}` : money(0)} />
        <Stat label="Total YTD" value={money(y.total)} strong />
        <Stat label="Paid YTD" value={money(y.paid)} />
        <Stat label="Due" value={money(y.balance)} strong />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        {data.bills.length === 0 ? <p className="p-8 text-center text-sm text-muted">No bills in {data.year}.</p> : (
          <div className="divide-y divide-border">
            <div className="hidden gap-x-6 bg-surface px-5 py-2.5 text-xs uppercase tracking-wide text-muted sm:flex">
              <span className="flex-1 pl-6">Period</span>
              <span className="w-28 text-right">Bill amount</span>
              <span className="w-24 text-right">Discount</span>
              <span className="w-24 text-right">Total</span>
              <span className="w-24 text-right">Paid</span>
              <span className="w-24 text-right">Due</span>
            </div>
            {data.bills.map(b => (
              <div key={b.id} className={b.voided ? 'opacity-60' : ''}>
                <button className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-left text-sm hover:bg-surface/60" onClick={() => setOpen(o => ({ ...o, [b.id]: !o[b.id] }))} aria-expanded={!!open[b.id]}>
                  <span className="flex flex-1 items-start gap-1.5">
                    {open[b.id] ? <ChevronDown className="mt-0.5 h-4 w-4 text-muted" /> : <ChevronRight className="mt-0.5 h-4 w-4 text-muted" />}
                    <span>
                      <span className="font-semibold text-text-main">{b.label[0].toUpperCase() + b.label.slice(1)}</span> {b.voided && <VoidBadge />}
                      <span className="block text-xs text-muted">{b.frequency === 'weekly' ? 'Weekly' : 'Monthly'} · billed {formatDate(b.billed_at)}</span>
                    </span>
                  </span>
                  <span className="w-28 text-right">{money(b.list)}</span>
                  <span className="w-24 text-right">{b.discount > 0 ? `−${money(b.discount)}` : '—'}</span>
                  <span className="w-24 text-right font-semibold">{money(b.total)}</span>
                  <span className="w-24 text-right">{money(b.paid)}</span>
                  <span className="w-24 text-right font-semibold">{b.voided ? '—' : money(b.balance)}</span>
                </button>
                {open[b.id] && (
                  <div className="space-y-3 bg-surface/40 px-5 pb-5 pl-12 pt-1">
                    <table className="w-full text-xs">
                      <tbody>
                        {b.lines.map((l, i) => (
                          <tr key={i}>
                            <td className="py-1">{l.fee_name}{l.discount_label ? <span className="text-muted"> · {l.discount_label}</span> : null}</td>
                            <td className="py-1 text-right">{money(l.list)}</td>
                            <td className="py-1 text-right">{l.discount > 0 ? `−${money(l.discount)}` : ''}</td>
                            <td className="py-1 text-right font-semibold">{money(l.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <ChargeList charges={b.charges} today={data.today} onChanged={load} readOnly={b.voided} />
                    <Link href={`/center/billing/runs/${b.run_id}`} className="inline-block text-xs font-semibold text-brand-700 hover:underline">Open the billing run →</Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 ${strong ? 'text-xl font-black text-heading' : 'text-lg font-bold text-text-main'}`}>{value}</div>
    </div>
  )
}

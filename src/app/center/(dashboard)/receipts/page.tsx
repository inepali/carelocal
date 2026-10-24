'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Receipt as ReceiptIcon, Plus, Edit2, Loader2, FileText, Lock } from 'lucide-react'
import { ReceiptDialog, formatMoney, type Receipt } from '@/components/center/ReceiptDialog'
import { openStoredFile } from '@/lib/files'
import { canManageReceipts, useCenterContext } from '../context'

type VendorOption = { id: string; name: string }

const inputClass = 'px-3 py-2.5 rounded-xl border border-border bg-white text-sm font-medium focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600'
const formatDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function ReceiptsPage() {
  const supabase = createClient()
  const ctx = useCenterContext()
  const allowed = canManageReceipts(ctx)
  const [loading, setLoading] = useState(true)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [vendorFilter, setVendorFilter] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('vendor') ?? ''))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [dialog, setDialog] = useState<{ receipt: Receipt | null } | null>(null)

  async function load() {
    if (!ctx.centerId || !allowed) { setLoading(false); return }
    const [{ data: rows }, { data: vendorRows }] = await Promise.all([
      supabase.from('center_receipts')
        .select('id, center_id, vendor_id, receipt_date, amount, notes, file_name, content_type, created_at')
        .eq('center_id', ctx.centerId).order('receipt_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('center_vendors').select('id, name').eq('center_id', ctx.centerId).order('name'),
    ])
    setReceipts(((rows ?? []) as Receipt[]).map(r => ({ ...r, amount: Number(r.amount) })))
    setVendors((vendorRows ?? []) as VendorOption[])
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load() }, [ctx.centerId, allowed])

  const vendorName = useMemo(() => new Map(vendors.map(v => [v.id, v.name])), [vendors])
  const shown = useMemo(() => receipts.filter(r =>
    (!vendorFilter || (vendorFilter === 'none' ? !r.vendor_id : r.vendor_id === vendorFilter))
    && (!from || r.receipt_date >= from)
    && (!to || r.receipt_date <= to)), [receipts, vendorFilter, from, to])
  const total = shown.reduce((sum, r) => sum + r.amount, 0)

  if (!allowed) {
    return (
      <div className="max-w-xl rounded-2xl border border-border bg-white p-8 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-subtle" />
        <h1 className="mb-2 text-xl font-bold text-heading">Receipts</h1>
        <p className="text-muted">Only the center owner and administrators can open receipts.</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl">
      <Link href="/center/vendors" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> Back to Vendors</Link>

      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="mb-1 text-3xl font-extrabold text-heading">Receipts</h1>
          <p className="text-muted">Photos of purchase receipts, kept by vendor with the date and amount.</p>
        </div>
        <button
          onClick={() => setDialog({ receipt: null })}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-6 py-3 font-bold text-heading shadow-sm transition-all hover:bg-amber-500 active:scale-95"
        >
          <Plus className="h-5 w-5" /> Add Receipt
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : receipts.length === 0 ? (
        <div className="rounded-[2.5rem] border border-dashed border-brand-200 bg-white py-20 text-center">
          <ReceiptIcon className="mx-auto mb-4 h-16 w-16 text-border" />
          <h3 className="mb-2 text-xl font-bold text-heading">No receipts yet</h3>
          <p className="mx-auto mb-6 max-w-sm text-muted">Take a picture of a receipt with your phone or upload a file, then enter its date and amount.</p>
          <button onClick={() => setDialog({ receipt: null })} className="font-bold text-brand-600 hover:underline">Add your first receipt →</button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-main">Vendor
              <select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)} className={`${inputClass} mt-1 block normal-case tracking-normal`}>
                <option value="">All vendors</option>
                <option value="none">No vendor</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-main">From
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${inputClass} mt-1 block`} />
            </label>
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-main">To
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${inputClass} mt-1 block`} />
            </label>
            {(vendorFilter || from || to) && (
              <button onClick={() => { setVendorFilter(''); setFrom(''); setTo('') }} className="pb-2.5 text-sm font-bold text-brand-600 hover:underline">Clear</button>
            )}
            <div className="ml-auto rounded-xl bg-brand-50 px-4 py-2 text-right">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted">{shown.length} receipt{shown.length === 1 ? '' : 's'}</div>
              <div className="text-lg font-black text-heading">{formatMoney(total)}</div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead>
                  <tr className="border-b border-border bg-surface text-[11px] font-bold uppercase tracking-widest text-muted">
                    <th className="px-5 py-3">Date</th>
                    <th className="px-4 py-3">Vendor</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-sm text-text-muted">
                  {shown.map(r => (
                    <tr key={r.id} className="align-top transition-colors hover:bg-surface">
                      <td className="whitespace-nowrap px-5 py-3 font-semibold text-text-main">{formatDay(r.receipt_date)}</td>
                      <td className="px-4 py-3">{r.vendor_id ? vendorName.get(r.vendor_id) ?? 'Unknown vendor' : <span className="text-subtle">No vendor</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-text-main">{formatMoney(r.amount)}</td>
                      <td className="max-w-xs px-4 py-3"><span className="line-clamp-2">{r.notes}</span></td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openStoredFile('receipt', r.id)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-600 hover:bg-brand-50" title={r.file_name}>
                            <FileText className="h-4 w-4" /> View
                          </button>
                          <button onClick={() => setDialog({ receipt: r })} aria-label="Edit receipt" className="rounded-lg p-1.5 text-muted hover:bg-brand-50 hover:text-brand-600">
                            <Edit2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.length === 0 && <p className="px-5 py-8 text-center text-muted">No receipts match these filters.</p>}
          </div>
        </>
      )}

      {dialog && ctx.centerId && (
        <ReceiptDialog
          centerId={ctx.centerId}
          vendors={vendors}
          receipt={dialog.receipt}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); load() }}
        />
      )}
    </div>
  )
}

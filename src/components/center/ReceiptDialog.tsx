'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, FileText, Loader2, Upload, X } from 'lucide-react'
import { storeUpload, DOCUMENT_ACCEPT, type UploadSource } from '@/lib/files'
import { PhoneUploadButton } from '@/components/center/PhoneUploadDialog'
import { deleteReceipt } from '@/app/actions/storage.actions'
import { todayDateOnly } from '@/lib/inspections'
import { showAlert } from '@/lib/dialog'

export interface Receipt {
  id: string
  center_id: string
  vendor_id: string | null
  receipt_date: string
  amount: number
  notes: string | null
  file_name: string
  content_type: string | null
  created_at: string
}

const inputClass = 'w-full px-4 py-3 rounded-xl border border-border focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-medium'
const labelClass = 'block font-bold text-text-main mb-2 uppercase tracking-widest text-[10px]'

export const formatMoney = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

/** Parses what a person types ("1,234.50", "$12") into dollars, or null when it is not a valid amount. */
function parseAmount(text: string) {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  return Number(cleaned)
}

/**
 * Add or edit a purchase receipt: a photo or PDF (picked, or sent from a phone), the vendor, and the date and
 * amount typed in by the person adding it. Owners and administrators only (the database enforces it too).
 */
export function ReceiptDialog({
  centerId, vendors, receipt, initialVendorId, onClose, onSaved,
}: {
  centerId: string
  vendors: { id: string; name: string }[]
  /** Editing: the existing receipt (its file stays as it is) */
  receipt?: Receipt | null
  initialVendorId?: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [vendorId, setVendorId] = useState(receipt?.vendor_id ?? initialVendorId ?? '')
  const [date, setDate] = useState(receipt?.receipt_date ?? todayDateOnly())
  const [amount, setAmount] = useState(receipt ? receipt.amount.toFixed(2) : '')
  const [notes, setNotes] = useState(receipt?.notes ?? '')
  const [file, setFile] = useState<UploadSource | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const parsed = parseAmount(amount)
    if (parsed === null) { setError('Enter the amount from the receipt, for example 42.50.'); return }
    if (!date) { setError('Enter the date on the receipt.'); return }
    if (!receipt && !file) { setError('Add a photo or PDF of the receipt.'); return }

    setSaving(true)
    const fields = {
      vendor_id: vendorId || null,
      receipt_date: date,
      amount: parsed,
      notes: notes.trim() || null,
    }

    if (receipt) {
      const { error: err } = await supabase.from('center_receipts').update(fields).eq('id', receipt.id)
      setSaving(false)
      if (err) { setError(err.message); return }
      onSaved()
      return
    }

    let stored
    try {
      stored = await storeUpload('receipt', file!)
    } catch (err) {
      setSaving(false)
      setError(err instanceof Error ? err.message : 'The upload failed. Please try again.')
      return
    }
    const { data: inserted, error: err } = await supabase.from('center_receipts').insert({
      ...fields,
      center_id: centerId,
      file_key: stored.fileKey,
      bucket_name: stored.bucketName,
      file_name: stored.name.slice(0, 200) || 'Receipt',
      content_type: stored.type || null,
      size_bytes: stored.size || null,
    }).select('id').single()
    setSaving(false)
    if (err || !inserted) {
      setError(err?.message ?? 'The receipt could not be saved.')
      return
    }
    onSaved()
  }

  async function handleDelete() {
    if (!receipt) return
    if (!window.confirm('Delete this receipt and its file? This cannot be undone.')) return
    setSaving(true)
    const res = await deleteReceipt(receipt.id)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-900/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-border flex items-center justify-between bg-surface">
          <h2 className="text-2xl font-black text-heading tracking-tight">{receipt ? 'Edit Receipt' : 'Add Receipt'}</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-border rounded-full transition-colors"><X className="w-5 h-5 text-muted" /></button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto">
          {!receipt && (
            <div>
              <label className={labelClass}>Receipt photo or PDF *</label>
              {file ? (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-text-main"><CheckCircle2 className="w-4 h-4 shrink-0 text-brand-600" /><span className="truncate">{file.name}</span></span>
                  <button type="button" onClick={() => setFile(null)} className="shrink-0 text-xs font-bold text-red-500 hover:underline">Remove</button>
                </div>
              ) : (
                <div className="flex items-stretch gap-2">
                  <label htmlFor="receipt_upload" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-border p-3 transition-all hover:border-brand-600 hover:bg-surface">
                    <Upload className="w-5 h-5 shrink-0 text-subtle" />
                    <span className="text-sm text-muted">Choose a photo or PDF <span className="text-subtle">(up to 15 MB)</span></span>
                  </label>
                  <input id="receipt_upload" type="file" className="hidden" accept={DOCUMENT_ACCEPT} onChange={e => setFile(e.target.files?.[0] || null)} />
                  <PhoneUploadButton kind="receipt" label="Receipt" variant="qr" onReceived={upload => { setFile(upload) }} />
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-subtle">Use the QR button to take the picture with your phone.</p>
            </div>
          )}

          {receipt && (
            <div className="flex items-center gap-2 rounded-xl bg-surface px-4 py-3 text-sm text-text-muted">
              <FileText className="w-4 h-4 shrink-0 text-brand-600" /><span className="truncate">{receipt.file_name}</span>
            </div>
          )}

          <div>
            <label className={labelClass}>Vendor</label>
            <select value={vendorId} onChange={e => setVendorId(e.target.value)} className={inputClass}>
              <option value="">No vendor</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Date on receipt *</label>
              <input type="date" required value={date} max={todayDateOnly()} onChange={e => setDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Total amount (USD) *</label>
              <input inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Notes</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="What it was for (optional)" className={inputClass} />
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>}

          <div className="pt-2 flex gap-3">
            {receipt && (
              <button type="button" disabled={saving} onClick={handleDelete} className="py-3 px-5 rounded-xl border border-red-200 font-bold text-red-600 hover:bg-red-50 transition-all disabled:opacity-60">
                Delete
              </button>
            )}
            <button type="button" onClick={onClose} className="flex-1 py-3 px-6 rounded-xl border border-border font-bold text-muted hover:bg-surface transition-all">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 bg-brand-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-brand-800 shadow-lg shadow-brand-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : receipt ? 'Save Changes' : 'Save Receipt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { Loader2, Mail, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reportSettings, type ReportSettings } from '@/lib/daily'

/**
 * Owners and admins: parent daily reports on or off for the center, and the early pick-up cutoff (before it, only a
 * director can check a child out; checking out after it sends the day's report about 10 minutes later).
 */
export function ReportSettingsDialog({ supabase, centerId, onClose, onSaved }: {
  supabase: SupabaseClient
  centerId: string
  onClose: () => void
  onSaved: (s: ReportSettings) => void
}) {
  const [s, setS] = useState<ReportSettings | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [cutoff, setCutoff] = useState('14:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    reportSettings(supabase, centerId).then(res => {
      if (!res.success) { setError(res.error); return }
      setS(res.settings); setEnabled(res.settings.enabled); setCutoff(res.settings.early_pickup_before)
    })
  }, [supabase, centerId])

  async function save() {
    setBusy(true)
    setError(null)
    const res = await reportSettings(supabase, centerId, { enabled, early_pickup_before: cutoff })
    setBusy(false)
    if (!res.success) { setError(res.error); return }
    onSaved(res.settings)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="rs-h"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="w-full max-w-md rounded-3xl border border-border bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id="rs-h" className="flex items-center gap-2 text-xl font-black text-heading"><Mail className="h-5 w-5 text-brand-600" /> Parent daily reports</h2>
            <p className="mt-1 text-[13px] text-muted">An email of each child&apos;s day, about 10 minutes after pick-up.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-surface"><X className="h-5 w-5" /></button>
        </div>
        {!s && !error ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div> : (
          <div className="space-y-4 px-6 py-5">
            <label className="flex cursor-pointer items-start gap-3 text-sm text-text-main">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="mt-0.5 h-5 w-5 accent-brand-600" />
              <span><span className="font-bold">Send daily reports to parents</span>
                <span className="block text-xs text-muted">To each contact with “Gets the daily report email” on (the primary contact by default).</span></span>
            </label>
            <label className="block text-sm font-semibold text-text-main">Early pick-up before
              <input type="time" value={cutoff} min="06:00" max="20:00" onChange={e => setCutoff(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm" />
              <span className="mt-1 block text-xs font-normal text-muted">Before this time only a director can check a child out, so a mistaken check-out does not send a report.</span>
            </label>
            <p className="rounded-xl bg-surface px-3 py-2 text-xs text-text-main">
              {s?.reply_to ? <>Parents&apos; replies go to <span className="font-semibold">{s.reply_to}</span>.</> : 'Add the center’s email under About so parents can reply.'}
            </p>
            {error && <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{error}</p>}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-border px-4 text-sm font-bold text-text-main hover:bg-surface">Cancel</button>
          <button type="button" onClick={save} disabled={busy || !s}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}

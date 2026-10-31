'use client'

import { useCallback, useEffect, useState } from 'react'
import { Eye, Loader2, Mail, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { loadReportHistory, reportSettings, resendReport, type ReportQueueRow, type ReportSettings } from '@/lib/daily'
import { previewDailyReport } from '@/app/actions/daily-report.actions'
import type { Child, ChildGuardian } from '@/lib/child-types'
import { formatDate } from '@/lib/compliance'
import { showAlert, showConfirm } from '@/lib/dialog'
import { BTN, BTN_QUIET_SM, FLD, Pill, todayISO } from './ui'

const STATUS: Record<ReportQueueRow['status'], { label: string; className: string }> = {
  queued: { label: 'Waiting to send', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  sending: { label: 'Sending', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  sent: { label: 'Sent', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  failed: { label: 'Failed', className: 'border-red-200 bg-red-50 text-red-700' },
  cancelled: { label: 'Cancelled (checked back in)', className: 'border-border bg-surface text-muted' },
  skipped: { label: 'Not sent', className: 'border-border bg-surface text-muted' },
}

/**
 * The parent daily report for this child: who gets it, what was sent each day, a preview of any day as it would be
 * emailed now, and Resend. Reports go out about 10 minutes after the final check-out, when the center has them on.
 */
export function ReportsPanel({ child, guardians }: { child: Child; guardians: ChildGuardian[] }) {
  const [rows, setRows] = useState<ReportQueueRow[] | null>(null)
  const [settings, setSettings] = useState<ReportSettings | null>(null)
  const [day, setDay] = useState(todayISO())
  const [preview, setPreview] = useState<{ subject: string; html: string; recipients: string[] } | null>(null)
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null)
  const recipients = guardians.filter(g => g.daily_report && g.email)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [h, s] = await Promise.all([loadReportHistory(supabase, child.id), reportSettings(supabase, child.center_id)])
    setRows(h.success ? h.rows : [])
    if (s.success) setSettings(s.settings)
  }, [child.id, child.center_id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function showPreview(d: string) {
    setDay(d)
    setBusy('preview')
    const res = await previewDailyReport(child.center_id, child.id, d)
    setBusy(null)
    if (!res.success) { showAlert(res.error); return }
    setPreview({ subject: res.subject, html: res.html, recipients: res.recipients })
  }

  async function send(d: string) {
    if (!await showConfirm(`Send ${child.first_name}'s report for ${formatDate(d)} now to ${recipients.map(g => g.email).join(', ')}?`, { title: 'Send report', confirmLabel: 'Send' })) return
    setBusy('send')
    const res = await resendReport(createClient(), child.center_id, child.id, d)
    setBusy(null)
    if (!res.success) { showAlert(res.error); return }
    showAlert('Queued. It goes out within a few minutes.')
    load()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-heading">Daily report</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          After {child.first_name} is checked out for the day, the contacts below get an email of the day: arrival and pick-up,
          naps, meals, diapers or bathroom, medicine, activities and approved photos. No staff names. Replies go to the center.
        </p>
        {settings && !settings.enabled && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Daily reports are off for your center. Turn them on from the Live roster.</p>
        )}
        {settings?.enabled && !settings.reply_to && (
          <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-sm text-text-main">Add the center&apos;s email (About) so parents can reply.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Mail className="h-4 w-4 text-brand-600" />
          {recipients.length
            ? recipients.map(g => <span key={g.id} className="rounded-full bg-surface px-2.5 py-0.5 font-semibold text-text-main">{g.name} · {g.email}</span>)
            : <span className="text-muted">Nobody gets it yet. Turn on “Gets the daily report email” for a contact.</span>}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm font-semibold text-text-main">Day
            <input type="date" value={day} max={todayISO()} onChange={e => setDay(e.target.value)} className={`${FLD} mt-1 w-auto`} />
          </label>
          <button onClick={() => showPreview(day)} disabled={!!busy} className={BTN_QUIET_SM}>
            {busy === 'preview' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Preview
          </button>
          <button onClick={() => send(day)} disabled={!!busy || !recipients.length || !settings?.enabled} className={BTN}>
            {busy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send now
          </button>
        </div>
        {preview && (
          <div className="mt-4">
            <p className="text-sm"><span className="font-bold text-heading">{preview.subject}</span>
              <span className="text-muted"> · to {preview.recipients.length ? preview.recipients.join(', ') : 'nobody yet'}</span></p>
            <iframe title="Report preview" srcDoc={preview.html} sandbox="" className="mt-2 h-[560px] w-full rounded-xl border border-border bg-[#f4f6f8]" />
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="border-b border-border px-5 py-3 text-sm font-bold text-heading">Sent</div>
        {!rows ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-brand-600" /></div>
          : rows.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No reports yet.</p> : (
          <ul className="divide-y divide-border">
            {rows.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="w-32 font-semibold text-heading">{formatDate(r.service_date)}</span>
                <Pill className={STATUS[r.status].className}>{STATUS[r.status].label}</Pill>
                <span className="min-w-0 flex-1 text-xs text-muted">
                  {r.status === 'sent' && r.sent_at ? `${new Date(r.sent_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to ${r.recipients.join(', ')}` : ''}
                  {r.status === 'queued' ? `about ${new Date(r.send_after).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
                  {r.last_error ? ` ${r.last_error}` : ''}
                </span>
                <button onClick={() => showPreview(r.service_date)} disabled={!!busy} className={BTN_QUIET_SM}><Eye className="h-3.5 w-3.5" /> View</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

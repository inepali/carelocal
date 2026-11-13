'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Download, Loader2, RefreshCw, Share2, Send } from 'lucide-react'
import { getReviewLink } from '@/app/actions/review-links.actions'
import { showConfirm } from '@/lib/dialog'

/**
 * "Ask for a review": the subject's personal link (/r/<code>) and QR code. A staff member shares theirs with
 * centers and coworkers; a center's owner or admins share theirs with staff (and parents, via the portal).
 * Only people with a real working relationship can submit; that is checked when they do.
 */
export function RequestReviewLinkCard({ subjectType, subjectId }: { subjectType: 'center' | 'staff'; subjectId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [uses, setUses] = useState(0)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(rotate = false) {
    setBusy(true)
    setError(null)
    const res = await getReviewLink(subjectType, subjectId, rotate)
    setBusy(false)
    if ('error' in res) { setError(res.error ?? 'Could not load your link.'); return }
    const link = `${window.location.origin}/r/${res.code}`
    setUrl(link)
    setUses(res.uses)
    setQr(await QRCode.toDataURL(link, { width: 320, margin: 1, color: { dark: '#243746', light: '#ffffff' } }))
  }

  useEffect(() => { load() }, [subjectType, subjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function rotate() {
    const ok = await showConfirm('Make a new link? The old link and QR code will stop working.', { confirmLabel: 'New link' })
    if (ok) load(true)
  }

  async function share() {
    if (!url) return
    const text = subjectType === 'staff'
      ? 'Could you leave me a quick review on CareLocal? It takes a minute.'
      : 'Could you leave our center a quick review on CareLocal? It takes a minute.'
    try {
      if (navigator.share) await navigator.share({ title: 'Care Score review', text, url })
      else { await navigator.clipboard.writeText(`${text} ${url}`); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    } catch { /* cancelled */ }
  }

  const who = subjectType === 'staff' ? 'centers you have worked for and coworkers' : 'your staff (and parents, through your parent portal)'

  return (
    <div className="flex flex-col gap-5 rounded-[1.5rem] border border-border bg-white p-6 sm:flex-row sm:items-center">
      {qr
        // eslint-disable-next-line @next/next/no-img-element -- a data URL generated in the browser
        ? <img src={qr} alt="QR code for your review link" className="h-36 w-36 shrink-0 self-center rounded-xl border border-border" />
        : <div className="flex h-36 w-36 shrink-0 items-center justify-center self-center rounded-xl border border-border bg-surface">{busy && <Loader2 className="h-6 w-6 animate-spin text-muted" />}</div>}
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 font-black text-heading"><Send className="h-5 w-5 text-brand-600" /> Ask for a review</h2>
        <p className="mt-1 text-sm text-muted">
          Send this link to {who}. Only people who work or worked with you in the last 6 months can review, once every 90 days.
        </p>
        {url && <p className="mt-2 truncate rounded-lg bg-surface px-3 py-1.5 font-mono text-xs text-text-main">{url}</p>}
        {uses > 0 && <p className="mt-1 text-xs text-muted">{uses} review{uses === 1 ? '' : 's'} from this link</p>}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={share} disabled={!url} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50">
            <Share2 className="h-3.5 w-3.5" /> {copied ? 'Copied message' : 'Share'}
          </button>
          <button type="button" disabled={!url} onClick={async () => { try { await navigator.clipboard.writeText(url!); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ } }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-text-main hover:bg-surface disabled:opacity-50">
            <Copy className="h-3.5 w-3.5" /> Copy link
          </button>
          {qr && (
            <a href={qr} download="care-score-review-qr.png" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-text-main hover:bg-surface">
              <Download className="h-3.5 w-3.5" /> QR
            </a>
          )}
          <button type="button" onClick={rotate} disabled={busy || !url} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-muted hover:bg-surface disabled:opacity-50">
            <RefreshCw className="h-3.5 w-3.5" /> New link
          </button>
        </div>
      </div>
    </div>
  )
}

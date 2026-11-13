'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Download, QrCode } from 'lucide-react'
import { getParentReviewKey } from '@/app/actions/reviews.actions'

/**
 * Owners and admins: a QR code for the lobby that opens the parent portal's Care Score page. Parents still sign in
 * with their own PIN, so the code only works for families of enrolled children. Hidden when the portal is off.
 */
export function ParentReviewQrCard({ centerId, centerName }: { centerId: string; centerName: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { key } = await getParentReviewKey(centerId)
      if (!key || cancelled) return
      const link = `${window.location.origin}/parent/${key}?to=review`
      setUrl(link)
      setQr(await QRCode.toDataURL(link, { width: 320, margin: 1, color: { dark: '#243746', light: '#ffffff' } }))
    })()
    return () => { cancelled = true }
  }, [centerId])

  if (!url || !qr) return null

  return (
    <div className="flex flex-col gap-5 rounded-[1.5rem] border border-border bg-white p-6 sm:flex-row sm:items-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL generated in the browser */}
      <img src={qr} alt={`QR code: rate ${centerName}`} className="h-36 w-36 shrink-0 self-center rounded-xl border border-border" />
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 font-black text-heading"><QrCode className="h-5 w-5 text-brand-600" /> Ask parents for a rating</h2>
        <p className="mt-1 text-sm text-muted">
          Print this for your lobby or add it to a newsletter. It opens your parent portal; parents sign in with their own PIN,
          so only families with an enrolled child can rate. Each parent can rate once every 90 days.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={qr} download="care-score-qr.png"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700">
            <Download className="h-3.5 w-3.5" /> Download QR
          </a>
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ } }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-text-main hover:bg-surface">
            <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Check, Share2 } from 'lucide-react'

/**
 * Share the jobs page: the phone's share sheet where there is one (text, WhatsApp, Facebook...), otherwise copy
 * the link. Shared links carry utm_source=share so shared visits can be told apart from ads in analytics.
 */
export function ShareJobsButton({ path, label = 'Share these jobs' }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function share() {
    const url = new URL(path, window.location.origin)
    url.searchParams.set('utm_source', 'share')
    url.searchParams.set('utm_medium', 'referral')
    const data = { title: document.title, text: 'Open jobs near you on CareLocal', url: url.toString() }
    try {
      if (navigator.share) { await navigator.share(data); return }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link', url.toString())
    }
  }

  return (
    <button type="button" onClick={share}
      className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-brand-600 hover:bg-brand-50">
      {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />} {copied ? 'Link copied' : label}
    </button>
  )
}

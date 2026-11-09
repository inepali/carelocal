'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCheck, Loader2, Megaphone } from 'lucide-react'
import { parentAcknowledgeAnnouncement } from '@/app/actions/parent-portal.actions'
import type { ReceivedAnnouncement } from '@/lib/announcements'

/** The Notices tab: announcements from the center (newest first), with "I've read this" where asked */
export function Notices({ items, centerName }: { items: ReceivedAnnouncement[]; centerName: string }) {
  const router = useRouter()
  const [acking, setAcking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, start] = useTransition()

  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-white p-4 shadow-sm">
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-text-muted">
          <Megaphone className="h-8 w-8 text-subtle" />
          No announcements from {centerName} in the last 60 days.
        </div>
      </section>
    )
  }

  function ack(id: string) {
    setAcking(id)
    setError(null)
    start(async () => {
      const res = await parentAcknowledgeAnnouncement(id)
      setAcking(null)
      if (!res.ok) setError('Could not save that. Please try again.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-xl bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{error}</p>}
      {items.map(a => (
        <article key={a.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${a.unread ? 'border-brand-600' : 'border-border'}`}>
          {a.urgent && <p className="flex items-center gap-1.5 bg-[#b42318] px-4 py-1.5 text-[11px] font-bold tracking-wide text-white"><AlertTriangle className="h-3 w-3" /> URGENT</p>}
          <div className="p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-bold leading-snug">{a.subject}</h2>
              {a.unread && <span className="shrink-0 rounded-full bg-brand-600 px-2 text-[11px] font-semibold leading-5 text-white">New</span>}
            </div>
            <p className="mt-0.5 text-xs text-muted">
              From {a.sender_label} · {new Date(a.sent_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </p>
            <div className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{a.body}</div>
            {a.requires_ack && (a.acknowledged ? (
              <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#17603f]"><CheckCheck className="h-4 w-4" /> Acknowledged</p>
            ) : (
              <button onClick={() => ack(a.id)} disabled={acking === a.id}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {acking === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />} I’ve read this
              </button>
            ))}
          </div>
        </article>
      ))}
    </div>
  )
}

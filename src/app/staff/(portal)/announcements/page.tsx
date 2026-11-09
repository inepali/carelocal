'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCheck, Loader2, Megaphone } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { loadMyAnnouncements, type ReceivedAnnouncement } from '@/lib/announcements'
import { acknowledgeMyAnnouncement } from '@/app/actions/announcement.actions'

/** Staff: announcements your centers sent you in the last 60 days. Opening this page marks them seen. */
export default function StaffAnnouncementsPage() {
  const supabase = useMemo(() => createClient(), [])
  const [items, setItems] = useState<ReceivedAnnouncement[] | null | undefined>(undefined)
  const [acking, setAcking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadMyAnnouncements(supabase, true).then(list => {
      if (cancelled) return
      setItems(list)
      window.dispatchEvent(new Event('announcements-seen'))
    })
    return () => { cancelled = true }
  }, [supabase])

  async function ack(id: string) {
    setAcking(id)
    setError(null)
    const res = await acknowledgeMyAnnouncement(id)
    setAcking(null)
    if (!res.ok) { setError('Could not save that. Please try again.'); return }
    setItems(prev => prev?.map(a => a.id === id ? { ...a, acknowledged: true } : a))
  }

  return (
    <div className="max-w-3xl pb-24">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-heading mb-2 flex items-center gap-3">
          <Megaphone className="w-8 h-8 text-brand-600" /> Announcements
        </h1>
        <p className="text-muted">Notes from your center to staff, from the last 60 days.</p>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-[#fce4e2] px-4 py-3 text-sm font-semibold text-[#a3221b]">{error}</p>}
      {items === undefined ? (
        <p className="flex items-center gap-2 p-6 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</p>
      ) : items === null ? (
        <p className="rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">Announcements could not be loaded. Please try again later.</p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">No announcements in the last 60 days.</p>
      ) : (
        <div className="space-y-4">
          {items.map(a => (
            <article key={a.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${a.unread ? 'border-brand-600' : 'border-border'}`}>
              {a.urgent && <p className="flex items-center gap-1.5 bg-[#b42318] px-5 py-1.5 text-xs font-bold tracking-wide text-white"><AlertTriangle className="h-3.5 w-3.5" /> URGENT</p>}
              <div className="p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-lg font-bold text-heading">{a.subject}</h2>
                  {a.unread && <span className="shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white">New</span>}
                </div>
                <p className="mt-0.5 text-sm text-muted">
                  {a.center_name} · {a.sender_label} · {new Date(a.sent_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </p>
                <div className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-text-main">{a.body}</div>
                {a.requires_ack && (a.acknowledged ? (
                  <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-[#17603f]"><CheckCheck className="h-4 w-4" /> Acknowledged</p>
                ) : (
                  <button onClick={() => ack(a.id)} disabled={acking === a.id}
                    className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-60">
                    {acking === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />} I’ve read this
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

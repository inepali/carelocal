'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCheck, ChevronRight, Loader2, Megaphone, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { loadAnnouncements, type AnnouncementSummary } from '@/lib/announcements'
import { StatusPill, when } from './shared'

/** The center's announcements, newest first, with a New button */
export function AnnouncementList({ centerId, onNew, onOpen }: { centerId: string; onNew: () => void; onOpen: (id: string) => void }) {
  const supabase = useMemo(() => createClient(), [])
  const [items, setItems] = useState<AnnouncementSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const res = await loadAnnouncements(supabase, centerId)
    if (res.success) { setItems(res.announcements); setError(null) }
    else setError(res.error)
  }, [supabase, centerId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
  }, [reload])

  // Something still sending: check again shortly
  useEffect(() => {
    if (!items?.some(a => a.status === 'sending')) return
    const t = window.setTimeout(reload, 10_000)
    return () => window.clearTimeout(t)
  }, [items, reload])

  return (
    <div className="space-y-4">
      <button onClick={onNew}
        className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-800">
        <Plus className="h-4 w-4" /> New announcement
      </button>

      {error ? (
        <p role="alert" className="rounded-xl bg-[#fce4e2] px-4 py-3 text-sm font-semibold text-[#a3221b]">{error}</p>
      ) : !items ? (
        <p className="flex items-center gap-2 p-6 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-white p-10 text-center shadow-sm">
          <Megaphone className="mx-auto h-10 w-10 text-brand-200" />
          <p className="mt-3 font-bold text-heading">No announcements yet</p>
          <p className="mt-1 text-sm text-muted">Closures, weather delays, events, reminders: write it once and everyone gets it by email.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          {items.map(a => (
            <li key={a.id}>
              <button onClick={() => onOpen(a.id)} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-surface">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.urgent && <span className="inline-flex items-center gap-1 rounded-full bg-[#fce4e2] px-2 py-0.5 text-[11px] font-bold text-[#a3221b]"><AlertTriangle className="h-3 w-3" /> Urgent</span>}
                    <span className="truncate text-base font-bold text-heading">{a.subject}</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted">{a.audience_label} · {when(a.sent_at ?? a.created_at)} · {a.sender_label}</p>
                  <p className="mt-1 text-xs font-semibold text-text-main">
                    {a.sent} of {a.recipient_count} delivered · {a.opened} opened
                    {a.requires_ack && <span className="ml-1 inline-flex items-center gap-1"><CheckCheck className="h-3.5 w-3.5 text-brand-600" />{a.acknowledged} acknowledged</span>}
                    {a.failed > 0 && <span className="ml-1 text-[#a3221b]">· {a.failed} not delivered</span>}
                  </p>
                </div>
                <StatusPill status={a.status} />
                <ChevronRight className="h-5 w-5 shrink-0 text-subtle" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { DELIVERY_LABEL, loadAnnouncement, type AnnouncementDetail, type AnnouncementRecipient } from '@/lib/announcements'
import { StatusPill, when } from './shared'

type Filter = 'all' | 'undelivered' | 'unopened' | 'unacked'

const DELIVERY_STYLE: Record<string, string> = {
  queued: 'text-[#7a4b00]',
  sent: 'text-text-main',
  delivered: 'text-[#17603f]',
  bounced: 'text-[#a3221b]',
  failed: 'text-[#a3221b]',
}

const undelivered = (r: AnnouncementRecipient) => r.status === 'failed' || r.status === 'bounced'

/** One sent announcement: what it said, and for every person whether it was delivered, opened and acknowledged */
export function AnnouncementDetailView({ centerId, id, onBack }: { centerId: string; id: string; onBack: () => void }) {
  const supabase = useMemo(() => createClient(), [])
  const [a, setA] = useState<AnnouncementDetail | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const reload = useCallback(async () => {
    const res = await loadAnnouncement(supabase, centerId, id)
    if (res.success) { setA(res.announcement); setError(null) }
    else setError(res.error)
  }, [supabase, centerId, id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
  }, [reload])

  useEffect(() => {
    if (a?.status !== 'sending') return
    const t = window.setTimeout(reload, 5_000)
    return () => window.clearTimeout(t)
  }, [a, reload])

  const back = (
    <button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-bold text-brand-600 hover:underline">
      <ChevronLeft className="h-4 w-4" /> All announcements
    </button>
  )
  if (error) return <div className="space-y-4">{back}<p role="alert" className="rounded-xl bg-[#fce4e2] px-4 py-3 text-sm font-semibold text-[#a3221b]">{error}</p></div>
  if (a === undefined) return <div className="space-y-4">{back}<p className="flex items-center gap-2 p-6 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</p></div>
  if (a === null) return <div className="space-y-4">{back}<p className="rounded-2xl border border-border bg-white p-10 text-center text-muted">This announcement was not found.</p></div>

  const r = a.recipients
  const sent = r.filter(x => x.status === 'sent' || x.status === 'delivered').length
  const failed = r.filter(undelivered).length
  const opened = r.filter(x => x.opened_at).length
  const acked = r.filter(x => x.acknowledged_at).length
  const shown = r.filter(x =>
    filter === 'undelivered' ? undelivered(x)
      : filter === 'unopened' ? !x.opened_at && !undelivered(x)
        : filter === 'unacked' ? !x.acknowledged_at && !undelivered(x)
          : true)

  const filters: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'Everyone', n: r.length },
    { id: 'undelivered', label: 'Not delivered', n: failed },
    { id: 'unopened', label: 'Not opened', n: r.filter(x => !x.opened_at && !undelivered(x)).length },
    ...(a.requires_ack ? [{ id: 'unacked' as Filter, label: 'Not acknowledged', n: r.filter(x => !x.acknowledged_at && !undelivered(x)).length }] : []),
  ]

  return (
    <div className="space-y-5">
      {back}

      <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {a.urgent && <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-[#fce4e2] px-2 py-0.5 text-[11px] font-bold text-[#a3221b]"><AlertTriangle className="h-3 w-3" /> Urgent</span>}
            <h2 className="text-xl font-extrabold text-heading">{a.subject}</h2>
            <p className="mt-0.5 text-sm text-muted">{a.audience_label} · {when(a.sent_at ?? a.created_at)} · {a.sender_label}</p>
          </div>
          <StatusPill status={a.status} />
        </div>
        <div className="mt-4 whitespace-pre-wrap rounded-xl bg-surface p-4 text-[15px] leading-relaxed text-text-main">{a.body}</div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Delivered" value={`${sent}/${r.length}`} />
        <Stat label="Opened" value={String(opened)} />
        {a.requires_ack ? <Stat label="Acknowledged" value={String(acked)} /> : <Stat label="Not delivered" value={String(failed)} tone={failed ? 'bad' : undefined} />}
        <Stat label="No email" value={String(a.no_email_count)} tone={a.no_email_count ? 'warn' : undefined} />
      </section>
      {a.status === 'sending' && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Still sending. Anything that doesn’t go through is retried for about 30 minutes.</p>}

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex flex-wrap gap-1.5 border-b border-border p-3">
          {filters.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`min-h-9 rounded-full px-3 text-xs font-bold ${filter === f.id ? 'bg-brand-600 text-white' : 'border border-border bg-white text-text-main hover:bg-surface'}`}>
              {f.label} · {f.n}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">Nobody here.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map(x => (
              <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-heading">
                    {x.name} <span className="font-normal text-muted">· {x.kind === 'parent' ? (x.children.length ? `Parent of ${x.children.join(', ')}` : 'Parent') : 'Staff'}</span>
                  </p>
                  <p className="truncate text-xs text-muted">{x.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
                  <span className={DELIVERY_STYLE[x.status ?? 'queued']} title={x.error ?? undefined}>{DELIVERY_LABEL[x.status ?? 'queued']}</span>
                  {x.opened_at && <span className="text-muted">Opened {when(x.opened_at)}</span>}
                  {a.requires_ack && (x.acknowledged_at
                    ? <span className="text-[#17603f]">Acknowledged {when(x.acknowledged_at)}</span>
                    : <span className="text-muted">Not acknowledged</span>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-muted">“Opened” counts the button in the email and the parent page or staff app. Some email apps open links to check them, so a few may show opened early.</p>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${tone === 'bad' ? 'text-[#a3221b]' : tone === 'warn' ? 'text-[#7a4b00]' : 'text-heading'}`}>{value}</p>
    </div>
  )
}

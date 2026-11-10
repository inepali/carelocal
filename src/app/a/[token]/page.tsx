import Link from 'next/link'
import { AlertTriangle, MailX } from 'lucide-react'
import { openAnnouncementLink } from '@/lib/server/announcement-link'
import { AckButton } from './AckButton'

/**
 * /a/<token>: the button in an announcement email. It opens only that announcement, for the person it was sent to,
 * for 30 days, without the PIN or a sign-in. Opening records "opened"; it never acknowledges (mail scanners open
 * links too): the person taps "I've read this" when asked.
 */
export default async function AnnouncementLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const a = await openAnnouncementLink(token)

  if (!a) {
    return (
      <div className="flex min-h-[80dvh] flex-col justify-center">
        <div className="rounded-3xl border border-border bg-white p-6 text-center shadow-sm">
          <MailX className="mx-auto h-10 w-10 text-subtle" />
          <h1 className="mt-3 text-xl font-bold">This link no longer works</h1>
          <p className="mt-1.5 text-sm text-text-muted">Announcement links work for 30 days. Parents can see recent announcements on the parent page; staff in the CareLocal app.</p>
          <Link href="/parent" className="mt-5 inline-block rounded-2xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white">Open the parent page</Link>
        </div>
      </div>
    )
  }

  const sent = new Date(a.sent_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="space-y-4 pt-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{a.center_name} · Announcement</p>
      <article className="overflow-hidden rounded-3xl border border-border bg-white shadow-sm">
        {a.urgent && <p className="flex items-center gap-1.5 bg-[#b42318] px-5 py-2 text-xs font-bold tracking-wide text-white"><AlertTriangle className="h-3.5 w-3.5" /> URGENT</p>}
        <div className="p-5">
          <h1 className="text-xl font-bold leading-snug">{a.subject}</h1>
          <p className="mt-1 text-xs text-muted">From {a.sender_label} · {sent}</p>
          <div className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed">{a.body}</div>
        </div>
      </article>
      {a.requires_ack && <AckButton token={token} acknowledgedAt={a.acknowledged_at} />}
      {a.center_email && (
        <p className="text-center text-xs text-muted">Questions? <a href={`mailto:${a.center_email}`} className="font-semibold text-brand-600">Email {a.center_name}</a></p>
      )}
      {a.kind === 'parent' && (
        <p className="text-center text-xs text-muted">
          <Link href="/parent" className="font-semibold text-brand-600">Open the parent page</Link> with your PIN to see daily activities, photos and past announcements.
        </p>
      )}
    </div>
  )
}

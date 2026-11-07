import Link from 'next/link'
import { MailX } from 'lucide-react'
import { linkHash, loadPortalThread } from '@/lib/server/parent-portal'
import { Conversation } from '../../_components/Messages'

/**
 * /parent/m/<token>: the button in a teacher's email. It opens only that one conversation (read, acknowledge,
 * reply) without the access code, for 30 days. Daily activities and photos still need the code, so a forwarded
 * email shows nothing more than the conversation itself. Opening the page never acknowledges anything by itself
 * (mail scanners open links too); the parent taps Acknowledge.
 */
export default async function ParentMessageLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const hash = linkHash(token)
  const thread = hash ? await loadPortalThread({ linkHash: hash }, null) : null

  if (!thread) {
    return (
      <div className="flex min-h-[80dvh] flex-col justify-center">
        <div className="rounded-3xl border border-border bg-white p-6 text-center shadow-sm">
          <MailX className="mx-auto h-10 w-10 text-subtle" />
          <h1 className="mt-3 text-xl font-bold">This link no longer works</h1>
          <p className="mt-1.5 text-sm text-text-muted">Email links work for 30 days. Open the parent page with your access code to see all your messages.</p>
          <Link href="/parent" className="mt-5 inline-block rounded-2xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white">Open the parent page</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-4">
      <Conversation thread={thread} link={token} />
      <p className="mt-6 text-center text-xs text-muted">
        <Link href="/parent" className="font-semibold text-brand-600">Open the parent page</Link> with your access code to see daily activities and photos.
      </p>
    </div>
  )
}

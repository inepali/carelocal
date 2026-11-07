'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CheckCheck, Loader2, Send } from 'lucide-react'
import { parentAcknowledge, parentSendMessage } from '@/app/actions/parent-portal.actions'
import type { PortalThread } from '@/lib/server/parent-portal'

const MAX = 2000

function stamp(iso: string) {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * One conversation on the parent page: the center's messages on the left, the parent's on the right,
 * Acknowledge on messages sent to this parent, and a reply box. link: the email link token, when the page was
 * opened from an email (then only this conversation can be reached).
 */
export function Conversation({ thread, link }: { thread: PortalThread; link?: string | null }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const [acking, setAcking] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || pending) return
    setError(null)
    startTransition(async () => {
      const res = await parentSendMessage({ link, threadId: thread.id, body: body.trim(), key })
      if (!res.ok) { setError(res.error); return }
      setBody('')
      setKey(crypto.randomUUID())
      router.refresh()
    })
  }

  function ack(id: string) {
    setAcking(id)
    startTransition(async () => {
      const res = await parentAcknowledge({ link, messageId: id })
      setAcking(null)
      if (!res.ok) setError('Could not acknowledge. Please try again.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">About {thread.child.first_name} · {thread.center.name}</p>
        <h1 className="mt-1 text-xl font-bold">{thread.subject}</h1>
      </div>

      <ol className="space-y-3">
        {thread.messages.map(m => (
          <li key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${m.mine ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md border border-border bg-white'}`}>
              <p className={`mb-1 text-xs font-semibold ${m.mine ? 'text-white/80' : 'text-muted'}`}>{m.from} · {stamp(m.at)}</p>
              <p className="whitespace-pre-wrap text-[15px] leading-snug">{m.body}</p>
              {m.mine && m.seen_by_center && <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-white/80"><CheckCheck className="h-3.5 w-3.5" /> Seen by the center</p>}
              {!m.from_parent && m.to_me && (
                m.acknowledged_at
                  ? <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-emerald-700"><Check className="h-3.5 w-3.5" /> Acknowledged</p>
                  : <button type="button" onClick={() => ack(m.id)} disabled={pending}
                      className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-brand-600 px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                      {acking === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Acknowledge
                    </button>
              )}
            </div>
          </li>
        ))}
      </ol>

      <form onSubmit={send} className="rounded-2xl border border-border bg-white p-3 shadow-sm">
        <label htmlFor="reply" className="sr-only">Reply</label>
        <textarea id="reply" value={body} onChange={e => setBody(e.target.value)} maxLength={MAX} rows={3}
          placeholder={`Reply to ${thread.center.name}`}
          className="w-full resize-none rounded-xl border-0 bg-transparent px-1 py-1 text-[15px] outline-none placeholder:text-subtle" />
        {error && <p role="alert" className="px-1 pb-2 text-sm font-medium text-red-600">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="px-1 text-[11px] text-muted">Your child’s teachers and the director see your reply.</span>
          <button type="submit" disabled={!body.trim() || pending}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {pending && !acking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
          </button>
        </div>
      </form>
    </div>
  )
}

/** Start a new message to the child's teachers (the director gets a copy) */
export function NewMessageForm({ childId, childName, centerName }: { childId: string; childName: string; centerName: string }) {
  const router = useRouter()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [key] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || pending) return
    setError(null)
    startTransition(async () => {
      const res = await parentSendMessage({ childId, subject: subject.trim(), body: body.trim(), key })
      if (!res.ok) { setError(res.error); return }
      router.push(`/parent?child=${childId}&tab=messages&thread=${res.id}`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={send} className="space-y-3 rounded-2xl border border-border bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold">Message {childName}’s teachers</h2>
      <p className="text-sm text-text-muted">Your message goes to {childName}’s teachers at {centerName}, and the director gets a copy. For anything urgent, please call the center.</p>
      <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={120} placeholder={`Subject (optional): A note about ${childName}`}
        aria-label="Subject" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[15px] outline-none focus:border-brand-600" />
      <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={MAX} rows={5} placeholder="Write your message" aria-label="Message" autoFocus
        className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-[15px] outline-none focus:border-brand-600" />
      {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <a href={`/parent?child=${childId}&tab=messages`} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-text-muted hover:bg-surface">Cancel</a>
        <button type="submit" disabled={!body.trim() || pending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
        </button>
      </div>
    </form>
  )
}

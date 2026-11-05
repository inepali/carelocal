'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Mail } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MESSAGE_MAX, MESSAGE_STATUS_LABEL, MESSAGE_TEMPLATES, SUBJECT_MAX, loadMessageContacts, loadParentMessages,
  type MessageContact, type ParentMessage,
} from '@/lib/parent-messages'
import { newKey } from '@/lib/daily'
import { sendParentMessage } from '@/app/actions/parent-message.actions'
import { FIELD } from './DailyForms'

const when = (iso: string) => {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const STATUS_STYLE: Record<ParentMessage['status'], string> = {
  sending: 'bg-[#fff0d1] text-[#7a4b00]',
  sent: 'bg-[#e2f2ea] text-[#17603f]',
  partial: 'bg-[#fff0d1] text-[#7a4b00]',
  failed: 'bg-[#fce4e2] text-[#a3221b]',
}

/**
 * Message to parent, inside the child card: pick one or more of the child's authorized pick-up contacts (primary
 * contact checked to start; contacts without an email are shown but cannot be picked), write a note or start from
 * a template, and send. Emails go out from the center; replies go to the center's email.
 */
export function ParentMessageForm({ supabase, centerId, childId, childName, onSent, onCancel }: {
  supabase: SupabaseClient
  centerId: string
  childId: string
  childName: string
  onSent: (delivered: boolean) => void
  onCancel: () => void
}) {
  const [contacts, setContacts] = useState<MessageContact[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key per message being written: tapping Send again after a timeout sends it once
  const [key] = useState(newKey)

  useEffect(() => {
    let cancelled = false
    loadMessageContacts(supabase, centerId, childId).then(res => {
      if (cancelled) return
      if (!res.success) { setLoadError(res.error); return }
      setContacts(res.contacts)
      const primary = res.contacts.filter(c => c.has_email && c.is_primary).map(c => c.id)
      const first = res.contacts.find(c => c.has_email)
      setPicked(new Set(primary.length ? primary : first ? [first.id] : []))
    })
    return () => { cancelled = true }
  }, [supabase, centerId, childId])

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  async function send() {
    setBusy(true)
    setError(null)
    const res = await sendParentMessage({ centerId, childId, guardianIds: [...picked], subject: subject.trim(), body: body.trim(), key })
    setBusy(false)
    if (!res.success) { setError(res.error); return }
    onSent(res.delivered)
  }

  const reachable = contacts?.filter(c => c.has_email) ?? []
  const ready = picked.size > 0 && body.trim().length > 0 && !busy

  return (
    <form className="flex flex-col gap-4 rounded-2xl border border-border bg-surface/40 p-3" onSubmit={e => { e.preventDefault(); if (ready) send() }}>
      <p className="text-base font-bold text-heading">Message to parent</p>

      <fieldset>
        <legend className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">Send to</legend>
        {loadError ? (
          <p role="alert" className="text-sm font-semibold text-[#a3221b]">{loadError}</p>
        ) : !contacts ? (
          <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading contacts…</p>
        ) : contacts.length === 0 ? (
          <p className="text-sm text-muted">{childName} has no authorized pick-up contacts who can get messages. A director can add them in the child’s file.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {contacts.map(c => {
              const on = picked.has(c.id)
              return (
                <button key={c.id} type="button" role="checkbox" aria-checked={on} disabled={!c.has_email} onClick={() => toggle(c.id)}
                  className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left ${on ? 'border-brand-600 bg-brand-50' : 'border-border bg-white hover:bg-surface'} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white`}>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300 bg-white'}`}>
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-heading">{c.name}{c.is_primary ? ' · Primary' : ''}</span>
                    <span className="block text-xs text-muted">{c.has_email ? (c.relationship || 'Authorized pick-up') : 'No email on file'}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </fieldset>

      {reachable.length > 0 && (
        <>
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">Start from</p>
            <div className="flex flex-wrap gap-1.5">
              {MESSAGE_TEMPLATES.map(t => (
                <button key={t.label} type="button" onClick={() => { setSubject(t.subject); setBody(t.body(childName)) }}
                  className="min-h-9 rounded-full border border-border bg-white px-3 text-xs font-bold text-text-main hover:bg-surface">
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={SUBJECT_MAX} className={FIELD}
            placeholder={`Subject (optional): A note about ${childName}`} aria-label="Subject" />
          <div>
            <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={MESSAGE_MAX} rows={5} autoFocus
              className={`${FIELD} resize-none py-2`} placeholder="Write your message" aria-label="Message" />
            <p className="mt-1 flex justify-between text-[11px] text-muted">
              <span>Sent from the center. Replies go to the center’s email.</span>
              <span>{body.length}/{MESSAGE_MAX}</span>
            </p>
          </div>
        </>
      )}

      {error && <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-12 rounded-xl border border-border bg-white text-sm font-bold text-text-main hover:bg-surface">Cancel</button>
        <button type="submit" disabled={!ready}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send{picked.size > 1 ? ` to ${picked.size}` : ''}
        </button>
      </div>
    </form>
  )
}

/** The child's recent messages: who sent what, to whom, and whether it was delivered */
export function ParentMessageList({ supabase, centerId, childId, refreshKey }: {
  supabase: SupabaseClient
  centerId: string
  childId: string
  refreshKey: number
}) {
  const [messages, setMessages] = useState<ParentMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const res = await loadParentMessages(supabase, centerId, childId, 10)
    if (res.success) { setMessages(res.messages); setError(null) }
    else setError(res.error)
  }, [supabase, centerId, childId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
  }, [reload, refreshKey])

  // A message still sending: check again shortly
  useEffect(() => {
    if (!messages?.some(m => m.status === 'sending')) return
    const t = window.setTimeout(reload, 15_000)
    return () => window.clearTimeout(t)
  }, [messages, reload])

  if (error) return <p className="text-sm text-[#a3221b]">{error}</p>
  if (!messages) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
  if (messages.length === 0) return <p className="text-sm text-muted">No messages yet.</p>

  return (
    <ol className="flex flex-col divide-y divide-border rounded-xl border border-border">
      {messages.map(m => (
        <li key={m.id}>
          <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}
            className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm hover:bg-surface">
            <span className="w-16 shrink-0 pt-0.5 text-xs font-semibold text-muted">{when(m.created_at)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold text-heading">{m.subject}</span>
              <span className="block truncate text-xs text-muted">To {m.recipients.map(r => r.name).join(', ')} · from {m.sender_label}</span>
            </span>
            <span className={`shrink-0 rounded-full px-2 text-[11px] font-bold ${STATUS_STYLE[m.status]}`}>{MESSAGE_STATUS_LABEL[m.status]}</span>
          </button>
          {open === m.id && (
            <div className="px-3 pb-3 pl-[88px] text-sm">
              <p className="whitespace-pre-wrap text-text-main">{m.body}</p>
              {m.status !== 'sent' && (
                <p className="mt-1 text-xs text-muted">
                  {m.recipients.map(r => `${r.name}: ${r.status === 'sent' ? 'delivered' : r.status === 'failed' ? 'not delivered' : 'trying again'}`).join(' · ')}
                </p>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

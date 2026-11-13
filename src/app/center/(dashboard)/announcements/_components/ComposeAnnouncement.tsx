'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CheckCheck, ChevronDown, ChevronLeft, FlaskConical, Loader2, Mail, MessageSquare, Send, Smartphone, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { newKey } from '@/lib/daily'
import { showAlert, showConfirm } from '@/lib/dialog'
import {
  ANNOUNCEMENT_TEMPLATES, BODY_MAX, SUBJECT_MAX, previewAudience, type Audience, type AudiencePreview,
} from '@/lib/announcements'
import { sendAnnouncement, sendAnnouncementTest } from '@/app/actions/announcement.actions'
import { FIELD } from './shared'

type ParentsChoice = 'none' | 'all' | 'classes'
type StaffChoice = 'none' | 'all' | 'regular'
type Room = { id: string; name: string }

/**
 * Write an announcement: pick who gets it (parents of everyone or of chosen classes, and/or staff), see who that
 * is right now, write it (or start from a template), mark it urgent or ask people to acknowledge it, send a test
 * to yourself, then send. Email only for now; GroupMe and text messages are shown as coming.
 */
export function ComposeAnnouncement({ centerId, childcare, onCancel, onSent }: {
  centerId: string
  childcare: boolean
  onCancel: () => void
  onSent: (id: string) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [rooms, setRooms] = useState<Room[]>([])
  const [parents, setParents] = useState<ParentsChoice>(childcare ? 'all' : 'none')
  const [classes, setClasses] = useState<Set<string>>(new Set())
  const [staff, setStaff] = useState<StaffChoice>(childcare ? 'none' : 'all')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [requiresAck, setRequiresAck] = useState(false)
  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [showPeople, setShowPeople] = useState(false)
  const [busy, setBusy] = useState<'send' | 'test' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One key per announcement being written: pressing Send again after a timeout sends it once
  const [key] = useState(newKey)

  useEffect(() => {
    if (!childcare) return
    let cancelled = false
    supabase.from('work_areas').select('id, name, is_active').eq('center_id', centerId).order('sort_order').order('name')
      .then(({ data }) => {
        if (!cancelled) setRooms(((data ?? []) as (Room & { is_active?: boolean })[]).filter(r => r.is_active !== false))
      })
    return () => { cancelled = true }
  }, [supabase, centerId, childcare])

  const audience: Audience | null = useMemo(() => {
    const a: Audience = {}
    if (parents === 'all') a.parents = 'all'
    if (parents === 'classes' && classes.size > 0) a.parents = { classes: [...classes] }
    if (staff !== 'none') a.staff = staff
    return Object.keys(a).length ? a : null
  }, [parents, classes, staff])
  const audienceKey = JSON.stringify(audience)

  // Who that group is right now (debounced while picking classes)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!audience) { setPreview(null); setPreviewError(null); return }
    let cancelled = false
    setPreviewing(true)
    const t = window.setTimeout(async () => {
      const res = await previewAudience(supabase, centerId, audience)
      if (cancelled) return
      setPreviewing(false)
      if (res.success) { setPreview(res.preview); setPreviewError(null) }
      else { setPreview(null); setPreviewError(res.error) }
    }, 300)
    return () => { cancelled = true; window.clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, centerId, audienceKey])

  const toggleClass = (id: string) => setClasses(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const count = preview?.total ?? 0
  const ready = !!audience && !!preview && count > 0 && subject.trim().length > 0 && body.trim().length > 0 && !busy && !previewing

  async function test() {
    setBusy('test')
    setError(null)
    const res = await sendAnnouncementTest({ centerId, subject: subject.trim(), body: body.trim(), urgent, requiresAck })
    setBusy(null)
    if (!res.success) { setError(res.error); return }
    showAlert(`A test copy is on its way to ${res.to}.`, { title: 'Test sent' })
  }

  async function send() {
    if (!audience || !preview) return
    const who = `${count} ${count === 1 ? 'person' : 'people'}`
    const ok = await showConfirm(
      `Email “${subject.trim()}” to ${who} (${preview.label})?${preview.no_email ? ` ${preview.no_email} in this group have no email and won’t get it.` : ''} This can’t be undone.`,
      { title: urgent ? 'Send urgent announcement' : 'Send announcement', confirmLabel: `Send to ${who}` },
    )
    if (!ok) return
    setBusy('send')
    setError(null)
    const res = await sendAnnouncement({ centerId, subject: subject.trim(), body: body.trim(), audience, urgent, requiresAck, key })
    setBusy(null)
    if (!res.success) { setError(res.error); return }
    onSent(res.id)
  }

  return (
    <form className="space-y-6" onSubmit={e => { e.preventDefault(); if (ready) send() }}>
      <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 text-sm font-bold text-brand-600 hover:underline">
        <ChevronLeft className="h-4 w-4" /> All announcements
      </button>

      {/* Who */}
      <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted">Send to</h2>
        <div className="grid gap-5 md:grid-cols-2">
          {childcare && (
            <fieldset>
              <legend className="mb-2 text-sm font-bold text-heading">Parents</legend>
              <div className="flex flex-col gap-1.5">
                <Choice on={parents === 'none'} onClick={() => setParents('none')} label="No parents" />
                <Choice on={parents === 'all'} onClick={() => setParents('all')} label="All parents" hint="Every enrolled child’s contacts" />
                <Choice on={parents === 'classes'} onClick={() => setParents('classes')} label="Parents of chosen classes" />
              </div>
              {parents === 'classes' && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {rooms.length === 0 && <p className="text-sm text-muted">No classes yet.</p>}
                  {rooms.map(r => {
                    const on = classes.has(r.id)
                    return (
                      <button key={r.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggleClass(r.id)}
                        className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-text-main hover:bg-surface'}`}>
                        {on && <Check className="h-3.5 w-3.5" />}{r.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </fieldset>
          )}
          <fieldset>
            <legend className="mb-2 text-sm font-bold text-heading">Staff</legend>
            <div className="flex flex-col gap-1.5">
              <Choice on={staff === 'none'} onClick={() => setStaff('none')} label="No staff" />
              <Choice on={staff === 'all'} onClick={() => setStaff('all')} label="All active staff" hint="Full-time, part-time and substitutes" />
              <Choice on={staff === 'regular'} onClick={() => setStaff('regular')} label="Full-time and part-time only" />
            </div>
          </fieldset>
        </div>

        {/* Who that is right now */}
        <div className="mt-5 rounded-xl bg-surface px-4 py-3">
          {!audience ? (
            <p className="text-sm text-muted">Pick at least one group.</p>
          ) : previewing && !preview ? (
            <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Counting…</p>
          ) : previewError ? (
            <p role="alert" className="text-sm font-semibold text-[#a3221b]">{previewError}</p>
          ) : preview && (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Users className="h-5 w-5 text-brand-600" />
                <span className="text-sm font-bold text-heading">
                  {preview.total} {preview.total === 1 ? 'person' : 'people'}
                  {childcare && <span className="font-semibold text-muted"> · {preview.parents} parents · {preview.staff} staff</span>}
                </span>
                {preview.no_email > 0 && <span className="text-xs font-semibold text-[#7a4b00]">{preview.no_email} without email won’t get it</span>}
                {previewing && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
                {preview.people.length > 0 && (
                  <button type="button" onClick={() => setShowPeople(s => !s)} className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-brand-600">
                    {showPeople ? 'Hide' : 'See who'} <ChevronDown className={`h-3.5 w-3.5 transition ${showPeople ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>
              {showPeople && (
                <ul className="mt-3 max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-white text-sm">
                  {preview.people.map((p, i) => (
                    <li key={`${p.email ?? 'none'}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="truncate font-semibold text-heading">{p.name} <span className="font-normal text-muted">· {p.kind === 'parent' ? 'Parent' : 'Staff'}</span></span>
                      <span className={`truncate text-xs ${p.email ? 'text-muted' : 'font-semibold text-[#7a4b00]'}`}>{p.email ?? 'No email'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>

      {/* What */}
      <section className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">Start from</p>
          <div className="flex flex-wrap gap-1.5">
            {ANNOUNCEMENT_TEMPLATES.map(t => (
              <button key={t.label} type="button"
                onClick={() => { setSubject(t.subject); setBody(t.body); setUrgent(!!t.urgent); setRequiresAck(!!t.ack) }}
                className="min-h-9 rounded-full border border-border bg-white px-3 text-xs font-bold text-text-main hover:bg-surface">
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={SUBJECT_MAX} className={FIELD}
          placeholder="Subject" aria-label="Subject" />
        <div>
          <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={BODY_MAX} rows={8}
            className={`${FIELD} resize-y py-2 leading-relaxed`} placeholder="Write your announcement" aria-label="Message" />
          <p className="mt-1 flex justify-between text-[11px] text-muted">
            <span>Replace anything in [brackets]. Replies go to the center’s email.</span>
            <span>{body.length}/{BODY_MAX}</span>
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle on={urgent} onClick={() => setUrgent(v => !v)} icon={AlertTriangle} label="Urgent"
            hint="Marked urgent in the subject and at the top" />
          <Toggle on={requiresAck} onClick={() => setRequiresAck(v => !v)} icon={CheckCheck} label="Ask to acknowledge"
            hint="People tap “I’ve read this”; you see who did" />
        </div>
      </section>

      {/* How */}
      <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">Send by</h2>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-brand-600 bg-brand-50 px-3 text-sm font-bold text-brand-700"><Mail className="h-4 w-4" /> Email</span>
          <span className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold text-muted opacity-60" title="Coming soon"><MessageSquare className="h-4 w-4" /> GroupMe · soon</span>
          <span className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold text-muted opacity-60" title="Coming soon"><Smartphone className="h-4 w-4" /> Text message · soon</span>
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl bg-[#fce4e2] px-4 py-3 text-sm font-semibold text-[#a3221b]">{error}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className="min-h-12 rounded-xl border border-border bg-white px-5 text-sm font-bold text-text-main hover:bg-surface">Cancel</button>
        <button type="button" onClick={test} disabled={!subject.trim() || !body.trim() || !!busy}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-white px-5 text-sm font-bold text-text-main hover:bg-surface disabled:opacity-50">
          {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Send test to me
        </button>
        <button type="submit" disabled={!ready}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
          {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {count > 0 ? `Send to ${count} ${count === 1 ? 'person' : 'people'}` : 'Send'}
        </button>
      </div>
    </form>
  )
}

function Choice({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 text-left ${on ? 'border-brand-600 bg-brand-50' : 'border-border bg-white hover:bg-surface'}`}>
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-brand-600' : 'border-gray-300'}`}>
        {on && <span className="h-2 w-2 rounded-full bg-brand-600" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-heading">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </button>
  )
}

function Toggle({ on, onClick, icon: Icon, label, hint }: { on: boolean; onClick: () => void; icon: typeof Mail; label: string; hint: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick}
      className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 text-left ${on ? 'border-brand-600 bg-brand-50' : 'border-border bg-white hover:bg-surface'}`}>
      <Icon className={`h-5 w-5 shrink-0 ${on ? 'text-brand-600' : 'text-subtle'}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-heading">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-brand-600' : 'bg-slate-200'}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </span>
    </button>
  )
}

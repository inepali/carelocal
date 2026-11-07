'use client'

import { useState } from 'react'
import { Check, Copy, KeyRound, Loader2, Mail, Shuffle } from 'lucide-react'
import type { Child, ChildGuardian } from '@/lib/child-types'
import { emailParentPin, issueParentPin, revokeParentAccess, type ContactAccess } from '@/app/actions/parent-access.actions'
import { formatPin, weakPinReason } from '@/lib/parent-code'
import { showAlert, showConfirm } from '@/lib/dialog'
import { BTN_PRIMARY, BTN_QUIET, FLD, Modal } from './ui'

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : 'Never'

/**
 * Parent page access for one contact: a 6-digit PIN, typed by the admin or picked by CareLocal, used on the
 * center's own link. The PIN is shown here once (it is not stored), with Copy and Email. One PIN covers the
 * contact's other children at the center when their contact rows have the same email.
 */
export function ParentAccessDialog({ child, guardian, access, linkKey, onClose, onChanged }: {
  child: Child
  guardian: ChildGuardian
  access: ContactAccess | undefined
  linkKey: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<'issue' | 'revoke' | 'email' | null>(null)
  const [mode, setMode] = useState<'pick' | 'type'>('pick')
  const [typed, setTyped] = useState('')
  const [pin, setPin] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)
  const [copied, setCopied] = useState(false)
  const [emailedTo, setEmailedTo] = useState<string | null>(null)
  const has = !!access?.has_access
  const link = typeof window === 'undefined' || !linkKey ? `/parent/${linkKey ?? ''}` : `${window.location.origin}/parent/${linkKey}`
  const typedDigits = typed.replace(/\D/g, '').slice(0, 6)
  const typedProblem = mode === 'type' && typedDigits.length === 6 ? weakPinReason(typedDigits) : null

  async function issue() {
    if (mode === 'type' && (typedDigits.length !== 6 || typedProblem)) return
    if (has && !await showConfirm(
      `Set a new PIN for ${guardian.name}? The current PIN stops working and every phone signed in with it is signed out.`,
      { title: 'New PIN', confirmLabel: 'Set new PIN' },
    )) return
    setBusy('issue')
    const res = await issueParentPin(child.center_id, guardian.id, mode === 'type' ? typedDigits : null)
    setBusy(null)
    if (!res.success) { showAlert(res.error); return }
    if (res.newCode) setPin(res.pin)
    else setJoined(true)
    setTyped('')
    setEmailedTo(null)
    onChanged()
  }

  async function revoke() {
    if (!await showConfirm(
      `Turn off the parent page for ${guardian.name}? Their PIN stops working and every phone signed in with it is signed out${access?.also_covers.length ? `, for ${access.also_covers.join(' and ')} too` : ''}.`,
      { title: 'Turn off access', confirmLabel: 'Turn off', tone: 'danger' },
    )) return
    setBusy('revoke')
    const res = await revokeParentAccess(child.center_id, guardian.id)
    setBusy(null)
    if (!res.success) { showAlert(res.error); return }
    setPin(null)
    onChanged()
    onClose()
  }

  async function email() {
    if (!pin) return
    setBusy('email')
    const res = await emailParentPin(child.center_id, guardian.id, pin)
    setBusy(null)
    if (!res.success) { showAlert(res.error); return }
    setEmailedTo(res.email)
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showAlert(text)
    }
  }

  return (
    <Modal title={`Parent page · ${guardian.name}`} onClose={onClose} footer={<button onClick={onClose} className={BTN_QUIET}>Done</button>}>
      <div className="space-y-4 text-sm">
        {pin ? (
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">PIN for {guardian.name}</p>
            <p className="mt-2 select-all font-mono text-4xl font-bold tracking-[0.25em] text-text-main">{formatPin(pin)}</p>
            <p className="mt-3 text-xs text-text-muted">They open <b className="break-all">{link}</b> and enter this PIN. It is shown only now: copy or email it before closing.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button onClick={() => copy(`${link}\nPIN: ${pin}`)} className={BTN_QUIET}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link and PIN'}</button>
              {guardian.email
                ? <button onClick={email} disabled={busy === 'email' || !!emailedTo} className={BTN_PRIMARY}>
                    {busy === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : emailedTo ? <Check className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                    {emailedTo ? `Emailed to ${emailedTo}` : `Email to ${guardian.email}`}
                  </button>
                : <span className="self-center text-xs text-muted">Add an email to this contact to send it by email.</span>}
            </div>
          </div>
        ) : joined ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
            {guardian.name} already has a PIN for another child with the same email. That PIN now shows {child.first_name} too; nothing new to send.
          </div>
        ) : null}

        {has ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl border border-border bg-surface p-4">
            <dt className="text-muted">PIN</dt><dd className="font-mono font-semibold">••• •••</dd>
            <dt className="text-muted">Set</dt><dd>{when(access!.issued_at)}</dd>
            <dt className="text-muted">Last sign-in</dt><dd>{when(access!.last_login_at)}</dd>
            <dt className="text-muted">Phones signed in</dt><dd>{access!.devices}</dd>
            {access!.also_covers.length > 0 && <><dt className="text-muted">Also shows</dt><dd>{access!.also_covers.join(', ')}</dd></>}
          </dl>
        ) : !pin && (
          <div className="flex gap-3 rounded-2xl border border-border bg-surface p-4 text-text-muted">
            <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <p>
              Give {guardian.name} a 6-digit PIN to see {child.first_name}’s daily activities and photos and to message the teachers. No account needed.
              {guardian.email ? ' Their other children here with the same contact email are included.' : ''}
            </p>
          </div>
        )}

        <div className="space-y-3 rounded-2xl border border-border p-4">
          <div role="radiogroup" aria-label="How to set the PIN" className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1 text-sm font-semibold">
            {(['pick', 'type'] as const).map(m => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className={`rounded-lg py-2 ${mode === m ? 'bg-white text-text-main shadow-sm' : 'text-muted'}`}>
                {m === 'pick' ? 'Pick one for me' : 'Type a PIN'}
              </button>
            ))}
          </div>
          {mode === 'type' && (
            <div>
              <input value={typedDigits} onChange={e => setTyped(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={6}
                placeholder="6 digits" aria-label="PIN" aria-invalid={!!typedProblem}
                className={`${FLD} text-center font-mono text-2xl tracking-[0.3em]`} />
              {typedProblem && <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{typedProblem}</p>}
              <p className="mt-1.5 text-xs text-muted">Each family at your center needs a different PIN. Easy ones like 123456 are not allowed.</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={issue} disabled={!!busy || (mode === 'type' && (typedDigits.length !== 6 || !!typedProblem))} className={BTN_PRIMARY}>
              {busy === 'issue' ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'pick' ? <Shuffle className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
              {has ? 'Set a new PIN' : 'Set PIN'}
            </button>
            {has && (
              <button onClick={revoke} disabled={!!busy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">
                {busy === 'revoke' && <Loader2 className="h-4 w-4 animate-spin" />} Turn off access
              </button>
            )}
          </div>
        </div>

        {linkKey && (
          <div className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-xs text-text-muted">
            <span className="shrink-0 font-semibold">Center link</span>
            <span className="min-w-0 flex-1 truncate font-mono">{link}</span>
            <button type="button" onClick={() => copy(link)} className="shrink-0 rounded-lg p-1.5 hover:bg-white" aria-label="Copy center link"><Copy className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>
    </Modal>
  )
}

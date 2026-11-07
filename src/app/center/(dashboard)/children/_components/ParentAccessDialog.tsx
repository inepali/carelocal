'use client'

import { useState } from 'react'
import { Check, Copy, KeyRound, Loader2, Mail } from 'lucide-react'
import type { Child, ChildGuardian } from '@/lib/child-types'
import { emailParentCode, issueParentCode, revokeParentAccess, type ContactAccess } from '@/app/actions/parent-access.actions'
import { showAlert, showConfirm } from '@/lib/dialog'
import { BTN_PRIMARY, BTN_QUIET, Modal } from './ui'

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : 'Never'

/**
 * Parent page access for one contact: make a code, make a new one, or turn it off. A new code is shown here
 * once (it is not stored), with Copy and Email. One code covers the contact's other children at the center when
 * their contact rows have the same email.
 */
export function ParentAccessDialog({ child, guardian, access, onClose, onChanged }: {
  child: Child
  guardian: ChildGuardian
  access: ContactAccess | undefined
  onClose: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<'issue' | 'revoke' | 'email' | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)
  const [copied, setCopied] = useState(false)
  const [emailedTo, setEmailedTo] = useState<string | null>(null)
  const has = !!access?.has_access
  const portalUrl = typeof window === 'undefined' ? '/parent' : `${window.location.origin}/parent`

  async function issue() {
    if (has && !await showConfirm(
      `Make a new code for ${guardian.name}? The current code (ending ${access?.code_hint}) stops working and every phone signed in with it is signed out.`,
      { title: 'New access code', confirmLabel: 'Make new code' },
    )) return
    setBusy('issue')
    const res = await issueParentCode(child.center_id, guardian.id)
    setBusy(null)
    if (!res.success) { showAlert(res.error); return }
    if (res.newCode) setCode(res.code)
    else setJoined(true)
    setEmailedTo(null)
    onChanged()
  }

  async function revoke() {
    if (!await showConfirm(
      `Turn off the parent page for ${guardian.name}? Their code stops working and every phone signed in with it is signed out${access?.also_covers.length ? `, for ${access.also_covers.join(' and ')} too` : ''}.`,
      { title: 'Turn off access', confirmLabel: 'Turn off', tone: 'danger' },
    )) return
    setBusy('revoke')
    const res = await revokeParentAccess(child.center_id, guardian.id)
    setBusy(null)
    if (!res.success) { showAlert(res.error); return }
    setCode(null)
    onChanged()
    onClose()
  }

  async function email() {
    if (!code) return
    setBusy('email')
    const res = await emailParentCode(child.center_id, guardian.id, code)
    setBusy(null)
    if (!res.success) { showAlert(res.error); return }
    setEmailedTo(res.email)
  }

  async function copy() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(`${code}\n${portalUrl}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showAlert(`Copy did not work. The code is ${code}.`)
    }
  }

  return (
    <Modal title={`Parent page · ${guardian.name}`} onClose={onClose} footer={<button onClick={onClose} className={BTN_QUIET}>Done</button>}>
      <div className="space-y-4 text-sm">
        {code ? (
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Access code for {guardian.name}</p>
            <p className="mt-2 select-all font-mono text-3xl font-bold tracking-[0.18em] text-text-main">{code}</p>
            <p className="mt-2 text-xs text-text-muted">They open <b>{portalUrl}</b> and enter this code. It is shown only now: copy or email it before closing.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button onClick={copy} className={BTN_QUIET}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}</button>
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
            {guardian.name} already has a code for another child with the same email. That code now shows {child.first_name} too; nothing new to send.
          </div>
        ) : null}

        {has ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl border border-border bg-surface p-4">
            <dt className="text-muted">Code</dt><dd className="font-mono font-semibold">••••-{access!.code_hint}</dd>
            <dt className="text-muted">Made</dt><dd>{when(access!.issued_at)}</dd>
            <dt className="text-muted">Last sign-in</dt><dd>{when(access!.last_login_at)}</dd>
            <dt className="text-muted">Phones signed in</dt><dd>{access!.devices}</dd>
            {access!.also_covers.length > 0 && <><dt className="text-muted">Also shows</dt><dd>{access!.also_covers.join(', ')}</dd></>}
          </dl>
        ) : !code && (
          <div className="flex gap-3 rounded-2xl border border-border bg-surface p-4 text-text-muted">
            <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <p>
              Give {guardian.name} an access code to see {child.first_name}’s daily activities and photos on the parent page. No account needed.
              {guardian.email ? ' Their other children here with the same contact email are included.' : ''}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={issue} disabled={!!busy} className={BTN_PRIMARY}>
            {busy === 'issue' && <Loader2 className="h-4 w-4 animate-spin" />} {has ? 'Make a new code' : 'Create access code'}
          </button>
          {has && (
            <button onClick={revoke} disabled={!!busy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">
              {busy === 'revoke' && <Loader2 className="h-4 w-4 animate-spin" />} Turn off access
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

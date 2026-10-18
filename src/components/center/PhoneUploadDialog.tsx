'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { CheckCircle2, Clock, FileText, Loader2, RefreshCw, Smartphone, X } from 'lucide-react'
import {
  claimHandoff, createUploadHandoff, discardHandoff, getHandoffStatus, type HandoffKind,
} from '@/app/actions/upload-handoff.actions'
import type { PhoneUpload } from '@/lib/files'

/**
 * "Upload from phone": shows a QR code, waits for the phone to send photo(s) or a PDF, then hands the
 * file to the screen (onReceived) to save exactly like a normal upload. Nothing is saved until the
 * admin/staff member confirms; closing the dialog deletes an unused upload.
 *
 * onReceived may return an error message; the upload is then rolled back (deleted).
 */
export function PhoneUploadDialog({
  kind, label, staffId, askName = false, confirmLabel = 'Use this file', onClose, onReceived,
}: {
  kind: HandoffKind
  /** What the phone shows ("Inspection report", "CPR Certification", …) */
  label: string
  /** The employee, for center files about an employee (kind 'internal') */
  staffId?: string
  /** Show an editable document name before confirming */
  askName?: boolean
  confirmLabel?: string
  onClose: () => void
  onReceived: (upload: PhoneUpload) => Promise<string | void> | string | void
}) {
  const [handoffId, setHandoffId] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number>(0)
  const [now, setNow] = useState(0)
  const [status, setStatus] = useState<'starting' | 'pending' | 'uploaded' | 'expired' | 'error'>('starting')
  const [preview, setPreview] = useState<{ url: string | null; type: string | null; name: string | null }>({ url: null, type: null, name: null })
  const [name, setName] = useState(label)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const used = useRef(false)

  // Creates a handoff and draws its QR code (state is only set after the first await)
  async function start() {
    const res = await createUploadHandoff({ kind, label, staffId })
    if (!res.success) { setStatus('error'); setError(res.error); return }
    setHandoffId(res.handoffId)
    setExpiresAt(new Date(res.expiresAt).getTime())
    setNow(Date.now())
    setQr(await QRCode.toDataURL(res.url, { width: 280, margin: 1, color: { dark: '#243746', light: '#ffffff' } }))
    setStatus('pending')
  }

  // Start once on open; start() only sets state after awaiting the server
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { start() }, [])

  // Watch for the phone's upload
  useEffect(() => {
    if (status !== 'pending' || !handoffId) return
    const timer = setInterval(async () => {
      setNow(Date.now())
      const res = await getHandoffStatus(handoffId)
      if (!res.success) return
      if (res.status === 'uploaded') {
        setPreview({ url: res.previewUrl, type: res.contentType, name: res.fileName })
        setStatus('uploaded')
      } else if (res.status === 'expired' || res.status === 'discarded') {
        setStatus('expired')
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [status, handoffId])

  // Closing without using the upload cleans up the handoff (and any file the phone sent)
  async function close() {
    if (handoffId && !used.current) await discardHandoff(handoffId)
    onClose()
  }

  async function confirm() {
    if (!handoffId) return
    setBusy(true)
    setError('')
    const claimed = await claimHandoff(handoffId)
    if (!claimed.success) { setBusy(false); setError(claimed.error); return }

    const upload: PhoneUpload = {
      source: 'phone',
      fileKey: claimed.fileKey,
      bucketName: claimed.bucketName,
      name: askName ? (name.trim() || claimed.fileName) : claimed.fileName,
      type: claimed.contentType,
      size: claimed.sizeBytes,
    }
    const problem = await onReceived(upload)
    if (problem) {
      // The screen could not save it: delete the file so nothing is left behind
      await discardHandoff(handoffId, { rollback: true })
      setBusy(false)
      setError(problem)
      setStatus('expired')
      return
    }
    used.current = true
    setBusy(false)
    onClose()
  }

  async function retake() {
    if (handoffId) await discardHandoff(handoffId)
    setPreview({ url: null, type: null, name: null })
    setStatus('starting')
    setError('')
    start()
  }

  const secondsLeft = Math.max(0, Math.round((expiresAt - now) / 1000))

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-brand-900/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="phone-upload-title">
      <div className="w-full max-w-md rounded-3xl border border-border bg-white p-7 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 id="phone-upload-title" className="flex items-center gap-2 text-xl font-black text-heading"><Smartphone className="h-5 w-5 text-brand-600" /> Upload from phone</h2>
            <p className="mt-1 text-sm text-muted">{label}</p>
          </div>
          <button onClick={close} className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {status === 'starting' && (
          <div className="flex flex-col items-center py-14 text-muted"><Loader2 className="mb-3 h-8 w-8 animate-spin text-brand-600" /> Preparing…</div>
        )}

        {status === 'error' && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {status === 'pending' && qr && (
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code to upload from your phone" className="mx-auto h-64 w-64 rounded-2xl border border-border p-2" />
            <ol className="mx-auto mt-5 max-w-xs space-y-1 text-left text-sm text-text-muted">
              <li>1. Scan the code with your phone camera.</li>
              <li>2. Take a photo of each page.</li>
              <li>3. Tap Send. It will appear here.</li>
            </ol>
            <p className="mt-5 flex items-center justify-center gap-2 text-sm font-medium text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> Waiting for your phone…
              <span className="inline-flex items-center gap-1 text-subtle"><Clock className="h-3.5 w-3.5" />{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</span>
            </p>
          </div>
        )}

        {status === 'expired' && (
          <div className="py-8 text-center">
            {error
              ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-700">{error}</div>
              : <p className="mb-4 text-muted">This code has expired.</p>}
            <button onClick={retake} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-bold text-white hover:bg-brand-800"><RefreshCw className="h-4 w-4" /> New code</button>
          </div>
        )}

        {status === 'uploaded' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-brand-600"><CheckCircle2 className="h-5 w-5" /> Received from your phone</div>
            {preview.url && preview.type?.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt="Uploaded document" className="max-h-72 w-full rounded-xl border border-border object-contain" />
            ) : preview.url ? (
              <a href={preview.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm font-semibold text-brand-600 hover:bg-brand-50">
                <FileText className="h-5 w-5" /> Open {preview.name ?? 'document'} to check it
              </a>
            ) : null}
            {askName && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-main">Document name</label>
                <input value={name} onChange={e => setName(e.target.value)} className="w-full rounded-xl border border-border px-4 py-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30" />
              </div>
            )}
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            <div className="flex gap-3">
              <button onClick={retake} disabled={busy} className="flex-1 rounded-xl border-2 border-border bg-surface px-4 py-3 font-bold text-muted hover:bg-surface-2">Discard & retake</button>
              <button onClick={confirm} disabled={busy} className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 font-black text-white hover:bg-brand-800 disabled:opacity-60">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><CheckCircle2 className="h-5 w-5" /> {confirmLabel}</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** A small "Use phone" button that opens the dialog; drop it next to any file picker. */
export function PhoneUploadButton({
  kind, label, staffId, onReceived, className, text = 'Use phone', disabled,
}: {
  kind: HandoffKind
  label: string
  staffId?: string
  onReceived: (upload: PhoneUpload) => Promise<string | void> | string | void
  className?: string
  text?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={className ?? 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-brand-600 transition-colors hover:bg-brand-50 disabled:opacity-50'}
      >
        <Smartphone className="h-3.5 w-3.5" /> {text}
      </button>
      {open && <PhoneUploadDialog kind={kind} label={label} staffId={staffId} onClose={() => setOpen(false)} onReceived={onReceived} />}
    </>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { CheckCircle2, Clock, FileText, Loader2, RefreshCw, Smartphone, X } from 'lucide-react'
import {
  attachHandoff, createUploadHandoff, discardHandoff, getHandoffStatus,
} from '@/app/actions/upload-handoff.actions'

/**
 * "Upload from phone": shows a QR code for one employee + checklist item, waits for the phone to
 * send the photo(s), then lets the admin attach or discard it. Nothing is attached without Attach.
 */
export function PhoneUploadDialog({
  centerId, staffId, requirementId, documentName, onClose, onAttached,
}: {
  centerId: string
  staffId: string
  requirementId: string | null
  documentName: string
  onClose: () => void
  onAttached: () => void
}) {
  const [handoffId, setHandoffId] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number>(0)
  const [now, setNow] = useState(0)
  const [status, setStatus] = useState<'starting' | 'pending' | 'uploaded' | 'expired' | 'error'>('starting')
  const [preview, setPreview] = useState<{ url: string | null; type: string | null; name: string | null }>({ url: null, type: null, name: null })
  const [name, setName] = useState(documentName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const attached = useRef(false)

  // Creates a handoff and draws its QR code (state is only set after the first await)
  async function start() {
    const res = await createUploadHandoff(centerId, staffId, requirementId)
    if (!res.success) { setStatus('error'); setError(res.error); return }
    setHandoffId(res.handoffId)
    setExpiresAt(new Date(res.expiresAt).getTime())
    setNow(Date.now())
    setQr(await QRCode.toDataURL(res.url, { width: 280, margin: 1, color: { dark: '#0b3828', light: '#ffffff' } }))
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

  // Closing without attaching cleans up the handoff (and any file the phone sent)
  async function close() {
    if (handoffId && !attached.current) await discardHandoff(handoffId)
    onClose()
  }

  async function attach() {
    if (!handoffId) return
    setBusy(true)
    const res = await attachHandoff(handoffId, name)
    setBusy(false)
    if (!res.success) { setError(res.error); return }
    attached.current = true
    onAttached()
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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0b3828]/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="phone-upload-title">
      <div className="w-full max-w-md rounded-3xl border border-[#e2e8e4] bg-white p-7 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 id="phone-upload-title" className="flex items-center gap-2 text-xl font-black text-[#0b3828]"><Smartphone className="h-5 w-5 text-[#157354]" /> Upload from phone</h2>
            <p className="mt-1 text-sm text-[#6b7a73]">{documentName}</p>
          </div>
          <button onClick={close} className="rounded-lg p-1.5 text-[#6b7a73] hover:bg-[#f8faf9]" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {status === 'starting' && (
          <div className="flex flex-col items-center py-14 text-[#6b7a73]"><Loader2 className="mb-3 h-8 w-8 animate-spin text-[#157354]" /> Preparing…</div>
        )}

        {status === 'error' && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {status === 'pending' && qr && (
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code to upload from your phone" className="mx-auto h-64 w-64 rounded-2xl border border-[#e2e8e4] p-2" />
            <ol className="mx-auto mt-5 max-w-xs space-y-1 text-left text-sm text-[#3d5a4f]">
              <li>1. Scan the code with your phone camera.</li>
              <li>2. Take a photo of each page.</li>
              <li>3. Tap Send. It will appear here.</li>
            </ol>
            <p className="mt-5 flex items-center justify-center gap-2 text-sm font-medium text-[#6b7a73]">
              <Loader2 className="h-4 w-4 animate-spin text-[#157354]" /> Waiting for your phone…
              <span className="inline-flex items-center gap-1 text-[#a8b5ae]"><Clock className="h-3.5 w-3.5" />{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</span>
            </p>
          </div>
        )}

        {status === 'expired' && (
          <div className="py-8 text-center">
            <p className="mb-4 text-[#6b7a73]">This code has expired.</p>
            <button onClick={retake} className="inline-flex items-center gap-2 rounded-xl bg-[#157354] px-5 py-3 font-bold text-white hover:bg-[#0f4a36]"><RefreshCw className="h-4 w-4" /> New code</button>
          </div>
        )}

        {status === 'uploaded' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-[#157354]"><CheckCircle2 className="h-5 w-5" /> Received from your phone</div>
            {preview.url && preview.type?.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt="Uploaded document" className="max-h-72 w-full rounded-xl border border-[#e2e8e4] object-contain" />
            ) : preview.url ? (
              <a href={preview.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-[#e2e8e4] p-4 text-sm font-semibold text-[#157354] hover:bg-[#edf7f3]">
                <FileText className="h-5 w-5" /> Open {preview.name ?? 'document'} to check it
              </a>
            ) : null}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#1a2e25]">Document name</label>
              <input value={name} onChange={e => setName(e.target.value)} className="w-full rounded-xl border border-[#e2e8e4] px-4 py-3 text-sm focus:border-[#157354] focus:outline-none focus:ring-2 focus:ring-[#157354]/30" />
            </div>
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            <div className="flex gap-3">
              <button onClick={retake} disabled={busy} className="flex-1 rounded-xl border-2 border-[#f0f4f2] bg-[#f8faf9] px-4 py-3 font-bold text-[#6b7a73] hover:bg-[#f0f4f2]">Discard & retake</button>
              <button onClick={attach} disabled={busy} className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-[#157354] px-4 py-3 font-black text-white hover:bg-[#0f4a36] disabled:opacity-60">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><CheckCircle2 className="h-5 w-5" /> Attach</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

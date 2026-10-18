'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Camera, CheckCircle2, FileText, ImagePlus, Loader2, AlertCircle, X } from 'lucide-react'
import { completeCapture, getCaptureDetails, getCaptureUploadUrl } from '@/app/actions/upload-handoff.actions'

/**
 * Phone side of "Upload from phone". Opened by scanning the QR code on the center admin's computer.
 * No sign-in: the one-time token in the URL is the permission, and it can only upload.
 * Photos are shrunk on the phone; several photos become one PDF.
 */

type Details = { centerName: string; employeeName: string; documentName: string; expiresAt: string }
type Page = { id: string; file: File; preview: string | null }

const MAX_EDGE = 2000
const JPEG_QUALITY = 0.82

/** Shrinks a photo to MAX_EDGE on its longest side and re-encodes it as JPEG. */
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process the photo'))), 'image/jpeg', JPEG_QUALITY))
}

/** One photo -> a JPEG; several -> a single PDF with one page per photo. A chosen PDF is sent as is. */
async function buildUpload(pages: Page[], documentName: string): Promise<{ blob: Blob; type: string; name: string }> {
  const safeName = documentName.replace(/[^\w\- ]+/g, '').trim() || 'Document'
  if (pages.length === 1 && pages[0].file.type === 'application/pdf') {
    return { blob: pages[0].file, type: 'application/pdf', name: pages[0].file.name }
  }
  const jpegs = await Promise.all(pages.map(p => toJpeg(p.file)))
  if (jpegs.length === 1) return { blob: jpegs[0], type: 'image/jpeg', name: `${safeName}.jpg` }

  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  for (const jpeg of jpegs) {
    const image = await pdf.embedJpg(await jpeg.arrayBuffer())
    const page = pdf.addPage([image.width, image.height])
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  }
  const bytes = await pdf.save()
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), type: 'application/pdf', name: `${safeName}.pdf` }
}

export default function CapturePage() {
  const { token } = useParams<{ token: string }>()
  const [details, setDetails] = useState<Details | null>(null)
  const [error, setError] = useState('')
  const [pages, setPages] = useState<Page[]>([])
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const cameraInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getCaptureDetails(token).then(res => {
      if (res.success) setDetails(res)
      else setError(res.error)
    })
  }, [token])

  // Free preview URLs when pages are removed or the page closes
  useEffect(() => () => pages.forEach(p => p.preview && URL.revokeObjectURL(p.preview)), [pages])

  function addFiles(list: FileList | null) {
    if (!list?.length) return
    const added = Array.from(list).map(file => ({
      id: crypto.randomUUID(),
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }))
    setPages(prev => {
      // A PDF can only be sent on its own
      if (added.some(p => p.file.type === 'application/pdf')) return [added.find(p => p.file.type === 'application/pdf')!]
      return [...prev.filter(p => p.file.type !== 'application/pdf'), ...added]
    })
    setError('')
  }

  async function send() {
    if (!details || pages.length === 0) return
    setSending(true)
    setError('')
    try {
      const upload = await buildUpload(pages, details.documentName)
      const presigned = await getCaptureUploadUrl(token, upload.type, upload.blob.size)
      if (!presigned.success) throw new Error(presigned.error)

      const put = await fetch(presigned.uploadUrl, { method: 'PUT', body: upload.blob, headers: { 'Content-Type': upload.type } })
      if (!put.ok) throw new Error('The upload failed. Check your connection and try again.')

      const done = await completeCapture(token, presigned.fileKey, upload.name)
      if (!done.success) throw new Error(done.error)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8faf9] px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#157354]"><span className="text-sm font-bold text-white">CL</span></div>
          <span className="text-lg font-bold text-[#0b3828]">CareLocal</span>
        </div>

        {!details && !error && (
          <div className="flex flex-col items-center py-20 text-[#6b7a73]"><Loader2 className="mb-3 h-8 w-8 animate-spin text-[#157354]" /> Loading…</div>
        )}

        {!details && error && (
          <div className="rounded-2xl border border-[#e2e8e4] bg-white p-6 text-center shadow-sm">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
            <p className="font-medium text-[#1a2e25]">{error}</p>
          </div>
        )}

        {details && sent && (
          <div className="rounded-2xl border border-[#e2e8e4] bg-white p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-[#157354]" />
            <h1 className="mb-2 text-2xl font-extrabold text-[#0b3828]">Sent</h1>
            <p className="text-[#6b7a73]">The document is on the computer now. You can close this page.</p>
          </div>
        )}

        {details && !sent && (
          <div className="space-y-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#157354]">{details.centerName}</p>
              <h1 className="mt-1 text-2xl font-extrabold text-[#0b3828]">{details.documentName}</h1>
              <p className="text-[#6b7a73]">for {details.employeeName}</p>
            </div>

            <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
            <input ref={libraryInput} type="file" accept="image/*,application/pdf" multiple className="hidden"
              onChange={e => { addFiles(e.target.files); e.target.value = '' }} />

            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => cameraInput.current?.click()} disabled={sending}
                className="flex flex-col items-center gap-2 rounded-2xl bg-[#157354] px-4 py-5 font-bold text-white shadow-sm active:bg-[#0f4a36] disabled:opacity-50">
                <Camera className="h-7 w-7" /> {pages.length ? 'Add page' : 'Take photo'}
              </button>
              <button type="button" onClick={() => libraryInput.current?.click()} disabled={sending}
                className="flex flex-col items-center gap-2 rounded-2xl border-2 border-[#e2e8e4] bg-white px-4 py-5 font-bold text-[#157354] disabled:opacity-50">
                <ImagePlus className="h-7 w-7" /> Choose file
              </button>
            </div>

            {pages.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {pages.map((p, i) => (
                  <div key={p.id} className="relative aspect-[3/4] overflow-hidden rounded-xl border border-[#e2e8e4] bg-white">
                    {p.preview
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.preview} alt={`Page ${i + 1}`} className="h-full w-full object-cover" />
                      : <div className="flex h-full flex-col items-center justify-center p-2 text-center text-xs text-[#6b7a73]"><FileText className="mb-1 h-6 w-6 text-[#157354]" />{p.file.name}</div>}
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
                    <button type="button" aria-label={`Remove page ${i + 1}`} disabled={sending}
                      onClick={() => setPages(prev => prev.filter(x => x.id !== p.id))}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            )}

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            <button type="button" onClick={send} disabled={sending || pages.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0b3828] py-4 text-lg font-bold text-white disabled:opacity-40">
              {sending ? <><Loader2 className="h-5 w-5 animate-spin" /> Sending…</> : `Send${pages.length > 1 ? ` ${pages.length} pages` : ''}`}
            </button>
            <p className="text-center text-xs text-[#a8b5ae]">This link works once and expires in a few minutes.</p>
          </div>
        )}
      </div>
    </div>
  )
}

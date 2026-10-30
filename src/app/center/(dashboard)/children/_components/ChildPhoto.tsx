'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { getChildPhotoUploadUrl, removeChildPhoto, setChildPhoto } from '@/app/actions/child-photo.actions'
import { showAlert, showConfirm } from '@/lib/dialog'

const SIDE_PX = 512

/** Shrink a picture to at most 512 px on its longest side, as a JPEG, so uploads are small and fast */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, SIDE_PX / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob ?? file
  } catch {
    return file                                                // the browser could not read it; the server checks type and size
  }
}

/** The child's headshot with Add / Change / Remove. Initials when there is no photo. */
export function ChildPhoto({ childId, initials, url, onChanged, size = 64 }: {
  childId: string
  initials: string
  url: string | null
  onChanged: () => void
  size?: number
}) {
  const input = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    setBusy(true)
    try {
      const blob = await shrink(file)
      const type = blob.type || file.type
      const presigned = await getChildPhotoUploadUrl(childId, type, blob.size)
      if (!presigned.success) throw new Error(presigned.error)
      const put = await fetch(presigned.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': type } })
      if (!put.ok) throw new Error('Upload failed. Please try again.')
      const saved = await setChildPhoto(childId, presigned.fileKey)
      if (!saved.success) throw new Error(saved.error)
      onChanged()
    } catch (e) {
      showAlert(e instanceof Error ? e.message : 'Upload failed. Please try again.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function remove() {
    if (!await showConfirm('Remove this photo? The child shows their initials until a new one is added.')) return
    setBusy(true)
    const res = await removeChildPhoto(childId)
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    onChanged()
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={url ? 'Change photo' : 'Add photo'}
        className="group relative flex items-center justify-center overflow-hidden rounded-2xl bg-brand-50 text-xl font-black text-brand-600"
        style={{ width: size, height: size }}
      >
        {url
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          ? <img src={url} alt="" className="h-full w-full object-cover" />
          : initials}
        <span className="absolute inset-0 flex items-center justify-center bg-brand-900/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        </span>
      </button>
      <div className="flex items-center gap-2 text-[11px] font-semibold">
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="text-brand-600 hover:underline">{url ? 'Change' : 'Add photo'}</button>
        {url && <button type="button" onClick={remove} disabled={busy} aria-label="Remove photo" className="text-muted hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }}
      />
    </div>
  )
}

/** A small read-only headshot for lists */
export function ChildThumb({ url, initials, size = 36 }: { url?: string | null; initials: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-xs font-black text-brand-600" style={{ width: size, height: size }}>
      {url
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
        ? <img src={url} alt="" className="h-full w-full object-cover" />
        : initials}
    </span>
  )
}

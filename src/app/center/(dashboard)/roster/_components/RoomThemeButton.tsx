'use client'

import { useRef, useState } from 'react'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { getRoomThemeUploadUrl, removeRoomTheme, setRoomTheme, type ThemeSlot } from '@/app/actions/room-theme.actions'
import { showAlert, showConfirm } from '@/lib/dialog'

const SIDE_PX = 1600

/** Shrink a picture to at most 1600 px on its longest side, as a JPEG, so uploads are small and fast */
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

/**
 * A small pencil that lets an administrator pick the room's background picture (and a bin to take it off).
 * Only render it for admins; the server refuses anyone else.
 */
export function RoomThemeButton({ areaId, slot = 'room', roomName, hasImage, onChanged, className = '' }: {
  areaId: string
  /** 'room': the room's rectangle and tile; 'circle': the Classroom circle */
  slot?: ThemeSlot
  roomName: string
  hasImage: boolean
  onChanged: () => void
  className?: string
}) {
  const input = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    setBusy(true)
    try {
      const blob = await shrink(file)
      const type = blob.type || file.type
      const presigned = await getRoomThemeUploadUrl(areaId, slot, type, blob.size)
      if (!presigned.success) throw new Error(presigned.error)
      const put = await fetch(presigned.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': type } })
      if (!put.ok) throw new Error('Upload failed. Please try again.')
      const saved = await setRoomTheme(areaId, slot, presigned.fileKey)
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
    if (!await showConfirm(`Remove the ${roomName} ${slot === 'circle' ? 'circle' : 'background'} picture?`)) return
    setBusy(true)
    const res = await removeRoomTheme(areaId, slot)
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    onChanged()
  }

  const what = slot === 'circle' ? 'circle picture' : 'background picture'
  const btn ='flex h-7 w-7 items-center justify-center rounded-full border border-border bg-white/95 text-muted shadow-sm hover:text-brand-600 focus-visible:outline-3 focus-visible:outline-brand-600 disabled:opacity-60'
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className={btn}
        aria-label={`${hasImage ? 'Change' : 'Set'} ${roomName} ${what}`} title={`${hasImage ? 'Change' : 'Set'} ${what}`}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
      </button>
      {hasImage && (
        <button type="button" onClick={remove} disabled={busy} className={`${btn} hover:!text-red-600`}
          aria-label={`Remove ${roomName} ${what}`} title={`Remove ${what}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
    </span>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, Megaphone, X } from 'lucide-react'
import type { RosterPerson, RosterRoom } from '@/lib/roster-ratio'
import { getDailyPhotoUploadUrl, saveDailyPhoto, type PhotoTarget } from '@/app/actions/daily-photo.actions'
import { newKey } from '@/lib/daily'
import { Face } from './PersonAvatar'
import { FIELD } from './DailyForms'

const SIDE_PX = 1280

/** Shrink to at most 1,280 px on the longest side, as a JPEG (null when the browser cannot read the picture) */
async function shrink(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, SIDE_PX / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  } catch {
    return null
  }
}

/** Shrink, upload to the private bucket, then save on the day. The same key retried saves once. */
async function uploadDailyPhoto(centerId: string, target: PhotoTarget, file: File, opts: { caption?: string; childIds?: string[]; key: string }) {
  const blob = await shrink(file)
  if (!blob) return { success: false as const, error: 'This photo could not be read. Try taking it again, or choose a JPG or PNG.' }
  const link = await getDailyPhotoUploadUrl(centerId, target, blob.size)
  if (!link.success) return link
  const put = await fetch(link.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } }).catch(() => null)
  if (!put?.ok) return { success: false as const, error: 'The upload did not finish. Check the connection and try again.' }
  return saveDailyPhoto({ centerId, fileKey: link.fileKey, target, childIds: opts.childIds, caption: opts.caption, key: opts.key })
}

/** The camera / photo picker with a preview */
function PhotoPicker({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return (
    <div>
      <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only"
        onChange={e => onFile(e.target.files?.[0] ?? null)} aria-label="Take or choose a photo" />
      {preview ? (
        <button type="button" onClick={() => input.current?.click()} className="block w-full overflow-hidden rounded-xl border border-border" aria-label="Change photo">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
          <img src={preview} alt="" className="max-h-72 w-full object-contain" />
        </button>
      ) : (
        <button type="button" onClick={() => input.current?.click()}
          className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-white text-sm font-bold text-heading hover:bg-surface">
          <Camera className="h-7 w-7 text-brand-600" /> Take or choose a photo
        </button>
      )}
    </div>
  )
}

/** Shown when a child's parents have not agreed to marketing and social media use */
export function NoMarketing({ names }: { names?: string[] }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-surface px-3 py-2 text-xs font-semibold text-text-main">
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
      <span>{names?.length ? `Not for marketing or social media: ${names.join(', ')}.` : 'Not for marketing or social media (no parent consent). Fine for the daily report.'}</span>
    </p>
  )
}

/** One child's photo, from the child card */
export function PhotoForm({ centerId, person, onSaved, onCancel }: {
  centerId: string
  person: RosterPerson
  onSaved: () => void
  onCancel: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [key] = useState(newKey)

  async function save() {
    if (!file) return
    setBusy(true)
    setError(null)
    const res = await uploadDailyPhoto(centerId, { childId: person.person_id }, file, { caption: caption.trim() || undefined, key })
    setBusy(false)
    if (!res.success) { setError(res.error); return }
    onSaved()
  }

  return (
    <form className="flex flex-col gap-3 rounded-2xl border border-border bg-surface/40 p-3" onSubmit={e => { e.preventDefault(); save() }}>
      <p className="text-base font-bold text-heading">Photo</p>
      <PhotoPicker file={file} onFile={setFile} />
      <input value={caption} onChange={e => setCaption(e.target.value)} maxLength={200} className={FIELD} placeholder="Caption (optional)" />
      {person.marketing_photos_allowed === false && <NoMarketing />}
      {error && <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-12 rounded-xl border border-border bg-white text-sm font-bold text-text-main hover:bg-surface">Cancel</button>
        <button type="submit" disabled={!file || busy}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save photo
        </button>
      </div>
    </form>
  )
}

/** A class photo: tagged to the room and added to each ticked child's day (everyone in the room by default) */
export function ClassPhotoDialog({ centerId, room, children, photos, tintOf, onClose, onDone }: {
  centerId: string
  room: RosterRoom
  children: RosterPerson[]
  photos: Record<string, string>
  tintOf: (p: RosterPerson) => string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(children.map(c => c.person_id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [key] = useState(newKey)
  const tagged = children.filter(c => picked.has(c.person_id))
  const noMarketing = tagged.filter(c => c.marketing_photos_allowed === false).map(c => `${c.first_name} ${c.last_initial}.`)

  async function save() {
    if (!file || tagged.length === 0) return
    setBusy(true)
    setError(null)
    const res = await uploadDailyPhoto(centerId, { roomId: room.id }, file, { caption: caption.trim() || undefined, childIds: tagged.map(c => c.person_id), key })
    setBusy(false)
    if (!res.success) { setError(res.error); return }
    onDone(`Class photo added for ${res.count} ${res.count === 1 ? 'child' : 'children'}.`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-900/40 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="cphoto-h"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl border border-border bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id="cphoto-h" className="text-xl font-black text-heading">Class photo</h2>
            <p className="mt-0.5 text-[13px] text-muted">{room.name} · shared on the day of every child ticked</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-muted hover:bg-surface-2"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          {children.length === 0 ? <p className="text-sm text-muted">No children are checked in to {room.name} right now.</p> : (
            <>
              <PhotoPicker file={file} onFile={setFile} />
              <input value={caption} onChange={e => setCaption(e.target.value)} maxLength={200} className={FIELD} placeholder="Caption (optional)" />
              <p className="text-xs font-bold uppercase tracking-wider text-muted">In this photo ({tagged.length})</p>
              <ul className="flex flex-col gap-1">
                {children.map(c => (
                  <li key={c.person_id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1 hover:bg-surface">
                      <input type="checkbox" checked={picked.has(c.person_id)} className="h-5 w-5 accent-brand-600"
                        onChange={e => setPicked(prev => { const next = new Set(prev); if (e.target.checked) next.add(c.person_id); else next.delete(c.person_id); return next })} />
                      <Face person={c} url={photos[c.person_id]} tint={tintOf(c)} size={32} border="2px solid #ffffff" />
                      <span className="text-sm font-semibold text-heading">{c.first_name} {c.last_initial}.</span>
                      {c.marketing_photos_allowed === false && <span className="ml-auto text-[11px] text-muted">No marketing</span>}
                    </label>
                  </li>
                ))}
              </ul>
              {noMarketing.length > 0 && <NoMarketing names={noMarketing} />}
            </>
          )}
          {error && <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{error}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-border text-sm font-bold text-text-main hover:bg-surface">Cancel</button>
          <button type="button" disabled={busy || !file || tagged.length === 0} onClick={save}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save for {tagged.length}
          </button>
        </div>
      </div>
    </div>
  )
}

/** A photo full size, tap anywhere to close */
export function PhotoViewer({ url, caption, onClose }: { url: string; caption?: string | null; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="Photo"
      onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
      <img src={url} alt={caption ?? ''} className="max-h-[80vh] max-w-full rounded-xl object-contain" />
      {caption && <p className="max-w-lg text-center text-sm font-semibold text-white">{caption}</p>}
      <button type="button" onClick={onClose} className="min-h-11 rounded-full bg-white/15 px-5 text-sm font-bold text-white">Close</button>
    </div>
  )
}

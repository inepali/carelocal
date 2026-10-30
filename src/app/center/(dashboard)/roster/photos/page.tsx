'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Camera, Check, Loader2, Megaphone, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { canOpenRoster, useCenterContext } from '../../context'
import { loadPhotosForReview, type PhotoForReview } from '@/lib/daily'
import { getDailyPhotoUrls, reviewDailyPhoto } from '@/app/actions/daily-photo.actions'
import { showAlert, showConfirm } from '@/lib/dialog'
import { PhotoViewer } from '../_components/DailyPhoto'

/**
 * Owners and admins review the photos teachers take on the roster. Only approved photos go with a child's daily
 * activities and the parent report; deleting a photo removes it from every child it is on.
 */
export default function PhotoReviewPage() {
  const ctx = useCenterContext()
  const centerId = ctx.centerId
  const [waiting, setWaiting] = useState(true)
  const [photos, setPhotos] = useState<PhotoForReview[] | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [viewing, setViewing] = useState<PhotoForReview | null>(null)

  const load = useCallback(async () => {
    if (!centerId) return
    setPhotos(null)
    const res = await loadPhotosForReview(createClient(), centerId, waiting)
    if (!res.success) { showAlert(res.error); setPhotos([]); return }
    setPhotos(res.photos)
    if (res.photos.length) {
      const signed = await getDailyPhotoUrls(centerId, res.photos.map(p => p.photo_key))
      if (signed.success) setUrls(signed.urls)
    }
  }, [centerId, waiting])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function review(p: PhotoForReview, approve: boolean) {
    if (!centerId) return
    if (!approve && !await showConfirm(
      `Delete this photo${p.children.length > 1 ? ` from all ${p.children.length} children it is on` : ''}? It will not be in anyone's daily activities.`,
      { title: 'Delete photo', confirmLabel: 'Delete' })) return
    setBusy(p.photo_key)
    const res = await reviewDailyPhoto(centerId, p.photo_key, approve)
    setBusy(null)
    if (!res.success) { showAlert(res.error); return }
    setPhotos(prev => prev?.filter(x => x.photo_key !== p.photo_key) ?? prev)
  }

  async function approveAll() {
    if (!centerId || !photos?.length) return
    if (!await showConfirm(`Approve all ${photos.length} photos?`, { title: 'Approve all', confirmLabel: 'Approve all' })) return
    setBusy('all')
    for (const p of photos) {
      const res = await reviewDailyPhoto(centerId, p.photo_key, true)
      if (!res.success) { showAlert(res.error); break }
    }
    setBusy(null)
    load()
  }

  if (!canOpenRoster(ctx) || !centerId) {
    return (
      <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center shadow-sm">
        <Camera className="mx-auto mb-3 h-10 w-10 text-brand-200" />
        <p className="text-muted">Only the owner and administrators of a center with the live roster can review photos.</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl pb-20">
      <Link href="/center/roster" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> Back to Live roster</Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-heading">Photo review</h1>
          <p className="mt-1 text-sm text-muted">Only approved photos go with a child&apos;s daily activities. Last 14 days.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Show" className="flex rounded-full bg-surface-2 p-1">
            {[true, false].map(w => (
              <button key={String(w)} type="button" role="radio" aria-checked={waiting === w} onClick={() => setWaiting(w)}
                className={`min-h-9 rounded-full px-3.5 text-xs font-bold ${waiting === w ? 'bg-white text-heading shadow-sm' : 'text-muted hover:text-heading'}`}>
                {w ? 'Waiting' : 'Approved'}
              </button>
            ))}
          </div>
          {waiting && !!photos?.length && (
            <button type="button" onClick={approveAll} disabled={!!busy}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
              {busy === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve all
            </button>
          )}
        </div>
      </div>

      {!photos ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div>
      ) : photos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center text-sm text-muted">
          <Camera className="mx-auto mb-2 h-8 w-8 text-brand-200" /> {waiting ? 'No photos waiting for review.' : 'No approved photos in the last 14 days.'}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map(p => {
            const url = urls[p.photo_key]
            const noMarketing = p.children.filter(c => !c.marketing_ok).map(c => c.name)
            return (
              <li key={p.photo_key} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
                <button type="button" onClick={() => url && setViewing(p)} className="block aspect-[4/3] bg-surface" aria-label="Open photo">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                  {url ? <img src={url} alt={p.caption ?? 'Photo'} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-sm text-muted">Photo not available</span>}
                </button>
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  <p className="text-sm font-bold text-heading">{p.is_class ? `Class photo${p.room_name ? ` · ${p.room_name}` : ''}` : p.children[0]?.name}</p>
                  {p.caption && <p className="text-sm text-text-main">{p.caption}</p>}
                  {p.is_class && <p className="text-xs text-muted">{p.children.map(c => c.name).join(', ')}</p>}
                  <p className="text-xs text-muted">
                    {new Date(p.taken_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    {p.taken_by ? ` · ${p.taken_by}` : ''}
                  </p>
                  {noMarketing.length > 0 && (
                    <p className="flex items-start gap-1.5 text-xs font-semibold text-text-main">
                      <Megaphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" /> Not for marketing: {noMarketing.join(', ')}
                    </p>
                  )}
                  <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
                    <button type="button" onClick={() => review(p, false)} disabled={!!busy}
                      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-bold text-[#a3221b] hover:bg-[#fce4e2] disabled:opacity-50">
                      <Trash2 className="h-4 w-4" /> Delete
                    </button>
                    {waiting ? (
                      <button type="button" onClick={() => review(p, true)} disabled={!!busy}
                        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
                        {busy === p.photo_key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
                      </button>
                    ) : <span className="flex items-center justify-center text-xs font-semibold text-[#17603f]">Approved</span>}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {viewing && urls[viewing.photo_key] && <PhotoViewer url={urls[viewing.photo_key]} caption={viewing.caption} onClose={() => setViewing(null)} />}
    </div>
  )
}

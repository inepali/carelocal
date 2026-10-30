'use server'

import { randomUUID } from 'crypto'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'
import { createClient } from '@/lib/supabase/server'
import { friendlyDailyError } from '@/lib/daily'

/**
 * Daily photos from the Live Roster (a child's photo, or a class photo tagged to a room).
 *
 * - Who may add or see them is decided by the database, with the CALLER's session: an upload link is signed only
 *   after daily_photo_access() says yes, the photo is saved by daily_photo_add() (which refuses a key outside
 *   the right folder), and a view link is signed only for a key the caller can already read on an entry.
 * - Stored in the child bucket (R2_CHILD_BUCKET): child/<center>/<child>/daily/<date>/ for one child,
 *   child/<center>/class/<room>/<date>/ for a class photo. JPEG, up to 5 MB (the browser shrinks it to 1,280 px).
 * - View links last an hour.
 */
const MAX_BYTES = 5 * 1024 * 1024
const UPLOAD_URL_TTL_SECONDS = 600
const VIEW_URL_TTL_SECONDS = 3600

type Fail = { success: false; error: string }
const fail = (error: string): Fail => ({ success: false, error })
const NOT_CONFIGURED = 'Photo storage is not set up yet. Ask your administrator to set R2_CHILD_BUCKET.'

export type PhotoTarget = { childId: string; roomId?: undefined } | { roomId: string; childId?: undefined }

const folderOf = (centerId: string, target: PhotoTarget) =>
  target.childId ? `child/${centerId}/${target.childId}/daily/` : `child/${centerId}/class/${target.roomId}/`

async function caller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, signedIn: !!user }
}

/** Step 1: a short-lived link to PUT the (already shrunk) photo to. Nothing is saved until saveDailyPhoto. */
export async function getDailyPhotoUploadUrl(centerId: string, target: PhotoTarget, sizeBytes: number) {
  try {
    const bucket = process.env.R2_CHILD_BUCKET
    if (!bucket) return fail(NOT_CONFIGURED)
    const { supabase, signedIn } = await caller()
    if (!signedIn) return fail('Please sign in again.')
    if (!sizeBytes || sizeBytes > MAX_BYTES) return fail('Photos must be smaller than 5 MB.')

    const [{ data: ok, error }, { data: day }] = await Promise.all([
      supabase.rpc('daily_photo_access', { p_center_id: centerId, p_child_id: target.childId ?? null, p_room_id: target.roomId ?? null }),
      supabase.rpc('roster_today', { p_center_id: centerId }),
    ])
    if (error) return fail(friendlyDailyError(error))
    if (!ok) return fail('You cannot add photos for that child or room.')

    const fileKey = `${folderOf(centerId, target)}${day ?? 'today'}/${randomUUID()}.jpg`
    const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: bucket, Key: fileKey, ContentType: 'image/jpeg', ContentLength: sizeBytes,
    }), { expiresIn: UPLOAD_URL_TTL_SECONDS })
    return { success: true as const, uploadUrl, fileKey }
  } catch (error) {
    console.error('[daily-photo] upload url failed:', error)
    return fail('Failed to prepare the upload.')
  }
}

/**
 * Step 2: check the upload arrived, then save it on the child's day (or, for a class photo, on the day of each
 * child tagged). A refused save deletes the file. The same key retried saves once.
 */
export async function saveDailyPhoto(input: {
  centerId: string
  fileKey: string
  target: PhotoTarget
  childIds?: string[]
  caption?: string | null
  key: string
}): Promise<{ success: true; count: number } | Fail> {
  const bucket = process.env.R2_CHILD_BUCKET
  if (!bucket) return fail(NOT_CONFIGURED)
  try {
    const { supabase, signedIn } = await caller()
    if (!signedIn) return fail('Please sign in again.')
    if (!input.fileKey.startsWith(folderOf(input.centerId, input.target)) || input.fileKey.includes('..')) {
      return fail('That photo is not in the right folder.')
    }
    // Only someone allowed to photograph this child or room may get a file deleted, and never one already saved
    const { data: allowed } = await supabase.rpc('daily_photo_access', {
      p_center_id: input.centerId, p_child_id: input.target.childId ?? null, p_room_id: input.target.roomId ?? null,
    })
    if (!allowed) return fail('You cannot add photos for that child or room.')
    const remove = async () => {
      const { count } = await supabase.from('child_daily_entries').select('id', { count: 'exact', head: true })
        .eq('center_id', input.centerId).eq('details->>photo_key', input.fileKey)
      if (!count) await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: input.fileKey })).catch(() => {})
    }
    try {
      const head = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: input.fileKey }))
      if ((head.ContentLength ?? 0) > MAX_BYTES) { await remove(); return fail('Photos must be smaller than 5 MB.') }
    } catch {
      return fail('The upload did not finish. Please try again.')
    }

    const { data, error } = await supabase.rpc('daily_photo_add', {
      p_center_id: input.centerId,
      p_photo_key: input.fileKey,
      p_caption: input.caption ?? null,
      p_child_id: input.target.childId ?? null,
      p_room_id: input.target.roomId ?? null,
      p_child_ids: input.target.roomId ? (input.childIds ?? []) : null,
      p_at: null,
      p_key: input.key,
    })
    if (error) { await remove(); return fail(friendlyDailyError(error)) }
    return { success: true, count: data as number }
  } catch (error) {
    console.error('[daily-photo] save failed:', error)
    return fail('Failed to save the photo.')
  }
}

/** One-hour links for daily photos the caller can already read on an entry (keys from daily_day) */
export async function getDailyPhotoUrls(centerId: string, keys: string[]): Promise<{ success: true; urls: Record<string, string> } | Fail> {
  try {
    const bucket = process.env.R2_CHILD_BUCKET
    if (!bucket) return { success: true, urls: {} }
    const wanted = [...new Set(keys)].filter(k => k.startsWith(`child/${centerId}/`) && !k.includes('..')).slice(0, 200)
    if (wanted.length === 0) return { success: true, urls: {} }
    const { supabase, signedIn } = await caller()
    if (!signedIn) return fail('Please sign in again.')

    // Row-level security: only entries of a center the caller can use the roster for come back
    const { data, error } = await supabase.from('child_daily_entries').select('details')
      .eq('center_id', centerId).eq('kind', 'photo').in('details->>photo_key', wanted)
    if (error) return fail(friendlyDailyError(error))
    const readable = new Set(((data ?? []) as { details: { photo_key?: string } }[]).map(r => r.details.photo_key).filter((k): k is string => !!k))

    const signed = await Promise.all([...readable].map(async k => {
      try {
        return [k, await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: k }), { expiresIn: VIEW_URL_TTL_SECONDS })] as const
      } catch {
        return null
      }
    }))
    return { success: true, urls: Object.fromEntries(signed.filter((x): x is readonly [string, string] => !!x)) }
  } catch (error) {
    console.error('[daily-photo] view urls failed:', error)
    return fail('Could not load photos.')
  }
}

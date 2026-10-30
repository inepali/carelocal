'use server'

import { randomUUID } from 'crypto'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'
import { createClient } from '@/lib/supabase/server'

/**
 * Children's headshots, shown on the Children list, the child's file and the Live Roster.
 *
 * - Stored in the child bucket (R2_CHILD_BUCKET) under child/<center>/<child>/photo/, next to the child's
 *   records, and referenced by children.photo_key. The database refuses a key outside that folder.
 * - Who may add, change, remove or see a photo is decided by the database: these actions read and write the
 *   child row with the CALLER's session (owner or admin of the center, Child Files on). Teachers see photos
 *   only on the roster, through roster_snapshot().
 * - JPG, PNG or WebP, up to 5 MB (the browser shrinks the picture first). Changing the photo deletes the old one.
 * - Every change is in the child's activity log (the children audit trigger records photo_key changes).
 */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const UPLOAD_URL_TTL_SECONDS = 600
const VIEW_URL_TTL_SECONDS = 3600
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

type Fail = { success: false; error: string }
const fail = (error: string): Fail => ({ success: false, error })
const NOT_FOUND = 'Child not found or you do not have access to it.'
const NOT_CONFIGURED = 'Photo storage is not set up yet. Ask your administrator to set R2_CHILD_BUCKET.'

function childBucket() {
  const bucket = process.env.R2_CHILD_BUCKET
  if (!bucket) throw new Error('R2_CHILD_BUCKET is not set')
  return bucket
}
const setupProblem = (error: unknown) => (error instanceof Error && error.message.includes('R2_CHILD_BUCKET') ? NOT_CONFIGURED : null)
const photoFolder = (centerId: string, childId: string) => `child/${centerId}/${childId}/photo/`

async function readableChild(childId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, child: null, signedIn: false }
  const { data } = await supabase.from('children').select('id, center_id, photo_key').eq('id', childId).maybeSingle()
  return { supabase, child: data as { id: string; center_id: string; photo_key: string | null } | null, signedIn: true }
}

async function deleteQuietly(key: string | null, centerId: string, childId: string) {
  if (!key || !key.startsWith(photoFolder(centerId, childId))) return
  await r2.send(new DeleteObjectCommand({ Bucket: childBucket(), Key: key })).catch(() => {})
}

/** Step 1: a short-lived link to PUT the new photo to. Nothing changes until setChildPhoto. */
export async function getChildPhotoUploadUrl(childId: string, contentType: string, sizeBytes: number) {
  try {
    const { child, signedIn } = await readableChild(childId)
    if (!signedIn) return fail('Please sign in again.')
    if (!child) return fail(NOT_FOUND)
    const ext = TYPES[contentType]
    if (!ext) return fail('Please choose a JPG, PNG or WebP photo.')
    if (!sizeBytes || sizeBytes > MAX_PHOTO_BYTES) return fail('Photos must be smaller than 5 MB.')

    const fileKey = `${photoFolder(child.center_id, child.id)}${randomUUID()}.${ext}`
    const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: childBucket(), Key: fileKey, ContentType: contentType, ContentLength: sizeBytes,
    }), { expiresIn: UPLOAD_URL_TTL_SECONDS })
    return { success: true as const, uploadUrl, fileKey }
  } catch (error) {
    console.error('[child-photo] upload url failed:', error)
    return fail(setupProblem(error) ?? 'Failed to prepare the upload.')
  }
}

/** Step 2: make the uploaded photo the child's headshot, then delete the old one */
export async function setChildPhoto(childId: string, fileKey: string) {
  try {
    const { supabase, child, signedIn } = await readableChild(childId)
    if (!signedIn) return fail('Please sign in again.')
    if (!child) return fail(NOT_FOUND)
    if (!fileKey.startsWith(photoFolder(child.center_id, child.id)) || fileKey.includes('..')) return fail('That photo is not in this child’s folder.')

    try {
      const head = await r2.send(new HeadObjectCommand({ Bucket: childBucket(), Key: fileKey }))
      if ((head.ContentLength ?? 0) > MAX_PHOTO_BYTES) {
        await deleteQuietly(fileKey, child.center_id, child.id)
        return fail('Photos must be smaller than 5 MB.')
      }
    } catch {
      return fail('The upload did not finish. Please try again.')
    }

    const { error } = await supabase.from('children').update({ photo_key: fileKey }).eq('id', child.id)
    if (error) {
      await deleteQuietly(fileKey, child.center_id, child.id)
      return fail(error.message)
    }
    if (child.photo_key && child.photo_key !== fileKey) await deleteQuietly(child.photo_key, child.center_id, child.id)
    return { success: true as const }
  } catch (error) {
    console.error('[child-photo] set failed:', error)
    return fail(setupProblem(error) ?? 'Failed to save the photo.')
  }
}

/** Remove the headshot (the child shows initials again) */
export async function removeChildPhoto(childId: string) {
  try {
    const { supabase, child, signedIn } = await readableChild(childId)
    if (!signedIn) return fail('Please sign in again.')
    if (!child) return fail(NOT_FOUND)
    if (!child.photo_key) return { success: true as const }
    const { error } = await supabase.from('children').update({ photo_key: null }).eq('id', child.id)
    if (error) return fail(error.message)
    await deleteQuietly(child.photo_key, child.center_id, child.id)
    return { success: true as const }
  } catch (error) {
    console.error('[child-photo] remove failed:', error)
    return fail(setupProblem(error) ?? 'Failed to remove the photo.')
  }
}

/** One-hour links to the headshots the caller may see in a center (children the database lets them read); optionally just some children */
export async function getChildPhotoUrls(centerId: string, childIds?: string[]): Promise<{ success: true; urls: Record<string, string> } | Fail> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return fail('Please sign in again.')
    let query = supabase.from('children').select('id, center_id, photo_key').eq('center_id', centerId).not('photo_key', 'is', null)
    if (childIds) query = query.in('id', childIds.slice(0, 500))
    const { data, error } = await query
    if (error) return fail(error.message)
    const bucket = process.env.R2_CHILD_BUCKET
    if (!bucket) return { success: true, urls: {} }
    const rows = (data ?? []) as { id: string; center_id: string; photo_key: string }[]
    const signed = await Promise.all(rows
      .filter(r => r.photo_key.startsWith(photoFolder(r.center_id, r.id)))
      .map(async r => [r.id, await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: r.photo_key }), { expiresIn: VIEW_URL_TTL_SECONDS })] as const))
    return { success: true, urls: Object.fromEntries(signed) }
  } catch (error) {
    console.error('[child-photo] view urls failed:', error)
    return fail('Could not load photos.')
  }
}

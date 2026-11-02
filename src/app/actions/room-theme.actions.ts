'use server'

import { randomUUID } from 'crypto'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'
import { createClient } from '@/lib/supabase/server'

/**
 * The background pictures of a Live Roster room, set by an owner or administrator: one for the room (behind the
 * rectangle and on its tile) and one for the Classroom circle.
 *
 * - Stored in the child bucket (R2_CHILD_BUCKET) under roster-theme/<center>/<room>/ and referenced by
 *   work_areas.theme_image_key / circle_image_key. The database refuses a key outside the room's folder.
 * - Only center admins change them: the upload link is only issued to an admin of the room's center, and the
 *   work_areas update is decided by the existing admin policy.
 * - JPG, PNG or WebP, up to 5 MB (the browser shrinks the picture first). Changing one deletes the old one.
 * - Everyone who can open the roster sees them: view links are signed for the rooms the caller can read.
 */
const MAX_BYTES = 5 * 1024 * 1024
const UPLOAD_URL_TTL_SECONDS = 600
const VIEW_URL_TTL_SECONDS = 3600
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export type ThemeSlot = 'room' | 'circle'
const COLUMN = { room: 'theme_image_key', circle: 'circle_image_key' } as const
const isSlot = (s: unknown): s is ThemeSlot => s === 'room' || s === 'circle'

type Fail = { success: false; error: string }
const fail = (error: string): Fail => ({ success: false, error })
const NOT_ALLOWED = 'Only an owner or administrator can change the room picture.'
const NOT_CONFIGURED = 'Photo storage is not set up yet. Ask your administrator to set R2_CHILD_BUCKET.'

function bucket() {
  const b = process.env.R2_CHILD_BUCKET
  if (!b) throw new Error('R2_CHILD_BUCKET is not set')
  return b
}
const setupProblem = (error: unknown) => (error instanceof Error && error.message.includes('R2_CHILD_BUCKET') ? NOT_CONFIGURED : null)
const folder = (centerId: string, areaId: string) => `roster-theme/${centerId}/${areaId}/`

interface RoomRow { id: string; center_id: string; theme_image_key: string | null; circle_image_key: string | null }

/** The room, and whether the caller is an admin of its center */
async function adminRoom(areaId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, signedIn: false as const }
  const { data: room } = await supabase.from('work_areas').select('id, center_id, theme_image_key, circle_image_key').eq('id', areaId).maybeSingle()
  const { data: admin } = await supabase.rpc('get_my_admin_centers')
  const isAdmin = !!room && ((admin ?? []) as unknown as (string | { get_my_admin_centers: string })[])
    .some(c => (typeof c === 'string' ? c : c.get_my_admin_centers) === room.center_id)
  return { supabase, signedIn: true as const, room: room as RoomRow | null, isAdmin }
}

async function deleteQuietly(key: string | null, centerId: string, areaId: string) {
  if (!key || !key.startsWith(folder(centerId, areaId))) return
  await r2.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })).catch(() => {})
}

/** Step 1: a short-lived link to PUT the picture to. Nothing changes until setRoomTheme. */
export async function getRoomThemeUploadUrl(areaId: string, slot: ThemeSlot, contentType: string, sizeBytes: number) {
  try {
    if (!isSlot(slot)) return fail('Unknown picture.')
    const r = await adminRoom(areaId)
    if (!r.signedIn) return fail('Please sign in again.')
    if (!r.room || !r.isAdmin) return fail(NOT_ALLOWED)
    const ext = TYPES[contentType]
    if (!ext) return fail('Please choose a JPG, PNG or WebP picture.')
    if (!sizeBytes || sizeBytes > MAX_BYTES) return fail('Pictures must be smaller than 5 MB.')

    const fileKey = `${folder(r.room.center_id, r.room.id)}${randomUUID()}.${ext}`
    const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: bucket(), Key: fileKey, ContentType: contentType, ContentLength: sizeBytes,
    }), { expiresIn: UPLOAD_URL_TTL_SECONDS })
    return { success: true as const, uploadUrl, fileKey }
  } catch (error) {
    console.error('[room-theme] upload url failed:', error)
    return fail(setupProblem(error) ?? 'Failed to prepare the upload.')
  }
}

/** Step 2: make the uploaded picture the room's (or circle's) theme, then delete the old one */
export async function setRoomTheme(areaId: string, slot: ThemeSlot, fileKey: string) {
  try {
    if (!isSlot(slot)) return fail('Unknown picture.')
    const r = await adminRoom(areaId)
    if (!r.signedIn) return fail('Please sign in again.')
    if (!r.room || !r.isAdmin) return fail(NOT_ALLOWED)
    const { room } = r
    if (!fileKey.startsWith(folder(room.center_id, room.id)) || fileKey.includes('..')) return fail('That picture is not in this room’s folder.')

    try {
      const head = await r2.send(new HeadObjectCommand({ Bucket: bucket(), Key: fileKey }))
      if ((head.ContentLength ?? 0) > MAX_BYTES) {
        await deleteQuietly(fileKey, room.center_id, room.id)
        return fail('Pictures must be smaller than 5 MB.')
      }
    } catch {
      return fail('The upload did not finish. Please try again.')
    }

    const old = room[COLUMN[slot]]
    const { data, error } = await r.supabase.from('work_areas').update({ [COLUMN[slot]]: fileKey }).eq('id', room.id).select('id')
    if (error || !data?.length) {
      await deleteQuietly(fileKey, room.center_id, room.id)
      return fail(error?.message ?? NOT_ALLOWED)
    }
    if (old && old !== fileKey) await deleteQuietly(old, room.center_id, room.id)
    return { success: true as const }
  } catch (error) {
    console.error('[room-theme] set failed:', error)
    return fail(setupProblem(error) ?? 'Failed to save the picture.')
  }
}

/** Remove the picture (it goes back to the plain colors) */
export async function removeRoomTheme(areaId: string, slot: ThemeSlot) {
  try {
    if (!isSlot(slot)) return fail('Unknown picture.')
    const r = await adminRoom(areaId)
    if (!r.signedIn) return fail('Please sign in again.')
    if (!r.room || !r.isAdmin) return fail(NOT_ALLOWED)
    const { room } = r
    const old = room[COLUMN[slot]]
    if (!old) return { success: true as const }
    const { data, error } = await r.supabase.from('work_areas').update({ [COLUMN[slot]]: null }).eq('id', room.id).select('id')
    if (error || !data?.length) return fail(error?.message ?? NOT_ALLOWED)
    await deleteQuietly(old, room.center_id, room.id)
    return { success: true as const }
  } catch (error) {
    console.error('[room-theme] remove failed:', error)
    return fail(setupProblem(error) ?? 'Failed to remove the picture.')
  }
}

/** One-hour links to the pictures of a center's rooms, by room id (rooms the caller can read) */
export async function getRoomThemeUrls(centerId: string): Promise<{ success: true; room: Record<string, string>; circle: Record<string, string> } | Fail> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return fail('Please sign in again.')
    const { data, error } = await supabase.from('work_areas').select('id, center_id, theme_image_key, circle_image_key')
      .eq('center_id', centerId).or('theme_image_key.not.is.null,circle_image_key.not.is.null')
    if (error) return fail(error.message)
    const b = process.env.R2_CHILD_BUCKET
    if (!b) return { success: true, room: {}, circle: {} }
    const rows = (data ?? []) as RoomRow[]
    const sign = async (slot: ThemeSlot) => Object.fromEntries(await Promise.all(rows
      .filter(r => { const k = r[COLUMN[slot]]; return !!k && k.startsWith(folder(r.center_id, r.id)) })
      .map(async r => [r.id, await getSignedUrl(r2, new GetObjectCommand({ Bucket: b, Key: r[COLUMN[slot]]! }), { expiresIn: VIEW_URL_TTL_SECONDS })] as const)))
    const [room, circle] = await Promise.all([sign('room'), sign('circle')])
    return { success: true, room, circle }
  } catch (error) {
    console.error('[room-theme] view urls failed:', error)
    return fail('Could not load room pictures.')
  }
}

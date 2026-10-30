'use server'

import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'
import { createClient } from '@/lib/supabase/server'
import { friendlyRosterError } from '@/lib/roster'

/**
 * Headshots for the Live Roster board.
 *
 * - Which photos the caller may see is decided by the database: roster_snapshot() only answers for the
 *   owner, admin or a regular teacher of the center with the roster on. A key is only signed if that call
 *   returned it, so a caller can never ask for an arbitrary object.
 * - Child photos live in the child bucket (R2_CHILD_BUCKET) under child/<center>/<child>/; staff photos are the
 *   existing profile photos in the employee bucket under avatars/. Anything else is skipped.
 * - Links last an hour; the board asks again when it reloads. A missing bucket setting means initials, not an error.
 */
const PHOTO_URL_TTL_SECONDS = 3600

type Fail = { success: false; error: string }

export async function getRosterPhotoUrls(centerId: string): Promise<{ success: true; urls: Record<string, string> } | Fail> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Please sign in again.' }

    const { data, error } = await supabase.rpc('roster_snapshot', { p_center_id: centerId })
    if (error) return { success: false, error: friendlyRosterError(error) }

    const childBucket = process.env.R2_CHILD_BUCKET
    const staffBucket = process.env.R2_EMPLOYEE_BUCKET
    const rows = (data ?? []) as { kind: 'child' | 'staff'; person_id: string; photo: string | null }[]

    const signed = await Promise.all(rows.map(async row => {
      if (!row.photo) return null
      let bucket: string | undefined
      if (row.kind === 'child' && row.photo.startsWith(`child/${centerId}/${row.person_id}/`)) bucket = childBucket
      if (row.kind === 'staff' && row.photo.startsWith('avatars/')) bucket = staffBucket
      if (!bucket) return null
      try {
        const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: row.photo }), { expiresIn: PHOTO_URL_TTL_SECONDS })
        return [row.person_id, url] as const
      } catch {
        return null
      }
    }))

    return { success: true, urls: Object.fromEntries(signed.filter((x): x is readonly [string, string] => !!x)) }
  } catch (error) {
    console.error('[roster] photo urls failed:', error)
    return { success: false, error: 'Could not load photos.' }
  }
}

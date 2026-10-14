'use server'

import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'
import { createClient } from '@/lib/supabase/server'

// Staff profile photos live in the (private) employee bucket under this prefix.
// staff_profiles.avatar_url stores the object key, not a URL.
const AVATAR_PREFIX = 'avatars/'
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

function avatarBucket() {
  const bucket = process.env.R2_EMPLOYEE_BUCKET
  if (!bucket) throw new Error('R2_EMPLOYEE_BUCKET env var is not set on this server')
  return bucket
}

/** Presigned PUT URL for a new profile photo (images only) */
export async function getAvatarUploadUrl(fileName: string, contentType: string) {
  try {
    if (!ALLOWED_TYPES.includes(contentType)) {
      return { success: false, error: 'Please choose a JPG, PNG, WebP or GIF image.' }
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Not signed in' }

    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]+/g, '-').toLowerCase()
    const fileKey = `${AVATAR_PREFIX}${user.id}/${Date.now()}-${sanitizedFileName}`

    const command = new PutObjectCommand({ Bucket: avatarBucket(), Key: fileKey, ContentType: contentType })
    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 600 })

    return { success: true, uploadUrl, fileKey }
  } catch (error) {
    console.error('Error generating avatar upload URL:', error)
    return { success: false, error: 'Failed to prepare photo upload' }
  }
}

/** Short-lived view URL for a profile photo key. Only avatar keys are accepted. */
export async function getAvatarViewUrl(fileKey: string) {
  try {
    if (!fileKey?.startsWith(AVATAR_PREFIX)) return { success: false as const }

    const command = new GetObjectCommand({ Bucket: avatarBucket(), Key: fileKey })
    const url = await getSignedUrl(r2, command, { expiresIn: 3600 })
    return { success: true as const, url }
  } catch (error) {
    console.error('Error generating avatar view URL:', error)
    return { success: false as const }
  }
}

/** Deletes a profile photo, only if it belongs to the signed-in user. */
export async function deleteAvatar(fileKey: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !fileKey?.startsWith(`${AVATAR_PREFIX}${user.id}/`)) {
      return { success: false, error: 'Not allowed' }
    }

    await r2.send(new DeleteObjectCommand({ Bucket: avatarBucket(), Key: fileKey }))
    return { success: true }
  } catch (error) {
    console.error('Error deleting avatar:', error)
    return { success: false, error: 'Failed to delete photo' }
  }
}

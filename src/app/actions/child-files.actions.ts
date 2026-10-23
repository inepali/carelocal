'use server'

import { randomUUID } from 'crypto'
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'
import { createClient } from '@/lib/supabase/server'

/**
 * Storage for children's records. Kept apart from staff documents on purpose, so every child action can be
 * reviewed in one file.
 *
 * - Files live in their own bucket (R2_CHILD_BUCKET) under child/<center>/<child>/. There is NO fallback to a
 *   shared bucket: a missing setting is an error, never a quiet downgrade.
 * - Access is decided by the database: a child is visible only to the owner or admin of its center
 *   (row-level security). Each action first reads the child or file row with the CALLER's session, so someone
 *   without access gets "not found". The service role is never used here.
 * - View links last 5 minutes. Opening a file is FAIL-CLOSED: if the view cannot be written to the access log,
 *   the file does not open.
 * - Only PDFs and photos of forms. No Word documents.
 */
const VIEW_URL_TTL_SECONDS = 300
const UPLOAD_URL_TTL_SECONDS = 600
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

type Fail = { success: false; error: string }
const fail = (error: string): Fail => ({ success: false, error })
const NOT_FOUND = 'Child not found or you do not have access to it.'

/** A plain-language answer when the storage bucket has not been set up, instead of a generic failure */
const NOT_CONFIGURED = 'File storage for child records is not set up yet. Ask your administrator to set R2_CHILD_BUCKET.'
const setupProblem = (error: unknown) => (error instanceof Error && error.message.includes('R2_CHILD_BUCKET') ? NOT_CONFIGURED : null)

function childBucket() {
  const bucket = process.env.R2_CHILD_BUCKET
  if (!bucket) throw new Error('R2_CHILD_BUCKET is not set')
  return bucket
}

async function session() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

/** The child, only if the caller may see it (RLS: owner or admin of that center) */
async function readableChild(supabase: Awaited<ReturnType<typeof createClient>>, childId: string) {
  const { data } = await supabase.from('children').select('id, center_id').eq('id', childId).maybeSingle()
  return data as { id: string; center_id: string } | null
}

/** Step 1 of an upload: a short-lived link to PUT one file to. Nothing is recorded until registerChildFile. */
export async function getChildUploadUrl(childId: string, contentType: string, sizeBytes: number) {
  try {
    const { supabase, user } = await session()
    if (!user) return fail('Please sign in again.')
    const child = await readableChild(supabase, childId)
    if (!child) return fail(NOT_FOUND)

    const ext = ALLOWED_TYPES[contentType]
    if (!ext) return fail('Please upload a PDF or a photo (JPG, PNG, WebP, HEIC).')
    if (!sizeBytes || sizeBytes > MAX_UPLOAD_BYTES) return fail('Files must be smaller than 15 MB.')

    const bucketName = childBucket()
    const fileKey = `child/${child.center_id}/${child.id}/${randomUUID()}.${ext}`
    const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: bucketName, Key: fileKey, ContentType: contentType, ContentLength: sizeBytes,
    }), { expiresIn: UPLOAD_URL_TTL_SECONDS })
    return { success: true as const, uploadUrl, fileKey, bucketName }
  } catch (error) {
    console.error('[child-files] upload url failed:', error)
    return fail(setupProblem(error) ?? 'Failed to prepare the upload.')
  }
}

/**
 * Step 2: record the uploaded file. The object must really exist in the child bucket under this child's
 * folder, so a made-up key cannot be registered. The row is written with the caller's session, so the database
 * rules (access, key prefix, requirement belongs to this center's child rules) apply again.
 */
export async function registerChildFile(childId: string, input: {
  fileKey: string
  fileName: string
  contentType: string
  requirementId?: string | null
}) {
  try {
    const { supabase, user } = await session()
    if (!user) return fail('Please sign in again.')
    const child = await readableChild(supabase, childId)
    if (!child) return fail(NOT_FOUND)

    const prefix = `child/${child.center_id}/${child.id}/`
    if (!input.fileKey.startsWith(prefix) || input.fileKey.includes('..')) return fail('That file is not in this child’s folder.')
    if (!ALLOWED_TYPES[input.contentType]) return fail('Please upload a PDF or a photo (JPG, PNG, WebP, HEIC).')

    const bucketName = childBucket()
    let size: number | undefined
    try {
      const head = await r2.send(new HeadObjectCommand({ Bucket: bucketName, Key: input.fileKey }))
      size = head.ContentLength
    } catch {
      return fail('The upload did not finish. Please try again.')
    }
    if (size != null && size > MAX_UPLOAD_BYTES) return fail('Files must be smaller than 15 MB.')

    const { data, error } = await supabase.from('child_files').insert({
      center_id: child.center_id,
      child_id: child.id,
      requirement_id: input.requirementId ?? null,
      file_key: input.fileKey,
      bucket_name: bucketName,
      file_name: input.fileName.slice(0, 200),
      content_type: input.contentType,
      size_bytes: size ?? null,
      source: 'center',
      uploaded_by: user.id,
    }).select('id').single()
    if (error || !data) {
      // The object is already in storage: do not leave an unregistered file behind
      await r2.send(new DeleteObjectCommand({ Bucket: bucketName, Key: input.fileKey })).catch(() => {})
      return fail(error?.message ?? 'Could not save the file.')
    }
    return { success: true as const, fileId: data.id as string }
  } catch (error) {
    console.error('[child-files] register failed:', error)
    return fail(setupProblem(error) ?? 'Failed to save the file.')
  }
}

/** A 5-minute link to one file. FAIL-CLOSED: the view must be logged first. */
export async function getChildFileUrl(fileId: string) {
  try {
    const { supabase, user } = await session()
    if (!user) return fail('Please sign in again.')

    const { data: file } = await supabase.from('child_files')
      .select('id, center_id, child_id, file_key, bucket_name').eq('id', fileId).maybeSingle()
    if (!file) return fail('Document not found or you do not have access to it.')
    if (file.bucket_name !== childBucket()) return fail('Document not found or you do not have access to it.')

    const { error: logError } = await supabase.from('document_access_log').insert({
      user_id: user.id, document_kind: 'child', document_id: file.id,
      center_id: file.center_id, child_id: file.child_id, is_confidential: true,
    })
    if (logError) {
      console.error('[child-files] access log failed, refusing to open the file:', logError)
      return fail('Could not record this access, so the document was not opened. Please try again.')
    }

    const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: file.bucket_name, Key: file.file_key }), { expiresIn: VIEW_URL_TTL_SECONDS })
    return { success: true as const, url }
  } catch (error) {
    console.error('[child-files] view url failed:', error)
    return fail(setupProblem(error) ?? 'Failed to open the document.')
  }
}

/** Deletes the row (if the caller may) and then the stored object */
export async function deleteChildFile(fileId: string) {
  try {
    const { supabase, user } = await session()
    if (!user) return fail('Please sign in again.')
    const { data: file } = await supabase.from('child_files').select('id, file_key, bucket_name').eq('id', fileId).maybeSingle()
    if (!file) return fail('Document not found or you do not have access to it.')

    const { data: removed, error } = await supabase.from('child_files').delete().eq('id', fileId).select('id')
    if (error || !removed?.length) return fail(error?.message ?? 'Could not delete the file.')

    try {
      await r2.send(new DeleteObjectCommand({ Bucket: file.bucket_name, Key: file.file_key }))
    } catch (storageError) {
      console.error('[child-files] row deleted but the stored object remains:', file.bucket_name, file.file_key, storageError)
    }
    return { success: true as const }
  } catch (error) {
    console.error('[child-files] delete failed:', error)
    return fail(setupProblem(error) ?? 'Failed to delete the file.')
  }
}

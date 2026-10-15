'use server'

import { randomUUID } from 'crypto'
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'
import { createClient } from '@/lib/supabase/server'

/**
 * Secure document storage.
 *
 * - Files are addressed by the database row that owns them, never by a key/bucket
 *   supplied by the browser. Rows are read with the caller's session, so RLS decides
 *   who may see what (including the confidential/medical rule).
 * - Buckets are chosen by kind on the server.
 * - New keys are namespaced per owner (enforced again by a DB trigger).
 * - View links expire after 5 minutes and every view is written to document_access_log.
 */
export type FileKind = 'vault' | 'internal' | 'template' | 'inspection'

const VIEW_URL_TTL_SECONDS = 300
const UPLOAD_URL_TTL_SECONDS = 600
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

function bucketFor(kind: FileKind) {
  const bucket = kind === 'vault'
    ? process.env.R2_EMPLOYEE_BUCKET
    : kind === 'internal' || kind === 'inspection'
      ? process.env.R2_CENTER_BUCKET_INTERNAL
      : process.env.R2_CENTER_BUCKET
  if (!bucket) throw new Error(`Storage bucket for ${kind} files is not configured`)
  return bucket
}

type Fail = { success: false; error: string }
const fail = (error: string): Fail => ({ success: false, error })

async function getSessionContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

async function getAdminCenterId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from('center_admins')
    .select('center_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  return data?.center_id as string | undefined
}

// ─── Upload ──────────────────────────────────────────────────────────────────

/**
 * Presigned PUT for a new file. `vault` = the signed-in staff member's library;
 * `internal` / `template` = the signed-in admin's center.
 */
export async function getUploadUrl(kind: FileKind, contentType: string, sizeBytes: number) {
  try {
    const { supabase, user } = await getSessionContext()
    if (!user) return fail('Please sign in again.')

    const ext = ALLOWED_TYPES[contentType]
    if (!ext) return fail('Please upload a PDF, image (JPG, PNG, WebP, HEIC) or Word document.')
    if (!sizeBytes || sizeBytes > MAX_UPLOAD_BYTES) return fail('Files must be smaller than 15 MB.')

    let owner: string
    if (kind === 'vault') {
      owner = user.id
    } else {
      const centerId = await getAdminCenterId(supabase, user.id)
      if (!centerId) return fail('Only center admins can upload center files.')
      owner = centerId
    }

    const bucketName = bucketFor(kind)
    const fileKey = `${kind}/${owner}/${randomUUID()}.${ext}`
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      ContentType: contentType,
      ContentLength: sizeBytes,
    })
    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: UPLOAD_URL_TTL_SECONDS })

    return { success: true as const, uploadUrl, fileKey, bucketName }
  } catch (error) {
    console.error('Error generating upload URL:', error)
    return fail('Failed to prepare the upload.')
  }
}

// ─── View ────────────────────────────────────────────────────────────────────

/** Short-lived view link for a document the caller is allowed to read (RLS-checked). */
export async function getFileViewUrl(kind: FileKind, id: string) {
  try {
    const { supabase, user } = await getSessionContext()
    if (!user) return fail('Please sign in again.')

    let fileKey: string | null = null
    let staffId: string | null = null
    let centerId: string | null = null
    let isConfidential = false

    if (kind === 'vault') {
      const { data } = await supabase.from('staff_documents').select('file_key, staff_id').eq('id', id).maybeSingle()
      fileKey = data?.file_key ?? null
      staffId = data?.staff_id ?? null
      if (data) {
        // Viewing someone else's document means acting for a center
        const { data: own } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
        if (own?.id !== staffId) {
          centerId = (await getAdminCenterId(supabase, user.id)) ?? null
          const { data: link } = await supabase
            .from('center_staff_document_status')
            .select('requirement:center_document_requirements(is_confidential)')
            .eq('matched_document_id', id)
            .limit(1)
            .maybeSingle()
          const req = link?.requirement as { is_confidential?: boolean } | { is_confidential?: boolean }[] | null | undefined
          isConfidential = !!(Array.isArray(req) ? req[0]?.is_confidential : req?.is_confidential)
        }
      }
    } else if (kind === 'internal') {
      const { data } = await supabase
        .from('center_internal_documents')
        .select('file_key, staff_id, center_id, requirement:center_document_requirements(is_confidential)')
        .eq('id', id)
        .maybeSingle()
      fileKey = data?.file_key ?? null
      staffId = data?.staff_id ?? null
      centerId = data?.center_id ?? null
      const req = data?.requirement as { is_confidential?: boolean } | { is_confidential?: boolean }[] | null | undefined
      isConfidential = !!(Array.isArray(req) ? req[0]?.is_confidential : req?.is_confidential)
    } else if (kind === 'inspection') {
      const { data } = await supabase.from('center_inspection_files').select('file_key, center_id').eq('id', id).maybeSingle()
      fileKey = data?.file_key ?? null
      centerId = data?.center_id ?? null
    } else {
      const { data } = await supabase.from('center_document_requirements').select('template_file_key, center_id').eq('id', id).maybeSingle()
      fileKey = data?.template_file_key ?? null
      centerId = data?.center_id ?? null
    }

    // RLS hid the row, or it has no file: same answer either way
    if (!fileKey) return fail('Document not found or you do not have access to it.')

    const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucketFor(kind), Key: fileKey }), { expiresIn: VIEW_URL_TTL_SECONDS })

    if (kind !== 'template') {
      const { error: logError } = await supabase.from('document_access_log').insert({
        user_id: user.id,
        document_kind: kind,
        document_id: id,
        center_id: centerId,
        staff_id: staffId,
        is_confidential: isConfidential,
      })
      if (logError) console.error('Failed to write document access log:', logError)
    }

    return { success: true as const, url }
  } catch (error) {
    console.error('Error generating view URL:', error)
    return fail('Failed to open the document.')
  }
}

// ─── Delete ──────────────────────────────────────────────────────────────────

async function removeObject(kind: FileKind, fileKey: string | null | undefined) {
  if (!fileKey) return
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: bucketFor(kind), Key: fileKey }))
  } catch (error) {
    // The row is already gone; an orphaned object is not fatal
    console.error('Failed to delete storage object:', error)
  }
}

/** Staff: delete a document from their own library (blocked by the DB if a center accepted it). */
export async function deleteVaultDocument(id: string) {
  const { supabase, user } = await getSessionContext()
  if (!user) return fail('Please sign in again.')

  const { data: own } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
  const { data: doc } = await supabase.from('staff_documents').select('file_key, staff_id').eq('id', id).maybeSingle()
  if (!doc || !own || doc.staff_id !== own.id) return fail('Document not found.')

  const { error } = await supabase.from('staff_documents').delete().eq('id', id)
  if (error) return fail(error.message)

  await removeObject('vault', doc.file_key)
  return { success: true as const }
}

/** Center: delete a center-held document. */
/** Center: delete an inspection report file. */
export async function deleteInspectionFile(id: string) {
  const { supabase, user } = await getSessionContext()
  if (!user) return fail('Please sign in again.')

  const { data: file } = await supabase.from('center_inspection_files').select('file_key').eq('id', id).maybeSingle()
  if (!file) return fail('File not found.')

  const { error } = await supabase.from('center_inspection_files').delete().eq('id', id)
  if (error) return fail(error.message)

  await removeObject('inspection', file.file_key)
  return { success: true as const }
}

export async function deleteInternalDocument(id: string) {
  const { supabase, user } = await getSessionContext()
  if (!user) return fail('Please sign in again.')

  const { data: doc } = await supabase.from('center_internal_documents').select('file_key').eq('id', id).maybeSingle()
  if (!doc) return fail('Document not found.')

  const { error } = await supabase.from('center_internal_documents').delete().eq('id', id)
  if (error) return fail(error.message)

  await removeObject('internal', doc.file_key)
  return { success: true as const }
}

/** Center: remove a requirement's blank form/template (clears the columns, then deletes the file). */
export async function removeRequirementTemplate(requirementId: string) {
  const { supabase, user } = await getSessionContext()
  if (!user) return fail('Please sign in again.')

  const { data: req } = await supabase
    .from('center_document_requirements')
    .select('template_file_key, center_id')
    .eq('id', requirementId)
    .maybeSingle()
  if (!req || req.center_id !== await getAdminCenterId(supabase, user.id)) return fail('Requirement not found.')
  if (!req.template_file_key) return { success: true as const }

  const { error } = await supabase
    .from('center_document_requirements')
    .update({ template_file_key: null, template_bucket_name: null, template_file_name: null })
    .eq('id', requirementId)
  if (error) return fail(error.message)

  await removeObject('template', req.template_file_key)
  return { success: true as const }
}

'use server'

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'
import { getSignedInUserId, isCenterAdminOf } from '@/lib/server/staff-access'

/**
 * Upload from phone (QR handoff).
 *
 * Desktop (signed-in center admin): createUploadHandoff -> show QR -> poll getHandoffStatus ->
 *   attachHandoff (adds it to the employee's checklist item) or discardHandoff.
 * Phone (no sign-in, holds the token from the QR): getCaptureDetails -> getCaptureUploadUrl ->
 *   PUT the file -> completeCapture.
 *
 * The token is a 256-bit secret; only its hash is stored. A handoff lasts 10 minutes, is scoped to one
 * employee + checklist item, works once, and the phone can only upload: it never sees documents.
 */

const admin = () => createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const HANDOFF_MINUTES = 10
const MAX_UPLOAD_ATTEMPTS = 5
const MAX_BYTES = 15 * 1024 * 1024
const UPLOAD_URL_TTL_SECONDS = 300
const PREVIEW_URL_TTL_SECONDS = 300

const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

const fail = (error: string) => ({ success: false as const, error })

/**
 * Runs a handoff step so an unexpected exception never reaches the browser (production React only
 * shows it as "Minified React error #441"). The real reason is logged on the server.
 */
async function guarded<T>(step: string, run: () => Promise<T>): Promise<T | { success: false; error: string }> {
  // Server settings this feature needs. Only the NAMES are reported, never values.
  const missing = REQUIRED_ENV.filter(name => !process.env[name])
  if (missing.length) {
    console.error('[upload-handoff] missing server settings:', missing.join(', '))
    return fail(`Phone upload is not set up on the server yet (missing ${missing.join(', ')}). Please tell your administrator.`)
  }
  try {
    return await run()
  } catch (error) {
    console.error('[upload-handoff] ' + step + ' failed:', error)
    // A short, non-sensitive reason helps whoever reads the screenshot
    const reason = error instanceof Error ? (error.name && error.name !== 'Error' ? error.name : error.message).slice(0, 80) : 'unknown'
    return fail(`Something went wrong on our side (${step}: ${reason}). Please try again in a moment.`)
  }
}

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_CENTER_BUCKET_INTERNAL',
]
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

function bucket() {
  const name = process.env.R2_CENTER_BUCKET_INTERNAL
  if (!name) throw new Error('R2_CENTER_BUCKET_INTERNAL is not set')
  return name
}

async function siteOrigin() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'carelocal.co'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

type HandoffRow = {
  id: string
  center_id: string
  staff_id: string
  requirement_id: string | null
  status: string
  file_key: string | null
  file_name: string | null
  content_type: string | null
  size_bytes: number | null
  upload_attempts: number
  expires_at: string
}

const isExpired = (row: Pick<HandoffRow, 'expires_at'>) => new Date(row.expires_at).getTime() < Date.now()

async function loadByToken(token: string) {
  if (!token || token.length < 20) return null
  const { data } = await admin().from('upload_handoffs').select('*').eq('token_hash', hashToken(token)).maybeSingle()
  return data as HandoffRow | null
}

/** Desktop calls: the signed-in user must administer the handoff's center. */
async function loadForAdmin(handoffId: string) {
  const userId = await getSignedInUserId()
  if (!userId) return { row: null, error: 'Please sign in again.' }
  const { data } = await admin().from('upload_handoffs').select('*').eq('id', handoffId).maybeSingle()
  const row = data as HandoffRow | null
  if (!row || !(await isCenterAdminOf(userId, row.center_id))) return { row: null, error: 'Not found' }
  return { row, error: null }
}

// ─── Desktop ─────────────────────────────────────────────────────────────────

export async function createUploadHandoff(centerId: string, staffId: string, requirementId: string | null) {
  return guarded('createUploadHandoff', async () => {
    const userId = await getSignedInUserId()
    if (!userId) return fail('Please sign in again.')
    if (!(await isCenterAdminOf(userId, centerId))) return fail('Not allowed')

    const db = admin()
    const { data: membership } = await db.from('center_staff').select('staff_id').eq('center_id', centerId).eq('staff_id', staffId).maybeSingle()
    if (!membership) return fail('This employee is not part of your center.')
    if (requirementId) {
      const { data: req } = await db.from('center_document_requirements').select('id').eq('id', requirementId).eq('center_id', centerId).maybeSingle()
      if (!req) return fail('Checklist item not found.')
    }

    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + HANDOFF_MINUTES * 60 * 1000).toISOString()
    const { data, error } = await db.from('upload_handoffs').insert({
      token_hash: hashToken(token),
      center_id: centerId,
      staff_id: staffId,
      requirement_id: requirementId,
      created_by: userId,
      expires_at: expiresAt,
    }).select('id').single()
    if (error || !data) return fail(error?.message ?? 'Could not start the phone upload.')

    return { success: true as const, handoffId: data.id as string, url: `${await siteOrigin()}/capture/${token}`, expiresAt }
  })
}

export async function getHandoffStatus(handoffId: string) {
  return guarded('getHandoffStatus', async () => {
    const { row, error } = await loadForAdmin(handoffId)
    if (!row) return fail(error!)

    let previewUrl: string | null = null
    if (row.status === 'uploaded' && row.file_key) {
      previewUrl = await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket(), Key: row.file_key }), { expiresIn: PREVIEW_URL_TTL_SECONDS })
    }
    return {
      success: true as const,
      status: (row.status === 'pending' && isExpired(row) ? 'expired' : row.status) as 'pending' | 'uploaded' | 'attached' | 'discarded' | 'expired',
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: row.size_bytes,
      previewUrl,
    }
  })
}

/** Adds the uploaded file to the employee's checklist item as a center-held document. */
export async function attachHandoff(handoffId: string, documentName: string) {
  return guarded('attachHandoff', async () => {
    const { row, error } = await loadForAdmin(handoffId)
    if (!row) return fail(error!)
    if (row.status !== 'uploaded' || !row.file_key) return fail('Nothing has been uploaded yet.')

    const db = admin()
    const { error: insertError } = await db.from('center_internal_documents').insert({
      center_id: row.center_id,
      staff_id: row.staff_id,
      requirement_id: row.requirement_id,
      document_name: documentName.trim() || row.file_name || 'Scanned document',
      file_url: 'r2_private_access',
      file_key: row.file_key,
      bucket_name: bucket(),
    })
    if (insertError) return fail(insertError.message)

    await db.from('upload_handoffs').update({ status: 'attached' }).eq('id', row.id)
    return { success: true as const }
  })
}

/** Throws away an unattached upload (or cancels a handoff nobody used). */
export async function discardHandoff(handoffId: string) {
  return guarded('discardHandoff', async () => {
    const { row, error } = await loadForAdmin(handoffId)
    if (!row) return fail(error!)
    if (row.status === 'attached') return { success: true as const }

    if (row.file_key) {
      await r2.send(new DeleteObjectCommand({ Bucket: bucket(), Key: row.file_key })).catch(() => {})
    }
    await admin().from('upload_handoffs').update({ status: 'discarded', file_key: null }).eq('id', row.id)
    return { success: true as const }
  })
}

// ─── Phone (token, no sign-in) ───────────────────────────────────────────────

/** What the phone page shows. Deliberately minimal: center, the employee's first name, the item. */
export async function getCaptureDetails(token: string) {
  return guarded('getCaptureDetails', async () => {
    const row = await loadByToken(token)
    if (!row) return fail('This link is not valid. Scan the QR code again from the computer.')
    if (row.status === 'uploaded' || row.status === 'attached') return fail('This document was already sent. You can close this page.')
    if (row.status !== 'pending') return fail('This upload was cancelled. Scan a new QR code from the computer.')
    if (isExpired(row)) return fail('This link has expired. Scan a new QR code from the computer.')

    const db = admin()
    const [{ data: center }, { data: staff }, { data: req }] = await Promise.all([
      db.from('centers').select('name').eq('id', row.center_id).maybeSingle(),
      db.from('staff_profiles').select('first_name, last_name').eq('id', row.staff_id).maybeSingle(),
      row.requirement_id
        ? db.from('center_document_requirements').select('document_name').eq('id', row.requirement_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    return {
      success: true as const,
      centerName: center?.name ?? 'Your center',
      employeeName: staff ? `${staff.first_name} ${String(staff.last_name ?? '').charAt(0)}.` : 'Employee',
      documentName: (req as { document_name?: string } | null)?.document_name ?? 'Document',
      expiresAt: row.expires_at,
    }
  })
}

export async function getCaptureUploadUrl(token: string, contentType: string, sizeBytes: number) {
  return guarded('getCaptureUploadUrl', async () => {
    const row = await loadByToken(token)
    if (!row || row.status !== 'pending' || isExpired(row)) return fail('This link is no longer valid. Scan a new QR code from the computer.')
    if (row.upload_attempts >= MAX_UPLOAD_ATTEMPTS) return fail('Too many attempts. Scan a new QR code from the computer.')

    const ext = ALLOWED_TYPES[contentType]
    if (!ext) return fail('Please send a photo or a PDF.')
    if (!sizeBytes || sizeBytes > MAX_BYTES) return fail('The file must be smaller than 15 MB.')

    const fileKey = `employee_files/${row.center_id}/${row.staff_id}/${randomUUID()}.${ext}`
    await admin().from('upload_handoffs')
      .update({ file_key: fileKey, upload_attempts: row.upload_attempts + 1 })
      .eq('id', row.id).eq('status', 'pending')

    const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: bucket(), Key: fileKey, ContentType: contentType, ContentLength: sizeBytes,
    }), { expiresIn: UPLOAD_URL_TTL_SECONDS })
    return { success: true as const, uploadUrl, fileKey }
  })
}

export async function completeCapture(token: string, fileKey: string, fileName: string) {
  return guarded('completeCapture', async () => {
    const row = await loadByToken(token)
    if (!row || row.status !== 'pending' || isExpired(row)) return fail('This link is no longer valid. Scan a new QR code from the computer.')
    // Only the key this handoff issued, and only once the object really exists
    if (!row.file_key || row.file_key !== fileKey) return fail('Upload not recognised. Please try again.')

    let head
    try {
      head = await r2.send(new HeadObjectCommand({ Bucket: bucket(), Key: fileKey }))
    } catch {
      return fail('The upload did not finish. Please try again.')
    }
    if ((head.ContentLength ?? 0) > MAX_BYTES) {
      await r2.send(new DeleteObjectCommand({ Bucket: bucket(), Key: fileKey })).catch(() => {})
      return fail('The file must be smaller than 15 MB.')
    }

    const { error } = await admin().from('upload_handoffs').update({
      status: 'uploaded',
      file_name: fileName.slice(0, 120) || 'Scanned document',
      content_type: head.ContentType ?? null,
      size_bytes: head.ContentLength ?? null,
      uploaded_at: new Date().toISOString(),
    }).eq('id', row.id).eq('status', 'pending')
    if (error) return fail('Could not finish the upload. Please try again.')
    return { success: true as const }
  })
}

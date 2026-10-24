'use server'

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'
import { getSignedInUserId, isCenterAdminOf } from '@/lib/server/staff-access'

/**
 * Upload from phone (QR handoff), for every upload area in the app.
 *
 * Desktop (signed in): createUploadHandoff -> show QR -> poll getHandoffStatus ->
 *   claimHandoff (the screen then saves the file exactly like a normal upload) or discardHandoff.
 * Phone (no sign-in, holds the token from the QR): getCaptureDetails -> getCaptureUploadUrl ->
 *   PUT the file -> completeCapture.
 *
 * The token is a 256-bit secret; only its hash is stored. A handoff lasts 10 minutes, belongs to the
 * person who created it, works once, and the phone can only upload: it never sees documents.
 */

export type HandoffKind = 'internal' | 'inspection' | 'template' | 'vault' | 'receipt'

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

// Same buckets the normal uploads use (see storage.actions.ts)
const BUCKET_ENV: Record<HandoffKind, string> = {
  vault: 'R2_EMPLOYEE_BUCKET',
  internal: 'R2_CENTER_BUCKET_INTERNAL',
  inspection: 'R2_CENTER_BUCKET_INTERNAL',
  template: 'R2_CENTER_BUCKET',
  receipt: 'R2_RECEIPT_BUCKET',
}

const BASE_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']

const fail = (error: string) => ({ success: false as const, error })
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** A server setting is missing. Only its NAME is ever shown. */
class MissingSettingError extends Error {}

function bucketFor(kind: HandoffKind) {
  const name = process.env[BUCKET_ENV[kind]]
  if (!name) throw new MissingSettingError(BUCKET_ENV[kind])
  return name
}

/**
 * Runs a handoff step so an unexpected exception never reaches the browser (production React only
 * shows it as "Minified React error #441"). The real reason is logged on the server.
 */
async function guarded<T>(step: string, run: () => Promise<T>): Promise<T | { success: false; error: string }> {
  const missing = BASE_ENV.filter(name => !process.env[name])
  try {
    if (missing.length) throw new MissingSettingError(missing.join(', '))
    return await run()
  } catch (error) {
    if (error instanceof MissingSettingError) {
      console.error('[upload-handoff] missing server settings:', error.message)
      return fail(`Phone upload is not set up on the server yet (missing ${error.message}). Please tell your administrator.`)
    }
    console.error('[upload-handoff] ' + step + ' failed:', error)
    const reason = error instanceof Error ? (error.name && error.name !== 'Error' ? error.name : error.message).slice(0, 80) : 'unknown'
    return fail(`Something went wrong on our side (${step}: ${reason}). Please try again in a moment.`)
  }
}

async function siteOrigin() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'carelocal.co'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

type HandoffRow = {
  id: string
  kind: HandoffKind
  label: string | null
  center_id: string | null
  staff_id: string | null
  created_by: string | null
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

/** Desktop calls: only the person who created the handoff can use it. */
async function loadForCreator(handoffId: string) {
  const userId = await getSignedInUserId()
  if (!userId) return { row: null, error: 'Please sign in again.' }
  const { data } = await admin().from('upload_handoffs').select('*').eq('id', handoffId).maybeSingle()
  const row = data as HandoffRow | null
  if (!row || row.created_by !== userId) return { row: null, error: 'Not found' }
  return { row, error: null }
}

async function adminCenterId(userId: string) {
  const { data } = await admin().from('center_admins').select('center_id').eq('user_id', userId).limit(1).maybeSingle()
  return (data?.center_id as string | undefined) ?? null
}

// ─── Desktop ─────────────────────────────────────────────────────────────────

/**
 * Starts a phone upload.
 *   internal   center admin, for one of the center's employees (staffId required)
 *   inspection center admin, center-wide
 *   template   center admin, center-wide
 *   vault      a staff member, into their own library
 */
export async function createUploadHandoff(input: { kind: HandoffKind; label: string; staffId?: string | null }) {
  return guarded('createUploadHandoff', async () => {
    const userId = await getSignedInUserId()
    if (!userId) return fail('Please sign in again.')
    bucketFor(input.kind) // fail early if storage for this area is not configured

    const db = admin()
    let centerId: string | null = null
    let staffId: string | null = null

    if (input.kind === 'vault') {
      const { data: profile } = await db.from('staff_profiles').select('id').eq('user_id', userId).maybeSingle()
      if (!profile) return fail('Only staff members can add documents to a library.')
      staffId = profile.id
    } else {
      centerId = await adminCenterId(userId)
      if (!centerId || !(await isCenterAdminOf(userId, centerId))) return fail('Only center admins can do this.')
      if (input.kind === 'receipt') {
        // Owner and administrators only, the same rule the database applies to receipts
        const { data: member } = await db.from('center_admins').select('role').eq('center_id', centerId).eq('user_id', userId).maybeSingle()
        if (!member || !['owner', 'admin'].includes(member.role as string)) return fail('Only the owner and administrators can add receipts.')
      }
      if (input.kind === 'internal') {
        if (!input.staffId) return fail('Choose an employee first.')
        const { data: membership } = await db.from('center_staff').select('staff_id').eq('center_id', centerId).eq('staff_id', input.staffId).maybeSingle()
        if (!membership) return fail('This employee is not part of your center.')
        staffId = input.staffId
      }
    }

    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + HANDOFF_MINUTES * 60 * 1000).toISOString()
    const { data, error } = await db.from('upload_handoffs').insert({
      token_hash: hashToken(token),
      kind: input.kind,
      label: input.label.slice(0, 120),
      center_id: centerId,
      staff_id: staffId,
      created_by: userId,
      expires_at: expiresAt,
    }).select('id').single()
    if (error || !data) return fail(error?.message ?? 'Could not start the phone upload.')

    return { success: true as const, handoffId: data.id as string, url: `${await siteOrigin()}/capture/${token}`, expiresAt }
  })
}

export async function getHandoffStatus(handoffId: string) {
  return guarded('getHandoffStatus', async () => {
    const { row, error } = await loadForCreator(handoffId)
    if (!row) return fail(error!)

    let previewUrl: string | null = null
    if (row.status === 'uploaded' && row.file_key) {
      previewUrl = await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucketFor(row.kind), Key: row.file_key }), { expiresIn: PREVIEW_URL_TTL_SECONDS })
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

/**
 * Hands the uploaded file to the desktop, which then saves it like any other upload (the same
 * insert it does after a normal file pick). Marks the handoff as used.
 */
export async function claimHandoff(handoffId: string) {
  return guarded('claimHandoff', async () => {
    const { row, error } = await loadForCreator(handoffId)
    if (!row) return fail(error!)
    if (row.status !== 'uploaded' || !row.file_key) return fail('Nothing has been uploaded yet.')

    const { data: claimed } = await admin().from('upload_handoffs')
      .update({ status: 'attached' }).eq('id', row.id).eq('status', 'uploaded').select('id').maybeSingle()
    if (!claimed) return fail('This upload was already used.')

    return {
      success: true as const,
      fileKey: row.file_key,
      bucketName: bucketFor(row.kind),
      fileName: row.file_name ?? 'Scanned document',
      contentType: row.content_type ?? 'application/octet-stream',
      sizeBytes: row.size_bytes ?? 0,
    }
  })
}

/**
 * Throws away an upload. Before it is claimed this always deletes the file; after a claim it only does
 * so with `rollback` (the screen could not save it), so a saved document is never removed here.
 */
export async function discardHandoff(handoffId: string, options?: { rollback?: boolean }) {
  return guarded('discardHandoff', async () => {
    const { row, error } = await loadForCreator(handoffId)
    if (!row) return fail(error!)
    if (row.status === 'attached' && !options?.rollback) return { success: true as const }

    if (row.file_key) {
      await r2.send(new DeleteObjectCommand({ Bucket: bucketFor(row.kind), Key: row.file_key })).catch(() => {})
    }
    await admin().from('upload_handoffs').update({ status: 'discarded', file_key: null }).eq('id', row.id)
    return { success: true as const }
  })
}

// ─── Phone (token, no sign-in) ───────────────────────────────────────────────

/** What the phone page shows. Deliberately minimal. */
export async function getCaptureDetails(token: string) {
  return guarded('getCaptureDetails', async () => {
    const row = await loadByToken(token)
    if (!row) return fail('This link is not valid. Scan the QR code again from the computer.')
    if (row.status === 'uploaded' || row.status === 'attached') return fail('This document was already sent. You can close this page.')
    if (row.status !== 'pending') return fail('This upload was cancelled. Scan a new QR code from the computer.')
    if (isExpired(row)) return fail('This link has expired. Scan a new QR code from the computer.')

    const db = admin()
    const [{ data: center }, { data: staff }] = await Promise.all([
      row.center_id ? db.from('centers').select('name').eq('id', row.center_id).maybeSingle() : Promise.resolve({ data: null }),
      row.staff_id ? db.from('staff_profiles').select('first_name, last_name').eq('id', row.staff_id).maybeSingle() : Promise.resolve({ data: null }),
    ])
    const staffRow = staff as { first_name?: string; last_name?: string } | null
    return {
      success: true as const,
      heading: (center as { name?: string } | null)?.name ?? (row.kind === 'vault' ? 'Your document library' : 'Your center'),
      documentName: row.label || 'Document',
      // Only shown when a center is adding a file for an employee
      forName: row.kind === 'internal' && staffRow ? `${staffRow.first_name} ${String(staffRow.last_name ?? '').charAt(0)}.` : null,
      expiresAt: row.expires_at,
    }
  })
}

function storageKey(row: HandoffRow, ext: string) {
  const file = `${randomUUID()}.${ext}`
  switch (row.kind) {
    case 'internal': return `employee_files/${row.center_id}/${row.staff_id}/${file}`
    case 'inspection': return `inspection/${row.center_id}/${file}`
    case 'template': return `template/${row.center_id}/${file}`
    case 'receipt': return `receipts/${row.center_id}/${file}`
    case 'vault': return `vault/${row.created_by}/${file}`
  }
}

export async function getCaptureUploadUrl(token: string, contentType: string, sizeBytes: number) {
  return guarded('getCaptureUploadUrl', async () => {
    const row = await loadByToken(token)
    if (!row || row.status !== 'pending' || isExpired(row)) return fail('This link is no longer valid. Scan a new QR code from the computer.')
    if (row.upload_attempts >= MAX_UPLOAD_ATTEMPTS) return fail('Too many attempts. Scan a new QR code from the computer.')

    const ext = ALLOWED_TYPES[contentType]
    if (!ext) return fail('Please send a photo or a PDF.')
    if (!sizeBytes || sizeBytes > MAX_BYTES) return fail('The file must be smaller than 15 MB.')

    const fileKey = storageKey(row, ext)
    await admin().from('upload_handoffs')
      .update({ file_key: fileKey, upload_attempts: row.upload_attempts + 1 })
      .eq('id', row.id).eq('status', 'pending')

    const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: bucketFor(row.kind), Key: fileKey, ContentType: contentType, ContentLength: sizeBytes,
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

    const bucket = bucketFor(row.kind)
    let head
    try {
      head = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: fileKey }))
    } catch {
      return fail('The upload did not finish. Please try again.')
    }
    if ((head.ContentLength ?? 0) > MAX_BYTES) {
      await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: fileKey })).catch(() => {})
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

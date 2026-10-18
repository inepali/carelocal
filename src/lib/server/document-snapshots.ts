import { randomUUID } from 'crypto'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2 } from '@/lib/r2'

/**
 * Copy-on-accept. A document a center has accepted is copied into the center's own repository
 * (center_internal_documents + the center bucket), so unlinking, replacing or deleting the
 * employee's original never takes the center's record away.
 *
 * Server-only: no permission check here, callers must check first. Safe to call as often as you like: documents that already have a copy are skipped. It is called
 * right after an accept and again whenever an employee's record is opened, which also backfills
 * anything accepted before this existed.
 */

const admin = () => createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

type Wanted = { documentId: string; requirementId: string | null; confidential: boolean }

export async function copyAcceptedDocuments(centerId: string, staffId: string) {
  const sourceBucket = process.env.R2_EMPLOYEE_BUCKET
  const destBucket = process.env.R2_CENTER_BUCKET_INTERNAL
  if (!sourceBucket || !destBucket) return { success: false as const, error: 'Storage is not configured' }

  const db = admin()

  // Everything this center has accepted from this employee: checklist items and answered requests
  const [{ data: accepted }, { data: completed }] = await Promise.all([
    db.from('center_staff_document_status')
      .select('matched_document_id, requirement_id, requirement:center_document_requirements(is_confidential)')
      .eq('center_id', centerId).eq('staff_id', staffId).eq('status', 'accepted')
      .not('matched_document_id', 'is', null),
    db.from('document_requests')
      .select('submitted_document_id, requirement_id, is_confidential')
      .eq('center_id', centerId).eq('staff_id', staffId).eq('status', 'completed')
      .not('submitted_document_id', 'is', null),
  ])

  const wanted = new Map<string, Wanted>()
  for (const row of accepted ?? []) {
    const req = row.requirement as { is_confidential?: boolean } | { is_confidential?: boolean }[] | null
    const confidential = !!(Array.isArray(req) ? req[0]?.is_confidential : req?.is_confidential)
    wanted.set(row.matched_document_id as string, { documentId: row.matched_document_id as string, requirementId: row.requirement_id, confidential })
  }
  for (const row of completed ?? []) {
    const id = row.submitted_document_id as string
    const existing = wanted.get(id)
    wanted.set(id, {
      documentId: id,
      requirementId: existing?.requirementId ?? row.requirement_id ?? null,
      confidential: (existing?.confidential ?? false) || !!row.is_confidential,
    })
  }
  if (wanted.size === 0) return { success: true as const, copied: 0, failed: 0 }

  const ids = [...wanted.keys()]
  const { data: existingCopies } = await db.from('center_internal_documents')
    .select('source_document_id').eq('center_id', centerId).in('source_document_id', ids)
  const alreadyCopied = new Set((existingCopies ?? []).map(c => c.source_document_id as string))

  const todo = ids.filter(id => !alreadyCopied.has(id))
  if (todo.length === 0) return { success: true as const, copied: 0, failed: 0 }

  // Only this employee's own documents can be copied
  const { data: docs } = await db.from('staff_documents')
    .select('id, document_name, file_key, bucket_name, staff_id')
    .in('id', todo).eq('staff_id', staffId)

  let copied = 0
  let failed = 0
  for (const doc of docs ?? []) {
    if (!doc.file_key) continue
    const info = wanted.get(doc.id)!
    const extension = (doc.file_key.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const newKey = `employee_files/${centerId}/${staffId}/${randomUUID()}${extension ? `.${extension}` : ''}`
    const fromBucket = doc.bucket_name || sourceBucket

    try {
      await r2.send(new CopyObjectCommand({
        Bucket: destBucket,
        Key: newKey,
        CopySource: `${fromBucket}/${encodeURIComponent(doc.file_key).replace(/%2F/g, '/')}`,
      }))
    } catch (error) {
      failed++
      console.error('[document-snapshots] could not copy storage object', doc.id, error)
      continue
    }

    const { error: insertError } = await db.from('center_internal_documents').insert({
      center_id: centerId,
      staff_id: staffId,
      requirement_id: info.requirementId,
      document_name: doc.document_name,
      file_url: 'r2_private_access',
      file_key: newKey,
      bucket_name: destBucket,
      source_document_id: doc.id,
      is_confidential: info.confidential,
    })
    if (insertError) {
      // Lost a race with another copy, or the insert failed: drop the object we just wrote
      await r2.send(new DeleteObjectCommand({ Bucket: destBucket, Key: newKey })).catch(() => {})
      if (insertError.code !== '23505') {
        failed++
        console.error('[document-snapshots] could not record the copy', doc.id, insertError)
      }
      continue
    }
    copied++
  }

  return { success: true as const, copied, failed }
}

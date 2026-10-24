'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2 } from '@/lib/r2'
import { createClient } from '@/lib/supabase/server'

/**
 * Permanent removal of a center or a staff member and everything that belongs to them, for data
 * cleanup only. Super admins only, behind two checks:
 *   1. the exact name (center) / email (staff) typed back, and
 *   2. the super admin's own password, re-entered and verified against their account.
 */

const admin = () => createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function requireSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.app_metadata?.is_super_admin === true ? user : null
}

// ─── Password re-entry ───────────────────────────────────────────────────────

// Wrong passwords lock the caller out for a while (kept in memory: resets on restart, per server instance)
const attempts = new Map<string, { fails: number; lockedUntil: number }>()
const MAX_FAILS = 5
const LOCK_MS = 15 * 60 * 1000

/** Verifies the signed-in super admin's password. Returns an error message, or null when it is correct. */
async function verifyPassword(user: { id: string; email?: string }, password: string): Promise<string | null> {
  const state = attempts.get(user.id) ?? { fails: 0, lockedUntil: 0 }
  if (state.lockedUntil > Date.now()) {
    return `Too many wrong passwords. Try again in ${Math.ceil((state.lockedUntil - Date.now()) / 60000)} minutes.`
  }
  if (!user.email || !password) return 'Enter your password.'

  // A throwaway client that never stores a session, so this check does not touch the browser session
  const verifier = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await verifier.auth.signInWithPassword({ email: user.email, password })
  if (!error && data.user?.id === user.id) {
    attempts.delete(user.id)
    return null
  }

  state.fails += 1
  if (state.fails >= MAX_FAILS) { state.lockedUntil = Date.now() + LOCK_MS; state.fails = 0 }
  attempts.set(user.id, state)
  return 'Incorrect password.'
}

// ─── Storage ─────────────────────────────────────────────────────────────────

type StoredFile = { bucket: string | null | undefined; key: string | null | undefined }

/** Best-effort removal of R2 objects; returns how many were removed and how many failed. */
async function removeFiles(files: StoredFile[]) {
  let removed = 0
  let failed = 0
  for (const { bucket, key } of files) {
    if (!bucket || !key) continue
    try {
      await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      removed++
    } catch (error) {
      failed++
      console.error('[data-cleanup] could not delete storage object', bucket, key, error)
    }
  }
  return { removed, failed }
}

export type PurgeResult =
  | { success: true; filesRemoved: number; filesFailed: number; accountsRemoved: number }
  | { success: false; error: string }

const fail = (error: string): { success: false; error: string } => ({ success: false, error })

// ─── Center ──────────────────────────────────────────────────────────────────

export async function purgeCenter(
  centerId: string,
  input: { confirmName: string; password: string; deleteAdminAccounts: boolean },
): Promise<PurgeResult> {
  const caller = await requireSuperAdmin()
  if (!caller) return fail('Not allowed')

  const db = admin()
  const { data: center } = await db.from('centers').select('id, name').eq('id', centerId).maybeSingle()
  if (!center) return fail('Center not found')

  if (input.confirmName.trim() !== center.name) return fail('The name you typed does not match this center.')
  const passwordError = await verifyPassword(caller, input.password)
  if (passwordError) return fail(passwordError)

  // A live Stripe subscription would keep billing a center that no longer exists
  const { data: subs } = await db.from('subscriptions').select('status, stripe_subscription_id').eq('center_id', centerId)
  if ((subs ?? []).some(s => s.stripe_subscription_id && ['active', 'past_due', 'trialing'].includes(String(s.status)))) {
    return fail('This center has a live Stripe subscription. Cancel it in Stripe first, then delete the center.')
  }

  // Collect everything that needs cleaning up outside the center's own rows
  const [{ data: internalDocs }, { data: inspectionFiles }, { data: templates }, { data: admins }, { data: childFiles }, { data: receiptFiles }] = await Promise.all([
    db.from('center_internal_documents').select('file_key, bucket_name').eq('center_id', centerId),
    db.from('center_inspection_files').select('file_key, bucket_name').eq('center_id', centerId),
    // audience-ok: purging a center must remove the stored files of every audience
    db.from('center_document_requirements').select('template_file_key, template_bucket_name').eq('center_id', centerId),
    db.from('center_admins').select('user_id').eq('center_id', centerId),
    db.from('child_files').select('file_key, bucket_name').eq('center_id', centerId),
    db.from('center_receipts').select('file_key, bucket_name').eq('center_id', centerId),
  ])
  const files: StoredFile[] = [
    ...(internalDocs ?? []).map(d => ({ bucket: d.bucket_name, key: d.file_key })),
    ...(inspectionFiles ?? []).map(d => ({ bucket: d.bucket_name, key: d.file_key })),
    ...(templates ?? []).map(d => ({ bucket: d.template_bucket_name, key: d.template_file_key })),
    ...(childFiles ?? []).map(d => ({ bucket: d.bucket_name, key: d.file_key })),
    ...(receiptFiles ?? []).map(d => ({ bucket: d.bucket_name, key: d.file_key })),
  ]
  const adminUserIds = (admins ?? []).map(a => a.user_id as string)

  // Ratings are keyed by id without a foreign key, so they are not removed by the cascade
  await db.from('shift_reviews').delete().or(`reviewee_id.eq.${centerId},reviewer_id.eq.${centerId}`)

  // Children are protected from cascade deletion on purpose (ON DELETE RESTRICT). A purge removes them
  // explicitly, with their guardians, records, files and audit trail (those cascade from the child).
  const { count: childCount, error: childError } = await db.from('children').delete({ count: 'exact' }).eq('center_id', centerId)
  if (childError) return fail(`Could not remove the center's child records: ${childError.message}`)

  // Every other table that references centers deletes with it (ON DELETE CASCADE)
  const { error } = await db.from('centers').delete().eq('id', centerId)
  if (error) return fail(`Could not delete the center: ${error.message}`)

  const storage = await removeFiles(files)

  // Optionally remove the admins' sign-ins, but never someone who is also staff or runs another center
  let accountsRemoved = 0
  if (input.deleteAdminAccounts) {
    for (const userId of adminUserIds) {
      if (userId === caller.id) continue
      const [{ data: otherCenter }, { data: staffProfile }] = await Promise.all([
        db.from('center_admins').select('center_id').eq('user_id', userId).limit(1).maybeSingle(),
        db.from('staff_profiles').select('id').eq('user_id', userId).limit(1).maybeSingle(),
      ])
      if (otherCenter || staffProfile) continue
      const { error: deleteError } = await db.auth.admin.deleteUser(userId)
      if (!deleteError) accountsRemoved++
    }
  }

  console.warn(`[data-cleanup] super admin ${caller.id} deleted center ${center.id} "${center.name}" (${childCount ?? 0} child records)`)
  return { success: true, filesRemoved: storage.removed, filesFailed: storage.failed, accountsRemoved }
}

// ─── Staff ───────────────────────────────────────────────────────────────────

export async function purgeStaff(
  staffId: string,
  input: { confirmName: string; password: string },
): Promise<PurgeResult> {
  const caller = await requireSuperAdmin()
  if (!caller) return fail('Not allowed')

  const db = admin()
  const { data: staff } = await db.from('staff_profiles').select('id, user_id, email, avatar_url').eq('id', staffId).maybeSingle()
  if (!staff) return fail('Staff member not found')

  if (input.confirmName.trim().toLowerCase() !== String(staff.email).toLowerCase()) {
    return fail('The email you typed does not match this staff member.')
  }
  if (staff.user_id === caller.id) return fail('You cannot delete your own account')
  const passwordError = await verifyPassword(caller, input.password)
  if (passwordError) return fail(passwordError)

  // Someone who also runs a center would take the center's admin access with them
  const { data: adminRow } = await db.from('center_admins').select('center_id').eq('user_id', staff.user_id).limit(1).maybeSingle()
  if (adminRow) return fail('This person is also a center admin. Remove their admin access (or delete that center) first.')

  const [{ data: vaultDocs }, { data: centerRecords }] = await Promise.all([
    db.from('staff_documents').select('file_key, bucket_name').eq('staff_id', staffId),
    db.from('center_internal_documents').select('file_key, bucket_name').eq('staff_id', staffId),
  ])
  const files: StoredFile[] = [
    ...(vaultDocs ?? []).map(d => ({ bucket: d.bucket_name ?? process.env.R2_EMPLOYEE_BUCKET, key: d.file_key })),
    ...(centerRecords ?? []).map(d => ({ bucket: d.bucket_name, key: d.file_key })),
    { bucket: process.env.R2_EMPLOYEE_BUCKET, key: staff.avatar_url },
  ]

  await db.from('shift_reviews').delete().or(`reviewee_id.eq.${staffId},reviewer_id.eq.${staffId}`)

  // Cascades: documents, experience, credentials, references, center links, claims, requests…
  const { error } = await db.from('staff_profiles').delete().eq('id', staffId)
  if (error) return fail(`Could not delete the staff member: ${error.message}`)

  const storage = await removeFiles(files)

  // Then the sign-in itself (also removes their notifications and push registrations)
  let accountsRemoved = 0
  const { error: authError } = await db.auth.admin.deleteUser(staff.user_id)
  if (authError) {
    console.error('[data-cleanup] staff data removed but the sign-in could not be deleted', staff.user_id, authError)
    return fail(`Their data was removed, but the sign-in could not be deleted: ${authError.message}`)
  }
  accountsRemoved = 1

  console.warn(`[data-cleanup] super admin ${caller.id} deleted staff ${staff.id} (${staff.email})`)
  return { success: true, filesRemoved: storage.removed, filesFailed: storage.failed, accountsRemoved }
}

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * Authorization helpers for server actions that act on a staff member's behalf.
 * Server actions are public POST endpoints, so ids sent by the browser must never be trusted
 * on their own: check them against the signed-in user here. Server-only (service role key).
 */
const admin = () => createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function getSignedInUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

/** True when staffId is the signed-in user's own staff profile. */
export async function isOwnStaffProfile(userId: string, staffId: string): Promise<boolean> {
  if (!staffId) return false
  const { data } = await admin().from('staff_profiles').select('id').eq('id', staffId).eq('user_id', userId).maybeSingle()
  return !!data
}

/** True when the signed-in user administers the center. */
export async function isCenterAdminOf(userId: string, centerId: string): Promise<boolean> {
  const { data } = await admin().from('center_admins').select('user_id').eq('center_id', centerId).eq('user_id', userId).maybeSingle()
  return !!data
}

/**
 * Time-clock actions on a shift: allowed for the staff member themself or an admin of the shift's center.
 * Returns the shift's center id on success.
 */
export async function authorizeShiftClaimAction(
  shiftId: string,
  staffId: string,
): Promise<{ ok: true; centerId: string } | { ok: false; error: string }> {
  const userId = await getSignedInUserId()
  if (!userId) return { ok: false, error: 'Not signed in' }

  const { data: shift } = await admin().from('shifts').select('center_id').eq('id', shiftId).maybeSingle()
  if (!shift) return { ok: false, error: 'Shift not found' }

  const allowed = (await isOwnStaffProfile(userId, staffId)) || (await isCenterAdminOf(userId, shift.center_id))
  return allowed ? { ok: true, centerId: shift.center_id } : { ok: false, error: 'Not allowed' }
}

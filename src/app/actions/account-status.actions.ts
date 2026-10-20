'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

const admin = () => createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

/** Server actions are public endpoints: confirm the caller is a platform super admin. */
async function requireSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.app_metadata?.is_super_admin === true ? user : null
}

// "Banned" for ~100 years; lifted by setting the duration to 'none'
const BAN_FOREVER = '876000h'

/**
 * Disable or re-enable a staff member. Disabling blocks sign-in and token refresh (auth ban) and
 * flags the account so the app signs out any session that is still open (see the proxy).
 */
export async function setStaffEnabled(staffId: string, enabled: boolean) {
  const caller = await requireSuperAdmin()
  if (!caller) return { success: false as const, error: 'Not allowed' }

  const db = admin()
  const { data: profile } = await db.from('staff_profiles').select('user_id').eq('id', staffId).maybeSingle()
  if (!profile) return { success: false as const, error: 'Staff member not found' }
  if (profile.user_id === caller.id) return { success: false as const, error: 'You cannot disable your own account' }

  const { data: target } = await db.auth.admin.getUserById(profile.user_id)
  const { error: authError } = await db.auth.admin.updateUserById(profile.user_id, {
    ban_duration: enabled ? 'none' : BAN_FOREVER,
    app_metadata: { ...(target?.user?.app_metadata ?? {}), disabled: !enabled },
  })
  if (authError) return { success: false as const, error: authError.message }

  const { error } = await db.from('staff_profiles').update({ is_active: enabled }).eq('id', staffId)
  if (error) return { success: false as const, error: error.message }
  return { success: true as const }
}

/** Disable or re-enable a center. A disabled center's admins are signed out of the center portal. */
export async function setCenterEnabled(centerId: string, enabled: boolean) {
  if (!(await requireSuperAdmin())) return { success: false as const, error: 'Not allowed' }
  const { error } = await admin().from('centers').update({ is_active: enabled }).eq('id', centerId)
  return error ? { success: false as const, error: error.message } : { success: true as const }
}

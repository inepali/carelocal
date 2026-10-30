'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * Super admin: turn Child Files on or off for a center (the pilot gate, like job postings). Until it is on, the
 * database refuses every child row for that center. This is the ONLY child-related action that uses the
 * service role, and it touches one boolean. Later this flips when the owner accepts the data addendum.
 */
export async function setCenterChildFilesEnabled(centerId: string, enabled: boolean): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.app_metadata?.is_super_admin !== true) return { success: false, error: 'Not allowed' }

  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: center } = await db.from('centers').select('id, domain_key').eq('id', centerId).maybeSingle()
  if (!center) return { success: false, error: 'Center not found' }
  if (enabled && center.domain_key !== 'childcare') return { success: false, error: 'Child Files is only for child care centers.' }

  const { error } = await db.from('centers').update({ child_files_enabled: enabled }).eq('id', centerId)
  if (error) return { success: false, error: error.message }
  console.warn(`[child-files] super admin ${user.id} turned Child Files ${enabled ? 'on' : 'off'} for center ${centerId}`)
  return { success: true }
}

/**
 * Super admin: turn the Live Roster on or off for a center. The roster shows children, so it also needs Child
 * Files on; the database checks both. Same rules as the Child Files switch: one boolean, service role only here.
 */
export async function setCenterRosterEnabled(centerId: string, enabled: boolean): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.app_metadata?.is_super_admin !== true) return { success: false, error: 'Not allowed' }

  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: center } = await db.from('centers').select('id, domain_key, child_files_enabled').eq('id', centerId).maybeSingle()
  if (!center) return { success: false, error: 'Center not found' }
  if (enabled && center.domain_key !== 'childcare') return { success: false, error: 'The live roster is only for child care centers.' }
  if (enabled && !center.child_files_enabled) return { success: false, error: 'Turn on Child Files for this center first. The live roster uses its children.' }

  const { error } = await db.from('centers').update({ roster_enabled: enabled }).eq('id', centerId)
  if (error) return { success: false, error: error.message }
  console.warn(`[roster] super admin ${user.id} turned the live roster ${enabled ? 'on' : 'off'} for center ${centerId}`)
  return { success: true }
}

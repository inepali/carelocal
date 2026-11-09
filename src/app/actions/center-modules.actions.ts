'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

type Result = { success: true } | { success: false; error: string }

/**
 * Super admin: turn Menu Planning on or off for a child care center. One boolean, service role only here; the
 * database also refuses the change from anyone who is not a super admin (guard_menu_flags). Turning it off
 * hides menus from everyone at the center but deletes nothing.
 */
export async function setCenterMenuPlanningEnabled(centerId: string, enabled: boolean): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.app_metadata?.is_super_admin !== true) return { success: false, error: 'Not allowed' }

  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: center } = await db.from('centers').select('id, domain_key').eq('id', centerId).maybeSingle()
  if (!center) return { success: false, error: 'Center not found' }
  if (enabled && center.domain_key !== 'childcare') return { success: false, error: 'Menu planning is only for child care centers.' }

  // CACFP tracking rides on menu planning, so it goes off with it
  const { error } = await db.from('centers')
    .update(enabled ? { menu_planning_enabled: true } : { menu_planning_enabled: false, cacfp_enabled: false })
    .eq('id', centerId)
  if (error) return { success: false, error: error.message }
  console.warn(`[menu] super admin ${user.id} turned menu planning ${enabled ? 'on' : 'off'} for center ${centerId}`)
  return { success: true }
}

/** Super admin: turn CACFP component tracking and reports on or off. Needs Menu Planning on. */
export async function setCenterCacfpEnabled(centerId: string, enabled: boolean): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.app_metadata?.is_super_admin !== true) return { success: false, error: 'Not allowed' }

  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: center } = await db.from('centers').select('id, menu_planning_enabled').eq('id', centerId).maybeSingle()
  if (!center) return { success: false, error: 'Center not found' }
  if (enabled && !center.menu_planning_enabled) return { success: false, error: 'Turn on Menu Planning for this center first.' }

  const { error } = await db.from('centers').update({ cacfp_enabled: enabled }).eq('id', centerId)
  if (error) return { success: false, error: error.message }
  console.warn(`[menu] super admin ${user.id} turned CACFP tracking ${enabled ? 'on' : 'off'} for center ${centerId}`)
  return { success: true }
}

/**
 * Super admin: turn Lesson Plans on or off for a child care center. It is on by default; turning it off hides
 * Lesson Plans for everyone at the center and deletes nothing.
 */
export async function setCenterLessonPlansEnabled(centerId: string, enabled: boolean): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.app_metadata?.is_super_admin !== true) return { success: false, error: 'Not allowed' }

  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: center } = await db.from('centers').select('id, domain_key').eq('id', centerId).maybeSingle()
  if (!center) return { success: false, error: 'Center not found' }
  if (enabled && center.domain_key !== 'childcare') return { success: false, error: 'Lesson plans are only for child care centers.' }

  const { error } = await db.from('centers').update({ lesson_plans_enabled: enabled }).eq('id', centerId)
  if (error) return { success: false, error: error.message }
  console.warn(`[lesson-plans] super admin ${user.id} turned lesson plans ${enabled ? 'on' : 'off'} for center ${centerId}`)
  return { success: true }
}

/**
 * Super admin: turn Announcements on or off for a center. Off by default. Owners and admins write one note and
 * email it to all parents, the parents of chosen classes, or staff. Any vertical can use it for staff; parent
 * groups need the Children module (the database checks that when sending). Turning it off stops anything still
 * queued, closes the links in sent emails, and deletes nothing.
 */
export async function setCenterAnnouncementsEnabled(centerId: string, enabled: boolean): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.app_metadata?.is_super_admin !== true) return { success: false, error: 'Not allowed' }

  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: center } = await db.from('centers').select('id').eq('id', centerId).maybeSingle()
  if (!center) return { success: false, error: 'Center not found' }

  const { error } = await db.from('centers').update({ announcements_enabled: enabled }).eq('id', centerId)
  if (error) return { success: false, error: error.message }
  console.warn(`[announcements] super admin ${user.id} turned announcements ${enabled ? 'on' : 'off'} for center ${centerId}`)
  return { success: true }
}

/**
 * Super admin: turn the parent portal (/parent) on or off for a child care center. Off by default. It needs the
 * live roster (that is where daily activities and photos come from). Turning it off signs every parent out right
 * away (the database checks the switch on every visit); codes are kept, so turning it back on lets parents in again.
 */
export async function setCenterParentPortalEnabled(centerId: string, enabled: boolean): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.app_metadata?.is_super_admin !== true) return { success: false, error: 'Not allowed' }

  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: center } = await db.from('centers').select('id, domain_key, roster_enabled').eq('id', centerId).maybeSingle()
  if (!center) return { success: false, error: 'Center not found' }
  if (enabled && center.domain_key !== 'childcare') return { success: false, error: 'The parent portal is only for child care centers.' }
  if (enabled && !center.roster_enabled) return { success: false, error: 'Turn on the Live roster for this center first.' }

  const { error } = await db.from('centers').update({ parent_portal_enabled: enabled }).eq('id', centerId)
  if (error) return { success: false, error: error.message }
  console.warn(`[parent-portal] super admin ${user.id} turned the parent portal ${enabled ? 'on' : 'off'} for center ${centerId}`)
  return { success: true }
}

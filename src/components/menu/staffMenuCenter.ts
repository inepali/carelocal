'use client'

import { createClient } from '@/lib/supabase/client'

export type StaffMenuCenter =
  | { kind: 'blocked'; message: string }
  | { kind: 'ready'; centerId: string }

/**
 * The center whose menu a regular employee sees: their one active regular membership, with menu planning on.
 * The database decides what they can read and whether they can edit (menu editors); this only finds the center.
 */
export async function staffMenuCenter(): Promise<StaffMenuCenter> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { kind: 'blocked', message: 'Please sign in again.' }
  const { data: profile } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
  if (!profile) return { kind: 'blocked', message: 'Your staff profile is not set up yet.' }
  const { data } = await supabase
    .from('center_staff')
    .select('center_id, center:centers(menu_planning_enabled, domain_key)')
    .eq('staff_id', profile.id).eq('employment_class', 'regular').eq('status', 'active')
    .maybeSingle()
  const center = (data as { center?: { menu_planning_enabled?: boolean; domain_key?: string } | null } | null)?.center
  if (!data || !center) return { kind: 'blocked', message: 'The menu is for regular employees of a center.' }
  if (!center.menu_planning_enabled || (center.domain_key ?? 'childcare') !== 'childcare') {
    return { kind: 'blocked', message: 'Menu planning isn’t turned on for your center.' }
  }
  return { kind: 'ready', centerId: data.center_id as string }
}

/** Whether to show the Menu item in the staff portal */
export async function staffMenuEnabled(): Promise<boolean> {
  return (await staffMenuCenter()).kind === 'ready'
}

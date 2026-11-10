'use client'

import { createClient } from '@/lib/supabase/client'

export type StaffScheduleCenter =
  | { kind: 'blocked'; message: string }
  | { kind: 'ready'; centerId: string; staffId: string }

/**
 * The center whose schedule a regular employee sees: their one active regular membership, with the staff schedule
 * on. The database decides what they can read (published days only); this only finds the center.
 */
export async function staffScheduleCenter(): Promise<StaffScheduleCenter> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { kind: 'blocked', message: 'Please sign in again.' }
  const { data: profile } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
  if (!profile) return { kind: 'blocked', message: 'Your staff profile is not set up yet.' }
  const { data } = await supabase
    .from('center_staff')
    .select('center_id, center:centers(schedule_enabled)')
    .eq('staff_id', profile.id).eq('employment_class', 'regular').eq('status', 'active')
    .maybeSingle()
  const center = (data as { center?: { schedule_enabled?: boolean } | null } | null)?.center
  if (!data || !center) return { kind: 'blocked', message: 'The schedule is for regular employees of a center.' }
  if (!center.schedule_enabled) return { kind: 'blocked', message: 'The staff schedule isn’t turned on for your center.' }
  return { kind: 'ready', centerId: data.center_id as string, staffId: profile.id as string }
}

/** Whether to show the Schedule item in the staff portal */
export async function staffScheduleEnabled(): Promise<boolean> {
  return (await staffScheduleCenter()).kind === 'ready'
}

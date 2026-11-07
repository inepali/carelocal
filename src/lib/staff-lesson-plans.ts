'use client'

import { createClient } from '@/lib/supabase/client'

/**
 * Whether Lesson Plans is on for a center. On by default: only an explicit false, set by a super admin, turns it
 * off, and a database without the lesson_plans_toggle migration (no column, so the read fails) counts as on.
 */
export async function lessonPlansOn(centerId: string): Promise<boolean> {
  const { data } = await createClient().from('centers').select('lesson_plans_enabled').eq('id', centerId).maybeSingle()
  return (data as { lesson_plans_enabled?: boolean } | null)?.lesson_plans_enabled !== false
}

/** For the staff portal menu: the signed-in regular employee's center has Lesson Plans on */
export async function staffLessonPlansEnabled(): Promise<boolean> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: profile } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
  if (!profile) return false
  const { data: membership } = await supabase.from('center_staff').select('center_id')
    .eq('staff_id', profile.id).eq('employment_class', 'regular').eq('status', 'active').maybeSingle()
  if (!membership) return false
  return lessonPlansOn(membership.center_id as string)
}

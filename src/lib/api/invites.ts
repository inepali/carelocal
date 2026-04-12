import { createClient } from '@/lib/supabase/client'

/**
 * Generates a registration URL for staff invitation.
 * During pilot, we use the center's slug for simplicity.
 */
export function getStaffInviteLink(centerSlug: string) {
  // In production this would use the real domain
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://carelocal.io'
  return `${baseUrl}/register?invite=${centerSlug}`
}

/**
 * Handles linking a staff member to a center during sign-up.
 */
export async function linkStaffToCenter(userId: string, centerSlug: string) {
  const supabase = createClient()

  // 1. Find the center by slug
  const { data: center, error: centerError } = await supabase
    .from('centers')
    .select('id')
    .eq('slug', centerSlug)
    .single()

  if (centerError || !center) {
    console.error('Could not find center for invitation:', centerError)
    return { error: 'Invalid invitation link.' }
  }

  // 2. Find the staff profile for the user
  const { data: profile, error: profileError } = await supabase
    .from('staff_profiles')
    .select('id')
    .eq('user_id', userId)
    .single()

  if (profileError || !profile) {
    console.error('Could not find staff profile:', profileError)
    return { error: 'Staff profile not found.' }
  }

  // 3. Create the center_staff relationship
  const { error: linkError } = await supabase
    .from('center_staff')
    .insert({
      center_id: center.id,
      staff_id: profile.id,
      status: 'active', // For pilot, auto-activate upon joining via link
    })

  if (linkError) {
    console.error('Failed to link staff to center:', linkError)
    return { error: 'Failed to join center pool.' }
  }

  return { success: true, centerId: center.id }
}

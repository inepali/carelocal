'use server'

import { createClient } from '@/lib/supabase/server'
import { groupMeServerReady, serviceDb } from '@/lib/server/groupme'

export interface GroupMeInvite {
  centerId: string
  centerName: string
  shareUrl: string
}

/**
 * GroupMe invite links for the centers the signed-in staff member is invited to or works at, for the Getting started
 * checklist. center_groupme is server-only, so the link is read here with the service role and only for the
 * caller's own centers; bot ids never leave the server.
 */
export async function getMyGroupMeInvites(): Promise<GroupMeInvite[]> {
  if (!groupMeServerReady()) return []
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: profile } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
  if (!profile) return []

  const { data: memberships } = await supabase
    .from('center_staff')
    .select('center_id, centers(name)')
    .eq('staff_id', profile.id)
    .in('status', ['invited', 'active'])
  if (!memberships?.length) return []

  const { data: rows } = await serviceDb()
    .from('center_groupme')
    .select('center_id, share_url')
    .in('center_id', memberships.map(m => m.center_id))
    .eq('enabled', true)
    .not('share_url', 'is', null)

  return (rows ?? []).flatMap(row => {
    const membership = memberships.find(m => m.center_id === row.center_id)
    const center = membership?.centers as { name?: string } | { name?: string }[] | null | undefined
    const centerName = (Array.isArray(center) ? center[0]?.name : center?.name) || 'Your center'
    return row.share_url ? [{ centerId: row.center_id as string, centerName, shareUrl: row.share_url as string }] : []
  })
}

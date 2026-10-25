import { createClient } from '@/lib/supabase/client'
import type { SubscriptionStatus, SubscriptionTier } from '@/lib/types'

/**
 * The plan a center actually gets, from the center_plan_summary database function.
 * A secondary center takes its plan from its primary ('primary'); for 30 days after a shared plan ends it
 * keeps it ('grace'); otherwise it is the center's own plan ('own').
 */
export type CenterPlanSummary = {
  tier: SubscriptionTier
  status: SubscriptionStatus
  source: 'own' | 'primary' | 'grace'
  grace_until: string | null
  own_tier: SubscriptionTier
  is_owner: boolean
  /** This center can add other centers to its plan (paid Growth, Network or Enterprise, and not itself a secondary) */
  can_share: boolean
  /** Centers on the plan this center is part of, counting the primary */
  centers_used: number
  /** How many centers that plan covers; null = unlimited */
  centers_cap: number | null
  primary: { id: string; name: string } | null
  secondaries: { id: string; name: string; linked_at: string }[]
  /** Unused invite codes (owner only) */
  invites: { code: string; expires_at: string }[]
}

export async function loadCenterPlan(centerId: string) {
  const { data, error } = await createClient().rpc('center_plan_summary', { p_center_id: centerId })
  if (error) throw new Error(error.message)
  return data as CenterPlanSummary
}

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A required document that stops a substitute from claiming a shift at a center. The database enforces the same
 * rule (trigger on shift_claims); this lets the app explain it before the claim is sent.
 */
export interface ClaimBlocker {
  requirement_id: string
  document_name: string
  reason: 'expired' | 'rejected' | 'missing' | 'renewal_due' | 'policy_changed'
  due_on: string | null
}

export const CLAIM_BLOCK_REASON: Record<ClaimBlocker['reason'], string> = {
  expired: 'Expired',
  rejected: 'Rejected by the center',
  missing: 'Not provided',
  renewal_due: 'Renewal overdue',
  policy_changed: 'Policy changed, acknowledge again',
}

/** The signed-in staff member's blocking documents for one center (empty when they are clear to claim) */
export async function loadClaimBlockers(supabase: SupabaseClient, centerId: string): Promise<ClaimBlocker[]> {
  const { data, error } = await supabase.rpc('my_claim_blockers', { p_center_id: centerId })
  // The database still refuses the claim, so a failed look-up must not lock staff out of the screen
  if (error) return []
  return (data ?? []) as ClaimBlocker[]
}

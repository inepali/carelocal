import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { DomainKey } from '@/lib/domain-config'

export const WRONG_DOMAIN_ERROR = 'wrong_domain'

function asDomainKey(value: unknown): DomainKey | null {
  return value === 'childcare' || value === 'healthcare' ? value : null
}

/**
 * Returns the vertical an account belongs to, or null if it has none yet
 * (e.g. mid-registration). Prefers app_metadata.domain_key, which a DB trigger
 * keeps in sync; falls back to the profile tables for accounts not yet backfilled.
 */
export async function getUserDomainKey(supabase: SupabaseClient, user: User): Promise<DomainKey | null> {
  const fromMetadata = asDomainKey(user.app_metadata?.domain_key)
  if (fromMetadata) return fromMetadata

  const { data: admin } = await supabase
    .from('center_admins')
    .select('centers(domain_key)')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
  const centers = admin?.centers as { domain_key?: string } | { domain_key?: string }[] | null | undefined
  const centerDomain = asDomainKey(Array.isArray(centers) ? centers[0]?.domain_key : centers?.domain_key)
  if (centerDomain) return centerDomain

  const { data: staff } = await supabase
    .from('staff_profiles')
    .select('domain_key')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
  return asDomainKey(staff?.domain_key)
}

/** True when the account may use the given site. Super admins and accounts without a vertical are allowed. */
export async function canAccessDomain(supabase: SupabaseClient, user: User, siteDomain: DomainKey): Promise<boolean> {
  if (user.app_metadata?.is_super_admin === true) return true
  const userDomain = await getUserDomainKey(supabase, user)
  return userDomain === null || userDomain === siteDomain
}

/** Message shown when an account tries to sign in on the other vertical's site. */
export function wrongDomainMessage(siteDomain: DomainKey): string {
  return siteDomain === 'healthcare'
    ? 'This account is registered with CareLocal (childcare). Please sign in at carelocal.co.'
    : 'This account is registered with CareLocal Health. Please sign in at carelocal.net.'
}

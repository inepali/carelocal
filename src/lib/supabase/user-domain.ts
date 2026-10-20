import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { DomainKey } from '@/lib/domain-config'

export const WRONG_DOMAIN_ERROR = 'wrong_domain'
export const ACCOUNT_DISABLED_ERROR = 'account_disabled'
export const CENTER_DISABLED_ERROR = 'center_disabled'

export const DISABLED_MESSAGES: Record<string, string> = {
  [ACCOUNT_DISABLED_ERROR]: 'This account has been disabled. Please contact support if you think this is a mistake.',
  [CENTER_DISABLED_ERROR]: "This center's account has been disabled. Please contact support if you think this is a mistake.",
}

const SITES: Record<DomainKey, { name: string; host: string }> = {
  childcare:  { name: 'CareLocal (childcare)', host: 'carelocal.co' },
  healthcare: { name: 'CareLocal Health',      host: 'carelocal.net' },
  senior:     { name: 'CareLocal Senior',      host: 'carelocalsenior.com' },
}

function asDomainKey(value: unknown): DomainKey | null {
  return typeof value === 'string' && value in SITES ? value as DomainKey : null
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

/**
 * Message shown when an account tries to sign in on another vertical's site.
 * The account's own vertical isn't known on the login page (the session was cleared),
 * so name the site they're on and list the others.
 */
export function wrongDomainMessage(siteDomain: DomainKey): string {
  const others = (Object.keys(SITES) as DomainKey[])
    .filter(key => key !== siteDomain)
    .map(key => `${SITES[key].name} at ${SITES[key].host}`)
    .join(' or ')
  return `This account isn't registered with ${SITES[siteDomain].name}. Please sign in at ${others}.`
}

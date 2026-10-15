'use client'

import { useLookups } from '@/hooks/use-lookups'

/**
 * Active staff roles for the signed-in center admin's center: platform defaults for the
 * center's vertical merged with the center's own Role lookups (Manage Data → Roles).
 *
 * `centerId` is kept for call-site compatibility; the center is resolved from the session.
 */
export function useStaffRoles(_centerId?: string | null) {
  const { data, loading } = useLookups('Role')
  return { roles: data.filter(r => r.is_active), loading }
}

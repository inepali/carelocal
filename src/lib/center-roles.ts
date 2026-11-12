import { lookupLabel, type LookupItem } from '@/lib/lookups'

/**
 * An employee's role at their center (center_staff.center_role). Leadership roles carry dashboard access
 * (center_admins), the rest are titles from the center's Role list (Manage Data → Roles).
 * Set only through the set_center_role() database function:
 *  - owner: by a super admin (a center can have several)
 *  - director / assistant_director: by an owner
 *  - other roles: by an owner or a director
 */
export const LEADERSHIP_ROLES = [
  { value: 'owner', label: 'Owner' },
  { value: 'director', label: 'Director' },
  { value: 'assistant_director', label: 'Assistant Director' },
] as const

export type LeadershipRole = typeof LEADERSHIP_ROLES[number]['value']

export function isLeadershipRole(value: string | null | undefined): value is LeadershipRole {
  return LEADERSHIP_ROLES.some(r => r.value === value)
}

/** Label for a center role: a leadership role, else the center's Role list, else the raw value */
export function centerRoleLabel(value: string | null | undefined, lookups: Pick<LookupItem, 'value' | 'label'>[] = []) {
  if (!value) return ''
  return LEADERSHIP_ROLES.find(r => r.value === value)?.label ?? lookupLabel(lookups, value)
}

/** Roles the viewer may hand out. Owners: Director, Assistant Director and the Role list; directors: the Role list. */
export function assignableRoles(viewerAccess: string | null, lookups: Pick<LookupItem, 'value' | 'label' | 'is_active'>[]) {
  const plain = lookups
    .filter(l => l.is_active && !isLeadershipRole(l.value) && l.value !== 'admin')
    .map(l => ({ value: l.value, label: l.label }))
  if (viewerAccess === 'owner') {
    return [...LEADERSHIP_ROLES.filter(r => r.value !== 'owner').map(r => ({ value: r.value as string, label: r.label as string })), ...plain]
  }
  return plain
}

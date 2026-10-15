import type { SupabaseClient } from '@supabase/supabase-js'
import type { DomainKey } from '@/lib/domain-config'

/** Groups managed in Center → Manage Data. Every dropdown for these reads center_lookups. */
export const LOOKUP_GROUPS = [
  { id: 'Role', label: 'Roles' },
  { id: 'Document Type', label: 'Document Types' },
  { id: 'Shift Type', label: 'Shift Types' },
  { id: 'Payment Method', label: 'Payment Methods' },
  { id: 'Inspection Type', label: 'Inspection Types' },
] as const

export type LookupGroup = typeof LOOKUP_GROUPS[number]['id']

export interface LookupRow {
  id: string
  center_id: string | null
  group_name: string
  label: string
  value: string | null
  is_active: boolean
  sort_order: number | null
  domain_key: string
  created_at: string
}

/** A resolved lookup item: a platform default, a center override of one, or a center-only custom item. */
export interface LookupItem {
  value: string
  label: string
  is_active: boolean
  sort_order: number
  source: 'default' | 'override' | 'custom'
  /** The center row backing this item (override or custom); null for an untouched default */
  centerRowId: string | null
  /** The platform default row, when this value has one */
  defaultRow: LookupRow | null
}

export function lookupValue(row: Pick<LookupRow, 'value' | 'label'>) {
  return row.value || row.label.trim().toLowerCase().replace(/\s+/g, '_')
}

/**
 * Merges platform defaults (center_id NULL, for the domain) with center rows.
 * A center row with the same value as a default overrides it; other center rows are custom items.
 * Returns inactive items too — filter with `.filter(i => i.is_active)` for dropdowns.
 */
export function mergeLookups(rows: LookupRow[], domainKey: DomainKey): LookupItem[] {
  const items = new Map<string, LookupItem>()

  for (const row of rows) {
    if (row.center_id !== null || row.domain_key !== domainKey) continue
    const value = lookupValue(row)
    if (items.has(value)) continue
    items.set(value, {
      value, label: row.label, is_active: row.is_active, sort_order: row.sort_order ?? 0,
      source: 'default', centerRowId: null, defaultRow: row,
    })
  }

  for (const row of rows) {
    if (row.center_id === null) continue
    const value = lookupValue(row)
    const base = items.get(value)
    if (base && base.source !== 'default') continue // first center row wins
    items.set(value, {
      value, label: row.label, is_active: row.is_active, sort_order: row.sort_order ?? base?.sort_order ?? 0,
      source: base ? 'override' : 'custom', centerRowId: row.id, defaultRow: base?.defaultRow ?? null,
    })
  }

  return [...items.values()].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
}

/** Label for a stored value, falling back to the raw value */
export function lookupLabel(items: Pick<LookupItem, 'value' | 'label'>[], value: string | null | undefined) {
  if (!value) return ''
  return items.find(i => i.value === value)?.label || value
}

/**
 * Who is looking and which lookups apply: a center admin sees their center's rows,
 * staff see their domain's defaults plus rows of centers they belong to (RLS limits this).
 */
export async function resolveLookupScope(supabase: SupabaseClient): Promise<{ centerId: string | null; domainKey: DomainKey } | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: admin } = await supabase
    .from('center_admins')
    .select('center_id, centers ( domain_key )')
    .eq('user_id', user.id)
    .maybeSingle()

  if (admin?.center_id) {
    const centers = admin.centers as { domain_key?: string } | { domain_key?: string }[] | null
    const domain = Array.isArray(centers) ? centers[0]?.domain_key : centers?.domain_key
    return { centerId: admin.center_id, domainKey: (domain as DomainKey) || 'childcare' }
  }

  const { data: staff } = await supabase
    .from('staff_profiles')
    .select('domain_key')
    .eq('user_id', user.id)
    .maybeSingle()
  return { centerId: null, domainKey: (staff?.domain_key as DomainKey) || 'childcare' }
}

/** Raw rows for a group: the domain's defaults plus every center row the caller may read. */
export async function fetchLookupRows(supabase: SupabaseClient, groupName: string, centerId: string | null) {
  let query = supabase.from('center_lookups').select('*').eq('group_name', groupName)
  query = centerId ? query.or(`center_id.is.null,center_id.eq.${centerId}`) : query
  const { data, error } = await query
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []) as LookupRow[]
}

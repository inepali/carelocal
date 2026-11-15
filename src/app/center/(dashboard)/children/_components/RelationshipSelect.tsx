'use client'

import Link from 'next/link'
import { useLookups } from '@/hooks/use-lookups'
import { FLD } from './ui'

/** Manage Data deep link for the list behind this field */
export const GUARDIAN_TYPES_HREF = `/center/about?tab=${encodeURIComponent('Guardian Type')}#data`

/**
 * Relationship of a parent / contact to a child, picked from the center's Parent/Guardian Types
 * (About → Manage Data). The chosen label is saved as text, so a value that is no longer in the list
 * (an older free-text entry, or a type since deactivated) is kept and shown as its own option.
 * Falls back to a text box if the center has no active types.
 */
export function RelationshipSelect({ value, onChange, id }: { value: string; onChange: (value: string) => void; id?: string }) {
  const { data, loading } = useLookups('Guardian Type')
  const options = data.filter(i => i.is_active).map(i => i.label)
  const current = value.trim()
  const known = !current || options.some(o => o.toLowerCase() === current.toLowerCase())

  if (!loading && options.length === 0) {
    return (
      <>
        <input id={id} value={value} onChange={e => onChange(e.target.value)} className={FLD} maxLength={60} placeholder="Mother, grandfather, neighbor…" />
        <p className="mt-1 text-xs text-muted">Set up the list in <Link href={GUARDIAN_TYPES_HREF} className="font-semibold text-brand-600 hover:underline">Manage Data</Link>.</p>
      </>
    )
  }

  return (
    <select id={id} value={known ? options.find(o => o.toLowerCase() === current.toLowerCase()) ?? '' : value} onChange={e => onChange(e.target.value)} className={FLD} disabled={loading}>
      <option value="">{loading ? 'Loading…' : 'Select…'}</option>
      {!known && <option value={value}>{value}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

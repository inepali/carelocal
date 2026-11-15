'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Link2, Search, UserRound, X } from 'lucide-react'
import type { CenterGuardian } from '@/lib/child-types'
import { FLD, LBL } from './ui'

/**
 * Pick a person from the center's Parents & guardians list. Shows the linked person (with Unlink) once picked;
 * otherwise a searchable list. Entries already on this child are left out.
 */
export function GuardianPicker({ guardians, value, excludeIds = [], onPick, onUnlink }: {
  guardians: CenterGuardian[]
  value: string | null | undefined
  excludeIds?: string[]
  onPick: (g: CenterGuardian) => void
  onUnlink: () => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const picked = value ? guardians.find(g => g.id === value) : undefined

  const options = useMemo(() => {
    const q = query.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return guardians
      .filter(g => !g.archived_at && !excludeIds.includes(g.id))
      .filter(g => !q || g.name.toLowerCase().includes(q) || (g.email ?? '').toLowerCase().includes(q)
        || (digits.length >= 3 && (g.phone ?? '').replace(/\D/g, '').includes(digits)))
      .slice(0, 50)
  }, [guardians, excludeIds, query])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function choose(g: CenterGuardian) {
    onPick(g)
    setQuery('')
    setOpen(false)
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-sm">
        <div className="flex min-w-0 items-center gap-2 text-brand-800">
          <Link2 className="h-4 w-4 shrink-0" />
          <span className="truncate">
            From the parents list: <span className="font-semibold">{picked?.name ?? 'linked person'}</span>
            <span className="block text-xs text-brand-600">Name, phone and email follow the list. Change them on the <Link href="/center/children/guardians" className="underline">Parents & guardians</Link> page.</span>
          </span>
        </div>
        <button type="button" onClick={onUnlink} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-brand-600 hover:bg-white"><X className="h-3.5 w-3.5" /> Unlink</button>
      </div>
    )
  }

  const available = guardians.some(g => !g.archived_at && !excludeIds.includes(g.id))
  return (
    <div ref={box} className="relative">
      <label className={LBL}>Choose from the parents list</label>
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <input
          role="combobox" aria-expanded={open} aria-controls="guardian-picker-list" aria-autocomplete="list"
          value={query} disabled={!available}
          onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, options.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); choose(options[active]) }
            else if (e.key === 'Escape') setOpen(false)
          }}
          placeholder={available ? 'Search by name, phone or email' : 'No one on the list yet. Enter the details below.'}
          className={`${FLD} pl-10`}
        />
      </div>
      {open && available && (
        <ul id="guardian-picker-list" role="listbox" className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-white py-1 shadow-lg">
          {options.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No match. Enter the details below to add someone new.</li> : options.map((g, i) => (
            <li key={g.id} role="option" aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); choose(g) }} onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-start gap-2.5 px-4 py-2.5 text-sm ${i === active ? 'bg-brand-50' : ''}`}>
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
              <div className="min-w-0">
                <div className="font-semibold text-text-main">{g.name}{g.relationship ? <span className="font-normal text-muted"> · {g.relationship}</span> : null}</div>
                <div className="truncate text-xs text-muted">{[g.phone, g.email].filter(Boolean).join(' · ') || 'No phone or email'}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

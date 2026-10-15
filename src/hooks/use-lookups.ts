'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchLookupRows, mergeLookups, resolveLookupScope, type LookupItem } from '@/lib/lookups'

// Simple in-memory cache for lookups to prevent excessive DB calls
const lookupCache: Record<string, { data: LookupItem[], timestamp: number }> = {}
const CACHE_EXPIRY_MS = 1000 * 60 * 5 // 5 minutes

/**
 * Resolved items for a center_lookups group: the domain's platform defaults merged with
 * the center's overrides / custom items. Includes inactive items (needed to label old
 * records) — filter on `is_active` for dropdowns.
 */
export function useLookups(groupName: string) {
  const [data, setData] = useState<LookupItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    async function fetchLookups() {
      try {
        const scope = await resolveLookupScope(supabase)
        if (!scope) return

        const cacheKey = `lookups_${groupName}_${scope.domainKey}_${scope.centerId ?? 'staff'}`
        const cached = lookupCache[cacheKey]
        if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
          if (!cancelled) setData(cached.data)
          return
        }

        const rows = await fetchLookupRows(supabase, groupName, scope.centerId)
        const merged = mergeLookups(rows, scope.domainKey)
        lookupCache[cacheKey] = { data: merged, timestamp: Date.now() }
        if (!cancelled) setData(merged)
      } catch (err) {
        console.error(`Error fetching lookups for ${groupName}:`, err)
        if (!cancelled) setError(err as Error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchLookups()
    return () => { cancelled = true }
  }, [groupName])

  const invalidateCache = useCallback(() => {
    invalidateLookupCache(groupName)
  }, [groupName])

  return { data, loading, error, invalidateCache }
}

/** Drop cached items for a group (call after editing lookups) */
export function invalidateLookupCache(groupName: string) {
  Object.keys(lookupCache)
    .filter(key => key.startsWith(`lookups_${groupName}_`))
    .forEach(key => delete lookupCache[key])
}

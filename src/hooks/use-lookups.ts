'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// Simple in-memory cache for lookups to prevent excessive DB calls
const lookupCache: Record<string, { data: any[], timestamp: number }> = {}
const CACHE_EXPIRY_MS = 1000 * 60 * 5 // 5 minutes

export function useLookups(groupName: string) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const supabase = createClient()

  useEffect(() => {
    async function fetchLookups() {
      // Check cache first
      const cacheKey = `lookups_${groupName}`
      const cached = lookupCache[cacheKey]
      
      if (cached && (Date.now() - cached.timestamp < CACHE_EXPIRY_MS)) {
        setData(cached.data)
        setLoading(false)
        return
      }

      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setLoading(false)
          return
        }

        // We fetch the center_id and domain_key first
        const { data: admin } = await supabase
          .from('center_admins')
          .select('center_id, centers ( domain_key )')
          .eq('user_id', user.id)
          .maybeSingle()

        let query = supabase
          .from('center_lookups')
          .select('*')
          .eq('group_name', groupName)

        if (admin && admin.center_id) {
          query = query.or(`center_id.is.null,center_id.eq.${admin.center_id}`)
        } else {
          query = query.is('center_id', null)
        }

        const { data: lookups, error } = await query
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })

        if (error) throw error

        // @ts-ignore
        const domainKey = admin?.centers?.domain_key || 'childcare'

        // Filter platform defaults by domainKey (for overrides or custom records, they have a non-null center_id)
        const fetchedData = (lookups || []).filter(item => {
          if (item.center_id === null) {
            return item.domain_key === domainKey
          }
          return true
        })
        
        // Update cache
        lookupCache[cacheKey] = {
          data: fetchedData,
          timestamp: Date.now()
        }
        
        setData(fetchedData)
      } catch (err: any) {
        console.error(`Error fetching lookups for ${groupName}:`, err)
        setError(err)
      } finally {
        setLoading(false)
      }
    }

    fetchLookups()
  }, [groupName, supabase])

  const invalidateCache = () => {
    delete lookupCache[`lookups_${groupName}`]
  }

  return { data, loading, error, invalidateCache }
}

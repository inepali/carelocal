'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Fetches the merged list of staff role types for a given center:
 *  - Platform defaults (center_id IS NULL) come first
 *  - Center-specific custom roles follow
 *  - Only active roles are returned
 *
 * Pass `centerId` as soon as it is known. The hook re-fetches automatically
 * when centerId changes.
 */
export function useStaffRoles(centerId: string | null | undefined) {
  const [roles, setRoles] = useState<{ value: string; label: string; is_active: boolean }[]>([])
  const [loading, setLoading] = useState(!!centerId)
  const [prevCenterId, setPrevCenterId] = useState(centerId)

  if (centerId !== prevCenterId) {
    setPrevCenterId(centerId)
    setLoading(!!centerId)
    if (!centerId) {
      setRoles([])
    }
  }

  useEffect(() => {
    if (!centerId) return

    const supabase = createClient()

    supabase
      .from('center_lookups')
      .select('*')
      .eq('center_id', centerId)
      .eq('group_name', 'Role')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setRoles(data || [])
        setLoading(false)
      })
  }, [centerId])

  return { roles, loading }
}

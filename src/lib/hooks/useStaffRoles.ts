'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffRoleType } from '@/lib/types'

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
  const [roles, setRoles] = useState<StaffRoleType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!centerId) {
      setLoading(false)
      return
    }

    const supabase = createClient()
    setLoading(true)

    supabase
      .from('staff_role_types')
      .select('*')
      .or(`center_id.is.null,center_id.eq.${centerId}`)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        // Platform defaults first (center_id null), then center-custom
        const sorted = (data || []).sort((a, b) => {
          if (a.center_id === null && b.center_id !== null) return -1
          if (a.center_id !== null && b.center_id === null) return 1
          return a.sort_order - b.sort_order
        })
        setRoles(sorted)
        setLoading(false)
      })
  }, [centerId])

  return { roles, loading }
}

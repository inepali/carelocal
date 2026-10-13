'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

/** Portal routes for the substitute shift marketplace and multi-center membership */
export const SUBSTITUTE_ONLY_ROUTES = [
  '/staff/centers',
  '/staff/shifts',
  '/staff/my-shifts',
  '/staff/account',
  '/mobile/shifts',
  '/mobile/my-shifts',
  '/mobile/account',
]

/** Portal routes only regular employees use (their single center) */
export const REGULAR_ONLY_ROUTES = ['/staff/center']

function matchesRoute(routes: string[], pathname: string) {
  return routes.some(route => pathname === route || pathname.startsWith(`${route}/`))
}

export function isSubstituteOnlyRoute(pathname: string) {
  return matchesRoute(SUBSTITUTE_ONLY_ROUTES, pathname)
}

export function isRegularOnlyRoute(pathname: string) {
  return matchesRoute(REGULAR_ONLY_ROUTES, pathname)
}

/**
 * True when the signed-in staff member is a regular employee. A regular
 * belongs to exactly one center (enforced in the database), has no use for
 * the shift marketplace, and gets a single "My Center" view instead of
 * My Centers / Available Shifts / My Shifts / Account.
 */
export function useIsRegularOnly() {
  const [isRegularOnly, setIsRegularOnly] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      const { data: profile } = await supabase
        .from('staff_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (profile) {
        const { data: memberships } = await supabase
          .from('center_staff')
          .select('employment_class, status')
          .eq('staff_id', profile.id)
          .neq('status', 'removed')

        const list = memberships || []
        setIsRegularOnly(list.length > 0 && list.every(m => m.employment_class === 'regular'))
      }
      setLoading(false)
    }

    load()
  }, [])

  return { isRegularOnly, loading }
}

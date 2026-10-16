'use client'

import { useEffect } from 'react'

/**
 * Safety net for password-reset emails. If Supabase does not accept the link's redirect URL
 * (it is not on the project's Redirect URLs list) it sends the visitor to the Site URL (the home
 * page) with the recovery token attached. Forward those visitors to /reset-password, keeping the
 * token, so the link still works.
 */
export function RecoveryRedirect() {
  useEffect(() => {
    const { pathname, hash, search } = window.location
    if (pathname === '/reset-password') return

    const isRecoveryHash = /(^|[#&])type=recovery(&|$)/.test(hash)
    const hasCode = pathname === '/' && new URLSearchParams(search).has('code')
    if (isRecoveryHash || hasCode) {
      window.location.replace(`/reset-password${search}${hash}`)
    }
  }, [])

  return null
}

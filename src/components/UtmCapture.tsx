'use client'

import { useEffect } from 'react'
import { rememberUtm } from '@/lib/attribution'

/** Remembers the ad or campaign tags (utm_*) a visitor first arrived with, for sign-up attribution */
export function UtmCapture() {
  useEffect(() => {
    rememberUtm(window.location.search)
  }, [])
  return null
}

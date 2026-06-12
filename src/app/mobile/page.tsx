'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function MobileIndex() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/mobile/shifts')
  }, [router])

  return null
}

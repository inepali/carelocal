'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Care Score moved to About → Care Score; old links land there */
export default function CenterCareScoreRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/center/about#carescore') }, [router])
  return null
}

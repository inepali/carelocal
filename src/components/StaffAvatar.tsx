'use client'

import { useEffect, useState } from 'react'
import { getAvatarViewUrl } from '@/app/actions/avatar.actions'

/**
 * Staff profile photo with an initials fallback.
 * `avatarKey` is staff_profiles.avatar_url (an R2 object key in the private employee bucket).
 * Size, shape and fallback colors come from `className`.
 */
export function StaffAvatar({
  avatarKey,
  firstName,
  lastName,
  className = '',
}: {
  avatarKey?: string | null
  firstName?: string | null
  lastName?: string | null
  className?: string
}) {
  const [resolved, setResolved] = useState<{ key: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!avatarKey) return
    let cancelled = false
    getAvatarViewUrl(avatarKey).then(res => {
      if (!cancelled) setResolved({ key: avatarKey, url: res.success ? res.url : null })
    })
    return () => { cancelled = true }
  }, [avatarKey])

  // Ignore a URL resolved for a previous key
  const url = avatarKey && resolved?.key === avatarKey ? resolved.url : null
  const initials = `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase()

  return (
    <div className={`overflow-hidden flex items-center justify-center shrink-0 ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable
        <img src={url} alt={`${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Profile photo'} className="w-full h-full object-cover" />
      ) : (
        initials
      )}
    </div>
  )
}

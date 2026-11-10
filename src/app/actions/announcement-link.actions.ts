'use server'

import { acknowledgeAnnouncementLink } from '@/lib/server/announcement-link'

/** The "I've read this" button on /a/<token>. No sign-in: the token is the permission. */
export async function acknowledgeFromLink(token: string) {
  if (typeof token !== 'string' || token.length > 100) return { ok: false as const }
  const at = await acknowledgeAnnouncementLink(token)
  return at ? { ok: true as const, at } : { ok: false as const }
}

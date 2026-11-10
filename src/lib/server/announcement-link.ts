import { linkHash, parentDb } from '@/lib/server/parent-portal'

/**
 * The link in an announcement email (/a/<token>): opens only that one announcement for 30 days, for whoever it was
 * sent to (parent or staff), without signing in. Only the token's SHA-256 is stored.
 */
export interface LinkedAnnouncement {
  center_name: string
  center_email: string | null
  subject: string
  body: string
  sender_label: string
  sent_at: string
  urgent: boolean
  requires_ack: boolean
  acknowledged_at: string | null
  kind: 'parent' | 'staff'
}

/** What the link shows, or null when it is wrong, expired or the center turned announcements off. Records the open. */
export async function openAnnouncementLink(token: string): Promise<LinkedAnnouncement | null> {
  const hash = linkHash(token)
  if (!hash) return null
  const { data, error } = await parentDb().rpc('announcement_open', { p_token_hash: hash })
  if (error) { console.error('[announcement] open failed:', error.message); return null }
  return (data as LinkedAnnouncement | null) ?? null
}

/** Acknowledge from the link. Returns when, or null. */
export async function acknowledgeAnnouncementLink(token: string): Promise<string | null> {
  const hash = linkHash(token)
  if (!hash) return null
  const { data, error } = await parentDb().rpc('announcement_acknowledge', { p_token_hash: hash })
  if (error) { console.error('[announcement] acknowledge failed:', error.message); return null }
  return (data as string | null) ?? null
}

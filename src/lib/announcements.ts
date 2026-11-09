// Self-contained on purpose (type-only imports, no path aliases), like lib/parent-messages.ts.
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Center announcements: an owner or admin writes one note and emails it to all parents, the parents of chosen
 * classes, and/or staff. The database decides who is in each group and who may send
 * (20261230000000_announcements.sql); sending happens in the server action and the cron retry.
 */

export const SUBJECT_MAX = 150
export const BODY_MAX = 5000

/** Who an announcement goes to. Keys combine. */
export interface Audience {
  parents?: 'all' | { classes: string[] }
  staff?: 'all' | 'regular'
}

export type AnnouncementStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'partial' | 'failed' | 'canceled'
export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed'

export interface AudiencePreview {
  label: string
  total: number
  parents: number
  staff: number
  no_email: number
  people: { kind: 'parent' | 'staff'; name: string; email: string | null }[]
}

export interface AnnouncementSummary {
  id: string
  subject: string
  audience_label: string
  status: AnnouncementStatus
  urgent: boolean
  requires_ack: boolean
  sender_label: string
  created_at: string
  sent_at: string | null
  recipient_count: number
  no_email_count: number
  sent: number
  failed: number
  queued: number
  opened: number
  acknowledged: number
}

export interface AnnouncementRecipient {
  id: string
  kind: 'parent' | 'staff'
  name: string
  email: string
  children: string[]
  status: DeliveryStatus | null
  error: string | null
  sent_at: string | null
  opened_at: string | null
  acknowledged_at: string | null
}

export interface AnnouncementDetail {
  id: string
  subject: string
  body: string
  audience: Audience
  audience_label: string
  status: AnnouncementStatus
  urgent: boolean
  requires_ack: boolean
  sender_label: string
  created_at: string
  sent_at: string | null
  recipient_count: number
  no_email_count: number
  recipients: AnnouncementRecipient[]
}

/** An announcement as the person it went to sees it (parent page, staff app, email link) */
export interface ReceivedAnnouncement {
  id: string
  subject: string
  body: string
  sender_label: string
  sent_at: string
  urgent: boolean
  requires_ack: boolean
  acknowledged: boolean
  unread: boolean
  center_name?: string
}

type Failure = { success: false; error: string }

export function friendlyAnnouncementError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return 'Something went wrong.'
  const msg = error.message?.replace(/^.*?ERROR:\s*/, '')
  if (msg && error.code !== 'PGRST202') return msg
  return error.code === '42501' ? 'You do not have access to this.' : 'Something went wrong.'
}

/** The center's announcements, newest first */
export async function loadAnnouncements(supabase: SupabaseClient, centerId: string, limit = 50): Promise<{ success: true; announcements: AnnouncementSummary[] } | Failure> {
  const { data, error } = await supabase.rpc('announcements_list', { p_center_id: centerId, p_limit: limit })
  if (error) return { success: false, error: friendlyAnnouncementError(error) }
  return { success: true, announcements: (data ?? []) as AnnouncementSummary[] }
}

/** One announcement with everyone it went to */
export async function loadAnnouncement(supabase: SupabaseClient, centerId: string, id: string): Promise<{ success: true; announcement: AnnouncementDetail | null } | Failure> {
  const { data, error } = await supabase.rpc('announcement_detail', { p_center_id: centerId, p_announcement_id: id })
  if (error) return { success: false, error: friendlyAnnouncementError(error) }
  return { success: true, announcement: (data as AnnouncementDetail | null) ?? null }
}

/** Who a group reaches right now */
export async function previewAudience(supabase: SupabaseClient, centerId: string, audience: Audience): Promise<{ success: true; preview: AudiencePreview } | Failure> {
  const { data, error } = await supabase.rpc('announcement_preview', { p_center_id: centerId, p_audience: audience })
  if (error) return { success: false, error: friendlyAnnouncementError(error) }
  return { success: true, preview: data as AudiencePreview }
}

/** Staff app: announcements sent to me. markSeen when the list is actually shown. */
export async function loadMyAnnouncements(supabase: SupabaseClient, markSeen = false): Promise<ReceivedAnnouncement[] | null> {
  const { data, error } = await supabase.rpc('my_announcements', { p_mark_seen: markSeen })
  if (error) return null
  return (data ?? []) as ReceivedAnnouncement[]
}

export const STATUS_LABEL: Record<AnnouncementStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  partial: 'Some not delivered',
  failed: 'Not sent',
  canceled: 'Canceled',
}

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  queued: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  bounced: 'Bounced',
  failed: 'Not delivered',
}

/** Quick starts the admin can tap, then edit */
export const ANNOUNCEMENT_TEMPLATES: { label: string; subject: string; body: string; urgent?: boolean; ack?: boolean }[] = [
  { label: 'Closed', subject: 'The center is closed', urgent: true,
    body: 'The center will be closed on [day] because [reason]. We will reopen on [day]. Thank you for understanding.' },
  { label: 'Weather delay', subject: 'Delayed opening', urgent: true,
    body: 'Because of the weather, we will open at [time] on [day] instead of our usual time. Please travel safely.' },
  { label: 'Holiday', subject: 'Holiday schedule',
    body: 'A reminder that the center will be closed on [day] for [holiday]. Normal hours resume on [day].' },
  { label: 'Event', subject: 'You are invited',
    body: 'Join us for [event] on [day] at [time]. [Details]. We hope to see you there!' },
  { label: 'Tuition', subject: 'Tuition reminder',
    body: 'A friendly reminder that tuition for [period] is due on [day]. Please contact the office with any questions.' },
  { label: 'Policy', subject: 'Policy update', ack: true,
    body: 'We have updated our [policy]. [What changed]. Please read and acknowledge.' },
]

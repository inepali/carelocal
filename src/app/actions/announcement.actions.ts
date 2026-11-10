'use server'

import { createClient } from '@/lib/supabase/server'
import { BODY_MAX, SUBJECT_MAX, friendlyAnnouncementError, type Audience } from '@/lib/announcements'
import { sendAnnouncementNow, sendAnnouncementTestEmail } from '@/lib/server/announcement-send'

/**
 * Center owners and admins: send an announcement. announcement_create() (with the caller's own client) checks
 * who may send, resolves the group, freezes the recipient list and returns the same announcement when the same key
 * is sent again; the emails then go out right away. Anything not delivered now is retried by the cron run, so the
 * admin is told "sending" rather than an error.
 */
export async function sendAnnouncement(input: {
  centerId: string
  subject: string
  body: string
  audience: Audience
  urgent: boolean
  requiresAck: boolean
  key: string
}) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Please sign in again.' }

    const { data: id, error } = await supabase.rpc('announcement_create', {
      p_center_id: input.centerId,
      p_subject: input.subject.slice(0, SUBJECT_MAX + 50),
      p_body: input.body.slice(0, BODY_MAX + 50),
      p_audience: input.audience,
      p_channels: ['email'],
      p_urgent: input.urgent,
      p_requires_ack: input.requiresAck,
      p_client_key: input.key,
    })
    if (error || !id) return { success: false as const, error: friendlyAnnouncementError(error) }

    const result = await sendAnnouncementNow(id as string).catch(e => {
      console.error('[announcement] send failed:', e)
      return { sent: 0, failed: 1 }
    })
    return { success: true as const, id: id as string, sent: result.sent, failed: result.failed }
  } catch (error) {
    console.error('[announcement] failed:', error)
    return { success: false as const, error: 'Could not send the announcement.' }
  }
}

/**
 * Center owners and admins: email a test copy to yourself before sending to everyone. Uses the same access check
 * as reading the center's announcements (owner or admin, module on). Nothing is recorded.
 */
export async function sendAnnouncementTest(input: { centerId: string; subject: string; body: string; urgent: boolean; requiresAck: boolean }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return { success: false as const, error: 'Please sign in again.' }

    const subject = input.subject.replace(/[\r\n]+/g, ' ').trim()
    const body = input.body.trim()
    if (!subject || subject.length > SUBJECT_MAX) return { success: false as const, error: `Write a subject (up to ${SUBJECT_MAX} characters).` }
    if (!body || body.length > BODY_MAX) return { success: false as const, error: 'Write the message (up to 5,000 characters).' }

    const { error: accessError } = await supabase.rpc('announcements_list', { p_center_id: input.centerId, p_limit: 1 })
    if (accessError) return { success: false as const, error: friendlyAnnouncementError(accessError) }
    const { data: center } = await supabase.from('centers').select('name, email, domain_key').eq('id', input.centerId).maybeSingle()
    if (!center) return { success: false as const, error: 'Center not found.' }

    const res = await sendAnnouncementTestEmail(user.email, {
      subject, body, urgent: input.urgent, requires_ack: input.requiresAck,
      sender_label: 'the center', center_name: center.name, center_email: center.email?.trim() || null,
      center_domain: center.domain_key ?? null, kind: 'parent',
    })
    return res.ok ? { success: true as const, to: user.email } : { success: false as const, error: res.error }
  } catch (error) {
    console.error('[announcement] test failed:', error)
    return { success: false as const, error: 'Could not send the test email.' }
  }
}

/** Staff app: acknowledge an announcement that asked for it */
export async function acknowledgeMyAnnouncement(announcementId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('my_announcement_ack', { p_announcement_id: announcementId })
  if (error) console.error('[announcement] staff acknowledge failed:', error.message)
  return { ok: data === true }
}

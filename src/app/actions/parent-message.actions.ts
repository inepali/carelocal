'use server'

import { createClient } from '@/lib/supabase/server'
import { friendlyDailyError } from '@/lib/daily'
import { sendParentMessageNow } from '@/lib/server/parent-message-send'

/**
 * Teachers, owners and admins: send a message about a child to some of the child's authorized pick-up contacts.
 * parent_message_create() (with the caller's own client) decides who may send and to whom, and returns the same
 * message when the same key is sent again; the emails then go out right away. Anything not delivered now is
 * retried by the cron run, so the teacher is told "sending" rather than an error.
 */
export async function sendParentMessage(input: {
  centerId: string
  childId: string
  guardianIds: string[]
  subject: string
  body: string
  key: string
}) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Please sign in again.' }

    const { data: id, error } = await supabase.rpc('parent_message_create', {
      p_center_id: input.centerId,
      p_child_id: input.childId,
      p_guardian_ids: input.guardianIds,
      p_subject: input.subject,
      p_body: input.body,
      p_client_key: input.key,
    })
    if (error || !id) return { success: false as const, error: friendlyDailyError(error) }

    const result = await sendParentMessageNow(id as string).catch(e => {
      console.error('[parent-message] send failed:', e)
      return { sent: 0, failed: 1 }
    })
    return { success: true as const, id: id as string, delivered: result.sent > 0 && result.failed === 0 }
  } catch (error) {
    console.error('[parent-message] failed:', error)
    return { success: false as const, error: 'Could not send the message.' }
  }
}

/**
 * Teachers, owners and admins: reply in a conversation from the child card. parent_message_reply() sends it to
 * the parents in the conversation who can still get messages, and marks the parent's messages as read.
 */
export async function sendParentReply(input: { centerId: string; threadId: string; body: string; key: string }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Please sign in again.' }

    const { data: id, error } = await supabase.rpc('parent_message_reply', {
      p_center_id: input.centerId,
      p_thread_id: input.threadId,
      p_body: input.body,
      p_client_key: input.key,
    })
    if (error || !id) return { success: false as const, error: friendlyDailyError(error) }

    const result = await sendParentMessageNow(id as string).catch(e => {
      console.error('[parent-message] reply send failed:', e)
      return { sent: 0, failed: 1 }
    })
    return { success: true as const, id: id as string, delivered: result.sent > 0 && result.failed === 0 }
  } catch (error) {
    console.error('[parent-message] reply failed:', error)
    return { success: false as const, error: 'Could not send the reply.' }
  }
}

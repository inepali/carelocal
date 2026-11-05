// Self-contained on purpose (type-only imports, no path aliases), like lib/daily.ts.
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Parent messages: a teacher picks one or more of a child's authorized pick-up contacts and sends a short note
 * by email. The database decides who may send and who can be messaged (20261225000000_parent_messages.sql);
 * teachers see names only, never email addresses. Sending happens in the server action.
 */

export const MESSAGE_MAX = 2000
export const SUBJECT_MAX = 120

export interface MessageContact {
  id: string
  name: string
  relationship: string | null
  is_primary: boolean
  has_email: boolean
}

export type MessageStatus = 'sending' | 'sent' | 'partial' | 'failed'

export interface ParentMessage {
  id: string
  subject: string
  body: string
  sender_label: string
  status: MessageStatus
  created_at: string
  recipients: { name: string; status: 'queued' | 'sent' | 'failed' }[]
}

type Failure = { success: false; error: string }

function friendly(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return 'Something went wrong.'
  const msg = error.message?.replace(/^.*?ERROR:\s*/, '')
  if (msg) return msg
  return error.code === '42501' ? 'You do not have access to this.' : 'Something went wrong.'
}

/** The child's authorized pick-up contacts that a teacher can message, primary contact first */
export async function loadMessageContacts(supabase: SupabaseClient, centerId: string, childId: string): Promise<{ success: true; contacts: MessageContact[] } | Failure> {
  const { data, error } = await supabase.rpc('parent_message_contacts', { p_center_id: centerId, p_child_id: childId })
  if (error) return { success: false, error: friendly(error) }
  return { success: true, contacts: (data ?? []) as MessageContact[] }
}

/** The child's recent messages, newest first */
export async function loadParentMessages(supabase: SupabaseClient, centerId: string, childId: string, limit = 20): Promise<{ success: true; messages: ParentMessage[] } | Failure> {
  const { data, error } = await supabase.rpc('parent_messages_for_child', { p_center_id: centerId, p_child_id: childId, p_limit: limit })
  if (error) return { success: false, error: friendly(error) }
  return { success: true, messages: (data ?? []) as ParentMessage[] }
}

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  sending: 'Sending',
  sent: 'Sent',
  partial: 'Some not delivered',
  failed: 'Not sent',
}

/** Quick starts a teacher can tap, then edit */
export const MESSAGE_TEMPLATES: { label: string; subject: string; body: (name: string) => string }[] = [
  { label: 'Supplies', subject: 'Supplies needed', body: n => `Hi! ${n} is running low on diapers and wipes. Could you bring more at drop-off? Thank you!` },
  { label: 'Change of clothes', subject: 'Extra clothes', body: n => `Hi! Could you please bring an extra change of clothes for ${n}? Thank you!` },
  { label: 'Not feeling well', subject: 'Checking in', body: n => `Hi, ${n} does not seem to be feeling well today. Please call the center when you can.` },
  { label: 'Great day', subject: 'A great day', body: n => `Hi! Just wanted to share that ${n} had a great day today.` },
]

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

// ── Conversations (20261229000000_parent_message_threads.sql) ─────────────────────────────────────────────────

export interface ThreadRecipient {
  name: string
  kind: 'parent' | 'staff'
  status: 'queued' | 'sent' | 'failed'
  read: boolean
  acknowledged: boolean
}

export interface ThreadMessage {
  id: string
  author_kind: 'staff' | 'parent'
  sender_label: string
  body: string
  status: MessageStatus
  created_at: string
  /** Parent messages: when someone on the roster first opened it */
  seen_at: string | null
  recipients: ThreadRecipient[]
}

export interface ParentThread {
  id: string
  subject: string
  last_at: string
  /** Parent messages nobody on the roster has opened yet */
  unread: number
  /** Someone in the conversation can still get a reply */
  can_reply: boolean
  messages: ThreadMessage[]
}

/** The child's conversations, newest activity first */
export async function loadParentThreads(supabase: SupabaseClient, centerId: string, childId: string, limit = 10): Promise<{ success: true; threads: ParentThread[] } | Failure> {
  const { data, error } = await supabase.rpc('parent_threads_for_child', { p_center_id: centerId, p_child_id: childId, p_limit: limit })
  if (error) return { success: false, error: friendly(error) }
  return { success: true, threads: (data ?? []) as ParentThread[] }
}

/** Someone on the roster opened a conversation: the parent's messages in it are no longer unread */
export async function markThreadSeen(supabase: SupabaseClient, centerId: string, threadId: string) {
  const { error } = await supabase.rpc('parent_message_mark_seen', { p_center_id: centerId, p_thread_id: threadId })
  return !error
}

/** Children with parent messages nobody on the roster has opened: child id -> how many */
export async function loadUnreadParentMessages(supabase: SupabaseClient, centerId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('parent_messages_unread', { p_center_id: centerId })
  if (error) return {}
  return Object.fromEntries(((data ?? []) as { child_id: string; unread: number }[]).map(r => [r.child_id, r.unread]))
}

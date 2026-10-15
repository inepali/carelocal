'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/server/notify'

/**
 * Document requests. Permission checks live in the database functions, which run
 * with the caller's session; notifications are sent afterwards with the service role.
 */
type Result = { success: true; count?: number } | { success: false; error: string }

const service = () => createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

function formatDue(date: string | null | undefined) {
  if (!date) return ''
  return ` by ${new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

export async function createDocumentRequests(input: {
  staffIds: string[]
  requirementId?: string | null
  title?: string
  message?: string
  dueDate?: string | null
}): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Please sign in again.' }
  if (input.staffIds.length === 0) return { success: false, error: 'Choose at least one employee.' }

  const { data: adminRow } = await supabase.from('center_admins').select('center_id').eq('user_id', user.id).limit(1).maybeSingle()
  if (!adminRow) return { success: false, error: 'Only center admins can request documents.' }

  const { data: ids, error } = await supabase.rpc('create_document_requests', {
    p_center_id: adminRow.center_id,
    p_staff_ids: input.staffIds,
    p_requirement_id: input.requirementId || null,
    p_title: input.title || null,
    p_message: input.message || null,
    p_due_date: input.dueDate || null,
  })
  if (error) return { success: false, error: error.message }

  const requestIds = ((ids as unknown as string[] | null) ?? [])
  if (requestIds.length === 0) return { success: true, count: 0 }

  try {
    const admin = service()
    const { data: requests } = await admin
      .from('document_requests')
      .select('id, title, due_date, staff:staff_profiles(user_id), center:centers(name, domain_key)')
      .in('id', requestIds)
    for (const r of requests || []) {
      const staff = (Array.isArray(r.staff) ? r.staff[0] : r.staff) as { user_id?: string } | null
      const center = (Array.isArray(r.center) ? r.center[0] : r.center) as { name?: string; domain_key?: string } | null
      if (!staff?.user_id) continue
      await notifyUsers([staff.user_id], {
        title: `${center?.name || 'Your center'} requested a document`,
        message: `Please send: ${r.title}${formatDue(r.due_date)}.`,
        type: 'document_request',
        referenceId: r.id,
        url: '/staff/requests',
        emailCta: 'Send document',
      }, center?.domain_key)
    }
  } catch (err) {
    console.error('Failed to send document request notifications:', err)
  }

  return { success: true, count: requestIds.length }
}

export async function submitDocumentRequest(requestId: string, documentId: string, note?: string): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Please sign in again.' }

  const { error } = await supabase.rpc('submit_document_request', { p_request_id: requestId, p_document_id: documentId, p_note: note || null })
  if (error) return { success: false, error: error.message }

  try {
    const admin = service()
    const { data: r } = await admin
      .from('document_requests')
      .select('id, title, center_id, staff:staff_profiles(first_name, last_name), center:centers(domain_key)')
      .eq('id', requestId)
      .single()
    if (r) {
      const staff = (Array.isArray(r.staff) ? r.staff[0] : r.staff) as { first_name?: string; last_name?: string } | null
      const center = (Array.isArray(r.center) ? r.center[0] : r.center) as { domain_key?: string } | null
      const { data: admins } = await admin.from('center_admins').select('user_id').eq('center_id', r.center_id)
      await notifyUsers((admins || []).map(a => a.user_id), {
        title: 'Requested document received',
        message: `${staff?.first_name ?? 'An employee'} ${staff?.last_name ?? ''} sent: ${r.title}. Review it in Requests.`.replace(/\s+/g, ' '),
        type: 'document_request_submitted',
        referenceId: r.id,
        url: '/center/requests',
        emailCta: 'Review',
      }, center?.domain_key)
    }
  } catch (err) {
    console.error('Failed to notify center of submission:', err)
  }

  return { success: true }
}

export async function resolveDocumentRequest(requestId: string, action: 'accept' | 'reject' | 'cancel', note?: string): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Please sign in again.' }

  const { error } = await supabase.rpc('resolve_document_request', { p_request_id: requestId, p_action: action, p_note: note || null })
  if (error) return { success: false, error: error.message }

  if (action === 'reject') {
    try {
      const admin = service()
      const { data: r } = await admin
        .from('document_requests')
        .select('id, title, staff:staff_profiles(user_id), center:centers(name, domain_key)')
        .eq('id', requestId)
        .single()
      const staff = (Array.isArray(r?.staff) ? r?.staff[0] : r?.staff) as { user_id?: string } | null
      const center = (Array.isArray(r?.center) ? r?.center[0] : r?.center) as { name?: string; domain_key?: string } | null
      if (r && staff?.user_id) {
        await notifyUsers([staff.user_id], {
          title: `${center?.name || 'Your center'} needs a different document`,
          message: `${r.title}: ${note}`,
          type: 'document_request',
          referenceId: r.id,
          url: '/staff/requests',
          emailCta: 'Send document',
        }, center?.domain_key)
      }
    } catch (err) {
      console.error('Failed to notify staff of rejection:', err)
    }
  }

  return { success: true }
}

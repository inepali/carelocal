'use server'

import { randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { codeFromBytes, formatParentCode, normalizeParentCode, parentCodeHint } from '@/lib/parent-code'
import { hashParentCode } from '@/lib/server/parent-portal'
import { escapeHtml, sendEmail, siteForDomain } from '@/lib/server/notify'

/**
 * Owners and admins: parent portal access codes for a child's contacts. The database checks the caller
 * (parent_access_* functions, run with the caller's own session). A new code is returned once, here, and
 * never stored in plain text.
 */

export interface ContactAccess {
  guardian_id: string
  has_access: boolean
  code_hint: string | null
  issued_at: string | null
  last_login_at: string | null
  devices: number
  /** Other enrolled children the same code shows (siblings with the same parent email) */
  also_covers: string[]
}

type Fail = { success: false; error: string }
const fail = (error: { message?: string } | null | undefined, fallback = 'Something went wrong.'): Fail =>
  ({ success: false, error: error?.message?.replace(/^.*?ERROR:\s*/, '') || fallback })

export async function getParentAccess(centerId: string, childId: string): Promise<{ success: true; enabled: boolean; contacts: ContactAccess[] } | Fail> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('parent_access_status', { p_center_id: centerId, p_child_id: childId })
  if (error) return fail(error)
  const result = data as { enabled: boolean; contacts: ContactAccess[] }
  return { success: true, enabled: result.enabled, contacts: result.contacts ?? [] }
}

/**
 * Give a contact a code (or a new one: the old code and every device signed in with it stop working).
 * newCode false: the contact was added to the code a sibling's contact with the same email already has.
 */
export async function issueParentCode(centerId: string, guardianId: string): Promise<{ success: true; newCode: true; code: string } | { success: true; newCode: false } | Fail> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail(null, 'Please sign in again.')

  const code = codeFromBytes(randomBytes(8))
  const { data, error } = await supabase.rpc('parent_access_issue', {
    p_center_id: centerId,
    p_guardian_id: guardianId,
    p_code_hash: hashParentCode(code),
    p_code_hint: parentCodeHint(code),
  })
  if (error) return fail(error, 'Could not create the code.')
  const result = data as { access_id: string; new_code: boolean }
  if (!result.new_code) return { success: true, newCode: false }
  console.warn(`[parent-access] ${user.id} issued a parent code for guardian ${guardianId} at center ${centerId}`)
  return { success: true, newCode: true, code: formatParentCode(code) }
}

export async function revokeParentAccess(centerId: string, guardianId: string): Promise<{ success: true } | Fail> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('parent_access_revoke', { p_center_id: centerId, p_guardian_id: guardianId })
  if (error) return fail(error, 'Could not turn off access.')
  return { success: true }
}

/** Email a code that was just issued to the contact's own address. The database confirms it is their current code. */
export async function emailParentCode(centerId: string, guardianId: string, typedCode: string): Promise<{ success: true; email: string } | Fail> {
  const code = normalizeParentCode(typedCode)
  if (!code) return fail(null, 'That is not an access code.')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('parent_access_email_data', {
    p_center_id: centerId, p_guardian_id: guardianId, p_code_hash: hashParentCode(code),
  })
  if (error) return fail(error)
  const info = data as { name: string; email: string | null; children: string[] | null; center: { name: string; email: string | null; phone: string | null; domain_key: string | null } } | null
  if (!info) return fail(null, 'This code is no longer this contact’s code. Make a new one.')
  if (!info.email) return fail(null, 'This contact has no email address.')

  const site = siteForDomain(info.center.domain_key)
  const url = `${site.appUrl}/parent`
  const kids = (info.children ?? []).join(' and ') || 'your child'
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16202a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px">
<tr><td style="padding:24px">
<p style="margin:0;font-size:13px;color:#5b6773">${escapeHtml(info.center.name)}</p>
<h1 style="margin:6px 0 12px;font-size:22px;line-height:1.3">See ${escapeHtml(kids)}’s day</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">Hi ${escapeHtml(info.name)}, you can now see daily activities and photos on CareLocal. Open the link below and enter your access code.</p>
<p style="margin:0 0 16px;font-size:28px;font-weight:700;letter-spacing:.12em;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(formatParentCode(code))}</p>
<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Open the parent page</a></p>
<p style="margin:0;font-size:12px;color:#5b6773">Keep this code private: anyone with it can see your child’s day. If you did not expect this email, contact ${escapeHtml(info.center.name)}${info.center.phone ? ` at ${escapeHtml(info.center.phone)}` : ''}.</p>
</td></tr></table></td></tr></table></body></html>`

  const sent = await sendEmail({
    to: info.email,
    subject: `Your access code for ${info.center.name}`.replace(/[\r\n]+/g, ' ').slice(0, 200),
    html,
    domainKey: info.center.domain_key,
    ...(info.center.email ? { replyTo: info.center.email } : {}),
  })
  if (!sent) return fail(null, 'The email could not be sent. Share the code another way.')
  return { success: true, email: info.email }
}

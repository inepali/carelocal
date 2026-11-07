'use server'

import { randomInt } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { formatPin, normalizePin, pinFromNumber, weakPinReason } from '@/lib/parent-code'
import { hashPin } from '@/lib/server/parent-portal'
import { escapeHtml, sendEmail, siteForDomain } from '@/lib/server/notify'

/**
 * Owners and admins: parent page PINs for a child's contacts. The database checks the caller (parent_access_*
 * functions, run with the caller's own session). A PIN is 6 digits, typed by the admin or picked here, unique
 * within the center. It is returned once and never stored in plain text.
 */

export interface ContactAccess {
  guardian_id: string
  has_access: boolean
  issued_at: string | null
  last_login_at: string | null
  devices: number
  /** Other enrolled children the same PIN shows (siblings with the same parent email) */
  also_covers: string[]
}

type Fail = { success: false; error: string }
const fail = (error: { message?: string } | null | undefined, fallback = 'Something went wrong.'): Fail =>
  ({ success: false, error: error?.message?.replace(/^.*?ERROR:\s*/, '') || fallback })

export async function getParentAccess(centerId: string, childId: string): Promise<{ success: true; enabled: boolean; linkKey: string | null; contacts: ContactAccess[] } | Fail> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('parent_access_status', { p_center_id: centerId, p_child_id: childId })
  if (error) return fail(error)
  const result = data as { enabled: boolean; link_key?: string | null; contacts: ContactAccess[] }
  return { success: true, enabled: result.enabled, linkKey: result.link_key ?? null, contacts: result.contacts ?? [] }
}

/**
 * Give a contact a PIN, or a new one (the old PIN and every device signed in with it stop working).
 * typedPin: the 6 digits the admin chose; leave it out to pick a random one.
 * newCode false: the contact was added to the PIN a sibling's contact with the same email already has.
 */
export async function issueParentPin(centerId: string, guardianId: string, typedPin?: string | null): Promise<{ success: true; newCode: true; pin: string } | { success: true; newCode: false } | Fail> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail(null, 'Please sign in again.')

  let chosen: string | null = null
  if (typedPin != null && typedPin !== '') {
    chosen = normalizePin(typedPin)
    if (!chosen) return fail(null, 'A PIN has exactly 6 digits.')
    const weak = weakPinReason(chosen)
    if (weak) return fail(null, weak)
  }

  // A picked PIN that another family here already has is simply picked again
  for (let attempt = 0; attempt < (chosen ? 1 : 8); attempt++) {
    let pin = chosen
    while (!pin) {
      const next = pinFromNumber(randomInt(0, 1_000_000))
      if (!weakPinReason(next)) pin = next
    }
    const { data, error } = await supabase.rpc('parent_access_issue', {
      p_center_id: centerId,
      p_guardian_id: guardianId,
      p_code_hash: hashPin(centerId, pin),
    })
    if (error?.code === '23505' && !chosen) continue
    if (error) return fail(error, 'Could not save the PIN.')
    const result = data as { access_id: string; new_code: boolean }
    if (!result.new_code) return { success: true, newCode: false }
    console.warn(`[parent-access] ${user.id} set a parent PIN (${chosen ? 'typed' : 'picked'}) for guardian ${guardianId} at center ${centerId}`)
    return { success: true, newCode: true, pin }
  }
  return fail(null, 'Could not pick a free PIN. Please try again.')
}

export async function revokeParentAccess(centerId: string, guardianId: string): Promise<{ success: true } | Fail> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('parent_access_revoke', { p_center_id: centerId, p_guardian_id: guardianId })
  if (error) return fail(error, 'Could not turn off access.')
  return { success: true }
}

/** Email a PIN that was just set to the contact's own address, with the center's link. The database confirms it is their current PIN. */
export async function emailParentPin(centerId: string, guardianId: string, typedPin: string): Promise<{ success: true; email: string } | Fail> {
  const pin = normalizePin(typedPin)
  if (!pin) return fail(null, 'That is not a PIN.')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('parent_access_email_data', {
    p_center_id: centerId, p_guardian_id: guardianId, p_code_hash: hashPin(centerId, pin),
  })
  if (error) return fail(error)
  const info = data as { name: string; email: string | null; children: string[] | null; center: { name: string; email: string | null; phone: string | null; domain_key: string | null; link_key: string } } | null
  if (!info) return fail(null, 'This is no longer this contact’s PIN. Make a new one.')
  if (!info.email) return fail(null, 'This contact has no email address.')

  const site = siteForDomain(info.center.domain_key)
  const url = `${site.appUrl}/parent/${info.center.link_key}`
  const kids = (info.children ?? []).join(' and ') || 'your child'
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16202a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px">
<tr><td style="padding:24px">
<p style="margin:0;font-size:13px;color:#5b6773">${escapeHtml(info.center.name)}</p>
<h1 style="margin:6px 0 12px;font-size:22px;line-height:1.3">See ${escapeHtml(kids)}’s day</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">Hi ${escapeHtml(info.name)}, you can now see daily activities and photos, and message the teachers, on CareLocal. Open the button below and enter your PIN. Your phone stays signed in.</p>
<p style="margin:0 0 4px;font-size:13px;color:#5b6773">Your PIN</p>
<p style="margin:0 0 16px;font-size:30px;font-weight:700;letter-spacing:.2em;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(formatPin(pin))}</p>
<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Open the parent page</a></p>
<p style="margin:0 0 8px;font-size:12px;color:#5b6773">Bookmark the link: you need it and the PIN to sign in. ${escapeHtml(url)}</p>
<p style="margin:0;font-size:12px;color:#5b6773">Keep your PIN and this email private: together they show your child’s day. If you did not expect this email, contact ${escapeHtml(info.center.name)}${info.center.phone ? ` at ${escapeHtml(info.center.phone)}` : ''}.</p>
</td></tr></table></td></tr></table></body></html>`

  const sent = await sendEmail({
    to: info.email,
    subject: `Your parent page PIN for ${info.center.name}`.replace(/[\r\n]+/g, ' ').slice(0, 200),
    html,
    domainKey: info.center.domain_key,
    ...(info.center.email ? { replyTo: info.center.email } : {}),
  })
  if (!sent) return fail(null, 'The email could not be sent. Share the PIN another way.')
  return { success: true, email: info.email }
}

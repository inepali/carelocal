'use server'

import { createClient } from '@/lib/supabase/server'
import { friendlyBillingError } from '@/lib/billing'
import type { BankChangeRequest } from '@/lib/parent-billing'
import { buildBankChangeForm, type BankChangeFormData } from '@/lib/server/bank-change-form'
import { bankChangeDecisionEmail, sendBankChangeEmail } from '@/lib/server/bank-change-emails'

/**
 * Center → Billing → Bank change requests (owners and admins; parent billing phase 2). The database checks who may
 * act (tuition_require) and makes the change; these actions print the form and email the parent the answer.
 */

type Result<T> = ({ success: true } & T) | { success: false; error: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type FormRow = BankChangeFormData & { center: BankChangeFormData['center'] & { domain_key: string | null } }

export async function listBankChanges(centerId: string): Promise<Result<{ requests: BankChangeRequest[] }>> {
  if (!UUID.test(centerId)) return { success: false, error: 'Bad request' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('billing_bank_changes_list', { p_center_id: centerId })
  if (error) return { success: false, error: friendlyBillingError(error) }
  return { success: true, requests: (data ?? []) as BankChangeRequest[] }
}

/** The pre-filled authorization form, as a PDF (base64) for the browser to open and print */
export async function bankChangeFormPdf(id: string): Promise<Result<{ filename: string; base64: string }>> {
  if (!UUID.test(id)) return { success: false, error: 'Bad request' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('billing_bank_change_form', { p_id: id })
  if (error) return { success: false, error: friendlyBillingError(error) }
  const d = data as FormRow
  const bytes = await buildBankChangeForm(d)
  const who = d.requester_name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'parent'
  return { success: true, filename: `${d.kind === 'new_account' ? 'ach-authorization' : 'stop-ach'}-${who}.pdf`, base64: Buffer.from(bytes).toString('base64') }
}

export async function approveBankChange(id: string, fileId: string | null, signedOn: string | null): Promise<Result<{ effectiveFrom: string }>> {
  if (!UUID.test(id) || (fileId && !UUID.test(fileId)) || (signedOn && !/^\d{4}-\d{2}-\d{2}$/.test(signedOn))) return { success: false, error: 'Bad request' }
  const supabase = await createClient()
  const { data: form } = await supabase.rpc('billing_bank_change_form', { p_id: id })
  const { data, error } = await supabase.rpc('billing_bank_change_approve', { p_id: id, p_file_id: fileId, p_signed_on: signedOn })
  if (error) return { success: false, error: friendlyBillingError(error) }
  const r = data as { effective_from: string; email: string | null; requester_name: string; kind: 'new_account' | 'stop_ach'; last4: string | null; account_type: string | null }
  const center = (form as FormRow | null)?.center
  if (center) {
    await sendBankChangeEmail(r.email, bankChangeDecisionEmail({
      center: center.name, name: r.requester_name, kind: r.kind, approved: true, account_type: r.account_type, last4: r.last4, effective_from: r.effective_from,
    }), center.domain_key, center.email).catch(e => console.error('[bank-change] approve email failed:', e instanceof Error ? e.message : e))
  }
  return { success: true, effectiveFrom: r.effective_from }
}

export async function declineBankChange(id: string, reason: string): Promise<Result<object>> {
  if (!UUID.test(id)) return { success: false, error: 'Bad request' }
  const note = (reason ?? '').trim().slice(0, 300)
  if (!note) return { success: false, error: 'Give the parent a reason.' }
  const supabase = await createClient()
  const { data: form } = await supabase.rpc('billing_bank_change_form', { p_id: id })
  const { data, error } = await supabase.rpc('billing_bank_change_decline', { p_id: id, p_reason: note })
  if (error) return { success: false, error: friendlyBillingError(error) }
  const r = data as { email: string | null; requester_name: string; kind: 'new_account' | 'stop_ach'; reason: string }
  const center = (form as FormRow | null)?.center
  if (center) {
    await sendBankChangeEmail(r.email, bankChangeDecisionEmail({ center: center.name, name: r.requester_name, kind: r.kind, approved: false, reason: r.reason }),
      center.domain_key, center.email).catch(e => console.error('[bank-change] decline email failed:', e instanceof Error ? e.message : e))
  }
  return { success: true }
}

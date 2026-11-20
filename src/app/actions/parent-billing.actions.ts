'use server'

import { normalizePin } from '@/lib/parent-code'
import { BankKeyMissingError, encryptAccountNumber } from '@/lib/server/bank-account'
import { abaOk } from '@/lib/server/nacha'
import { notifyUsers } from '@/lib/server/notify'
import { bankChangeReceivedEmail, sendBankChangeEmail } from '@/lib/server/bank-change-emails'
import { clientIp, hashIp, hashPin, loadPortalHome, parentDb, parentTokenHash, userAgent } from '@/lib/server/parent-portal'

/**
 * Parent page → Billing → Request a change (parent billing phase 2). The parent types their PIN again; the account
 * number is encrypted here and never comes back (last 4 only). Nothing changes until the center approves it with a
 * signed authorization form (20270123000000_billing_bank_changes.sql).
 */

export interface BankChangeInput {
  kind: 'new_account' | 'stop_ach'
  payerIds: string[]
  holderName?: string
  bankName?: string
  routing?: string
  account?: string
  accountConfirm?: string
  accountType?: 'checking' | 'savings'
  pin: string
}

export type BankChangeResult = { ok: true } | { ok: false; error: string; field?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function parentRequestBankChange(input: BankChangeInput): Promise<BankChangeResult> {
  const tokenHash = await parentTokenHash()
  const home = tokenHash ? await loadPortalHome(tokenHash).catch(() => null) : null
  if (!tokenHash || !home) return { ok: false, error: 'Please sign in again.' }
  if (!input || (input.kind !== 'new_account' && input.kind !== 'stop_ach')) return { ok: false, error: 'Choose what to change.' }
  const payerIds = [...new Set((input.payerIds ?? []).filter(id => typeof id === 'string' && UUID.test(id)))].slice(0, 12)
  if (payerIds.length === 0) return { ok: false, error: 'Choose which children this is for.', field: 'children' }
  const pin = normalizePin(typeof input.pin === 'string' ? input.pin.slice(0, 20) : '')
  if (!pin) return { ok: false, error: 'Enter your 6-digit PIN to confirm.', field: 'pin' }

  const p: Record<string, unknown> = { kind: input.kind, payer_ids: payerIds }
  if (input.kind === 'new_account') {
    const holder = (input.holderName ?? '').trim().slice(0, 120)
    const routing = (input.routing ?? '').replace(/\D/g, '')
    const account = (input.account ?? '').replace(/[\s-]/g, '')
    if (!holder) return { ok: false, error: 'Enter the name on the account.', field: 'holder' }
    if (!abaOk(routing)) return { ok: false, error: 'That routing number isn’t valid. It’s the 9-digit number at the bottom left of a check.', field: 'routing' }
    if (!/^\d{4,17}$/.test(account)) return { ok: false, error: 'The account number is 4 to 17 digits.', field: 'account' }
    if (account !== (input.accountConfirm ?? '').replace(/[\s-]/g, '')) return { ok: false, error: 'The two account numbers don’t match.', field: 'accountConfirm' }
    try {
      p.account_number_enc = encryptAccountNumber(account, undefined, 'payer')
    } catch (e) {
      if (e instanceof BankKeyMissingError) return { ok: false, error: 'Bank details can’t be taken online right now. Please call the center.' }
      throw e
    }
    Object.assign(p, {
      holder_name: holder, bank_name: (input.bankName ?? '').trim().slice(0, 80), routing_number: routing,
      account_type: input.accountType === 'savings' ? 'savings' : 'checking', last4: account.slice(-4),
    })
  }

  const db = parentDb()
  const { data, error } = await db.rpc('parent_bank_change_create', {
    p_token_hash: tokenHash, p_code_hash: hashPin(home.center.id, pin), p_ip_hash: hashIp(await clientIp()), p_user_agent: await userAgent(), p,
  })
  if (error) {
    // Messages raised on purpose (22023) are written for parents; anything else is not shown
    if (error.code === '22023' || error.code === '42501') return { ok: false, error: error.message }
    console.error('[parent-billing] bank change request failed:', error.message)
    return { ok: false, error: 'Something went wrong. Please try again, or call the center.' }
  }
  const res = data as
    | { status: 'ok'; id: string; email: string | null; requester_name: string; kind: 'new_account' | 'stop_ach'; account_type: string | null; last4: string | null }
    | { status: 'invalid_pin'; left: number } | { status: 'rate_limited'; retry_after: number }
  if (res.status === 'rate_limited') {
    const minutes = Math.max(1, Math.ceil(res.retry_after / 60))
    return { ok: false, error: `Too many wrong PINs. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`, field: 'pin' }
  }
  if (res.status === 'invalid_pin') return { ok: false, error: 'That PIN didn’t work. Use the PIN you sign in with.', field: 'pin' }

  // Tell the center's owners and admins, and confirm to the parent. A failure here doesn't undo the request.
  try {
    const { data: staff } = await db.rpc('billing_bank_change_center_staff', { p_id: res.id })
    const s = staff as { user_ids: string[]; domain_key: string | null; center_name: string; requester_name: string; kind: string } | null
    if (s?.user_ids?.length) {
      await notifyUsers(s.user_ids, {
        title: 'Bank change request',
        message: s.kind === 'new_account'
          ? `${s.requester_name} asked to pay by ACH from a new bank account. Print the authorization form for them to sign.`
          : `${s.requester_name} asked to stop ACH drafts and pay at the center.`,
        type: 'billing_bank_change', referenceId: res.id, url: '/center/billing', emailCta: 'Open Billing',
      }, s.domain_key)
    }
    if (res.email) {
      await sendBankChangeEmail(res.email, bankChangeReceivedEmail({
        center: home.center.name, name: res.requester_name, kind: res.kind, account_type: res.account_type, last4: res.last4,
      }), home.center.domain_key, home.center.email)
    }
  } catch (e) {
    console.error('[parent-billing] bank change notices failed:', e instanceof Error ? e.message : e)
  }
  return { ok: true }
}

export async function parentCancelBankChange(id: string): Promise<{ ok: boolean }> {
  const tokenHash = await parentTokenHash()
  if (!tokenHash || !UUID.test(id)) return { ok: false }
  const { data, error } = await parentDb().rpc('parent_bank_change_cancel', { p_token_hash: tokenHash, p_id: id })
  if (error) { console.error('[parent-billing] cancel failed:', error.message); return { ok: false } }
  return { ok: data === true }
}

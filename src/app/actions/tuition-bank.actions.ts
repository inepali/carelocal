'use server'

import { createClient } from '@/lib/supabase/server'
import { checkPayers, friendlyTuitionError, payerLinesForDb, type PayerInput } from '@/lib/tuition'
import { BankKeyMissingError, decryptAccountNumber, encryptAccountNumber, normalizeAccountNumber } from '@/lib/server/bank-account'

type Result<T> = ({ success: true } & T) | { success: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY_MISSING = 'Bank details can’t be saved on this server yet (the encryption key is not set). Ask your CareLocal administrator.'

/**
 * Save who pays for a child from a date. Runs with the signed-in user's own Supabase session, so the database decides
 * access (owner or admin of the child's center, Tuition on). A typed ACH account number is encrypted here and only the
 * ciphertext and its last 4 digits are sent on; the plain number is never logged or stored.
 */
export async function saveChildPayers(childId: string, from: string, lines: PayerInput[], note?: string): Promise<Result<{ count: number }>> {
  if (!UUID.test(childId) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !Array.isArray(lines)) return { success: false, error: 'Bad request' }
  const problem = checkPayers(lines)
  if (problem) return { success: false, error: problem }

  const forDb: Record<string, unknown>[] = payerLinesForDb(lines)
  try {
    lines.forEach((l, i) => {
      if (l.method !== 'ach' || !l.account_number) return
      const digits = normalizeAccountNumber(l.account_number)
      if (!digits) throw new Error('bad account')   // checkPayers already refuses this; belt and braces
      forDb[i] = { ...forDb[i], account_number_enc: encryptAccountNumber(digits), last4: digits.slice(-4), keep_account_from: undefined }
    })
  } catch (e) {
    if (e instanceof BankKeyMissingError) {
      console.error('[tuition] TUITION_BANK_KEY is missing or not 32 bytes; refusing to store a bank account number')
      return { success: false, error: KEY_MISSING }
    }
    return { success: false, error: 'Check the bank account number.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('child_payment_plan_save', {
    p_child_id: childId, p_from: from, p_lines: forDb, p_note: note?.trim() || null,
  })
  if (error) return { success: false, error: friendlyTuitionError(error) }
  return { success: true, count: data as number }
}

/**
 * Show a payer's full bank account number to an owner or admin. The database checks access and logs the look in the
 * child's Activity before handing over the ciphertext; it is decrypted here and returned only to this caller.
 */
export async function revealBankAccount(payerId: string): Promise<Result<{ routing_number: string | null; account_number: string }>> {
  if (!UUID.test(payerId)) return { success: false, error: 'Bad request' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('child_payment_bank_reveal', { p_payer_id: payerId })
  if (error) return { success: false, error: friendlyTuitionError(error) }
  const row = data as { account_number_enc: string; routing_number: string | null }
  try {
    return { success: true, routing_number: row.routing_number, account_number: decryptAccountNumber(row.account_number_enc) }
  } catch (e) {
    console.error('[tuition] could not decrypt a bank account number', e instanceof BankKeyMissingError ? 'key missing' : 'wrong key or damaged value')
    return { success: false, error: e instanceof BankKeyMissingError ? KEY_MISSING : 'This account number can’t be read with the current key. Enter it again.' }
  }
}

'use server'

import { createClient } from '@/lib/supabase/server'
import { abaValid, friendlyTuitionError } from '@/lib/tuition'
import { BankKeyMissingError, decryptAccountNumber, encryptAccountNumber, normalizeAccountNumber } from '@/lib/server/bank-account'

type Result<T> = ({ success: true } & T) | { success: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY_MISSING = 'Bank details can’t be saved on this server yet (the encryption key is not set). Ask your CareLocal administrator.'

export interface CenterBankInput {
  account_holder_name: string
  account_holder_type: 'business' | 'individual'
  bank_name: string
  account_type: 'checking' | 'savings'
  routing_number: string
  account_number: string
  account_number_confirm: string
  note?: string
}

/**
 * Owner: add or replace the bank account the center's payments are deposited to. Runs with the signed-in user's own
 * session (the database refuses anyone but the center's owner). The account number is encrypted here; only the
 * ciphertext and last 4 digits go to the database, and the plain number is never logged.
 */
export async function saveCenterBankAccount(centerId: string, input: CenterBankInput): Promise<Result<object>> {
  if (!UUID.test(centerId) || !input) return { success: false, error: 'Bad request' }
  if (!input.account_holder_name?.trim()) return { success: false, error: 'Enter the name on the account.' }
  if (!input.bank_name?.trim()) return { success: false, error: 'Enter the bank name.' }
  if (input.account_type !== 'checking' && input.account_type !== 'savings') return { success: false, error: 'Pick checking or savings.' }
  if (!abaValid(input.routing_number)) return { success: false, error: 'That routing number isn’t valid. It is the 9 digits at the bottom left of a check.' }
  const digits = normalizeAccountNumber(input.account_number)
  if (!digits) return { success: false, error: 'The account number should be 4 to 17 digits.' }
  if (digits !== normalizeAccountNumber(input.account_number_confirm)) return { success: false, error: 'The account numbers don’t match. Type it again in both boxes.' }

  let enc: string
  try {
    enc = encryptAccountNumber(digits, undefined, 'center')
  } catch (e) {
    if (e instanceof BankKeyMissingError) {
      console.error('[center-bank] TUITION_BANK_KEY is missing or not 32 bytes; refusing to store a bank account number')
      return { success: false, error: KEY_MISSING }
    }
    throw e
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('center_bank_save', {
    p_center_id: centerId,
    p: {
      account_holder_name: input.account_holder_name.trim(),
      account_holder_type: input.account_holder_type === 'individual' ? 'individual' : 'business',
      bank_name: input.bank_name.trim(),
      account_type: input.account_type,
      routing_number: input.routing_number.trim(),
      account_number_enc: enc,
      last4: digits.slice(-4),
      note: input.note?.trim() || undefined,
    },
  })
  if (error) return { success: false, error: friendlyTuitionError(error) }
  return { success: true }
}

/** Owner: the full account number on file. The database checks it's the owner and logs the view first. */
export async function revealCenterBankAccount(centerId: string): Promise<Result<{ account_number: string }>> {
  if (!UUID.test(centerId)) return { success: false, error: 'Bad request' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('center_bank_reveal', { p_center_id: centerId })
  if (error) return { success: false, error: friendlyTuitionError(error) }
  try {
    return { success: true, account_number: decryptAccountNumber((data as { account_number_enc: string }).account_number_enc, undefined, 'center') }
  } catch (e) {
    console.error('[center-bank] could not decrypt the account number', e instanceof BankKeyMissingError ? 'key missing' : 'wrong key or damaged value')
    return { success: false, error: e instanceof BankKeyMissingError ? KEY_MISSING : 'This account number can’t be read with the current key. Enter it again.' }
  }
}

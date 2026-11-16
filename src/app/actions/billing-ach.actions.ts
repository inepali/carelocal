'use server'

import { createClient } from '@/lib/supabase/server'
import { friendlyBillingError } from '@/lib/billing'
import { BankKeyMissingError, decryptAccountNumber } from '@/lib/server/bank-account'
import { NachaError, buildAchCsv, buildNachaFile, type NachaDebit } from '@/lib/server/nacha'

type Result<T> = ({ success: true } & T) | { success: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AchExportInput {
  format: 'nacha' | 'csv'
  companyId: string          // from the center's bank (Nacha only)
  companyName: string        // shows on the family's statement (Nacha only)
  balanced: boolean          // add an offsetting credit to the center's account (Nacha only)
}

interface ExportRow {
  batch_id: string
  draft_date: string
  center_name: string | null
  bank: { account_holder_name: string; bank_name: string; routing_number: string; account_type: 'checking' | 'savings'; account_number_enc: string; last4: string }
  items: { charge_id: string; payer_name: string; child_name: string; routing_number: string; account_type: 'checking' | 'savings'; account_number_enc: string; amount: number }[]
}

/**
 * Owner: the ACH drafts of a billing run as a file for the center's bank (Nacha, or CSV). Runs with the signed-in
 * user's own session: the database checks it's the owner, logs the download in each child's Activity and marks the
 * batch downloaded, then hands over the encrypted account numbers, which are decrypted only here. The file goes
 * straight back to this caller; plain account numbers are never logged or stored.
 */
export async function exportAchBatch(batchId: string, input: AchExportInput): Promise<Result<{ filename: string; content: string; count: number; total: number }>> {
  if (!UUID.test(batchId) || !input || (input.format !== 'nacha' && input.format !== 'csv')) return { success: false, error: 'Bad request' }
  if (input.format === 'nacha' && !/^[A-Za-z0-9]{1,10}$/.test(input.companyId?.trim() ?? '')) {
    return { success: false, error: 'Enter the Company ID your bank gave you for ACH (up to 10 letters or digits).' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('billing_ach_export', { p_batch_id: batchId })
  if (error) return { success: false, error: friendlyBillingError(error) }
  const row = data as ExportRow

  let debits: NachaDebit[]
  let centerAccount: string | null = null
  try {
    debits = row.items.map(i => ({
      routing: i.routing_number, account: decryptAccountNumber(i.account_number_enc), accountType: i.account_type,
      amount: Number(i.amount), name: i.payer_name, id: i.child_name,
    }))
    if (input.format === 'nacha' && input.balanced) centerAccount = decryptAccountNumber(row.bank.account_number_enc, undefined, 'center')
  } catch (e) {
    console.error('[billing] could not decrypt an account number for the ACH file', e instanceof BankKeyMissingError ? 'key missing' : 'wrong key or damaged value')
    return {
      success: false,
      error: e instanceof BankKeyMissingError
        ? 'Bank details can’t be read on this server (the encryption key is not set). Ask your CareLocal administrator.'
        : 'An account number in this batch can’t be read with the current key. Re-enter that family’s bank details.',
    }
  }

  const total = debits.reduce((t, d) => t + Math.round(d.amount * 100), 0) / 100
  const stamp = row.draft_date.replaceAll('-', '')
  try {
    if (input.format === 'csv') {
      return { success: true, filename: `ach-drafts-${stamp}.csv`, content: buildAchCsv(debits, row.draft_date), count: debits.length, total }
    }
    const content = buildNachaFile(debits, {
      originRouting: row.bank.routing_number,
      originBankName: row.bank.bank_name,
      companyName: input.companyName?.trim() || row.center_name || row.bank.account_holder_name,
      companyId: input.companyId.trim(),
      effectiveDate: row.draft_date,
      balanced: centerAccount ? { account: centerAccount, accountType: row.bank.account_type, name: row.bank.account_holder_name } : undefined,
    })
    return { success: true, filename: `ach-drafts-${stamp}.ach`, content, count: debits.length, total }
  } catch (e) {
    if (e instanceof NachaError) return { success: false, error: e.message }
    throw e
  }
}

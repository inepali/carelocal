// Server only (it decrypts full account numbers). Builds a billing run's ACH file from the batch and the center's
// ACH settings. Used by the download (exportAchBatch) and by the SFTP send (sendAchBatchBySftp).
import type { SupabaseClient } from '@supabase/supabase-js'
import { friendlyBillingError } from '@/lib/billing'
import type { AchSettings } from '@/lib/ach-banks'
import { BankKeyMissingError, decryptAccountNumber } from '@/lib/server/bank-account'
import { NachaError, buildAchCsv, buildNachaFile, nachaFileName, type NachaDebit } from '@/lib/server/nacha'

export interface ExportRow {
  batch_id: string
  draft_date: string
  center_name: string | null
  bank: { account_holder_name: string; bank_name: string; routing_number: string; account_type: 'checking' | 'savings'; account_number_enc: string; last4: string }
  items: { charge_id: string; payer_name: string; child_name: string; routing_number: string; account_type: 'checking' | 'savings'; account_number_enc: string; amount: number }[]
}

export type FileSettings = Pick<AchSettings, 'company_id' | 'company_name' | 'entry_description' | 'immediate_destination'
  | 'immediate_destination_name' | 'immediate_origin' | 'balanced' | 'line_ending' | 'file_name_pattern'>

export interface BuildInput {
  format: 'nacha' | 'csv'
  companyId?: string          // typed on the Run ACH form; falls back to the saved settings
  companyName?: string
  balanced?: boolean
  settings: FileSettings | null
}

export type Built = { success: true; filename: string; content: string; count: number; total: number } | { success: false; error: string }

/**
 * Calls billing_ach_export with the caller's own session (the database checks it's the owner, logs the download in
 * each child's Activity and marks the batch downloaded), then decrypts the account numbers here and writes the file.
 * Plain account numbers are never logged or stored.
 */
export async function buildBatchFile(supabase: SupabaseClient, batchId: string, input: BuildInput): Promise<Built> {
  const s = input.settings
  const companyId = (input.companyId?.trim() || s?.company_id || '').toUpperCase()
  if (input.format === 'nacha' && !/^[A-Z0-9]{1,10}$/.test(companyId)) {
    return { success: false, error: 'Enter the Company ID your bank gave you for ACH (up to 10 letters or digits), or save it in the ACH bank settings.' }
  }
  const balanced = input.balanced ?? s?.balanced ?? false

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
    if (input.format === 'nacha' && balanced) centerAccount = decryptAccountNumber(row.bank.account_number_enc, undefined, 'center')
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
      companyName: input.companyName?.trim() || s?.company_name || row.center_name || row.bank.account_holder_name,
      companyId,
      entryDescription: s?.entry_description || undefined,
      effectiveDate: row.draft_date,
      balanced: centerAccount ? { account: centerAccount, accountType: row.bank.account_type, name: row.bank.account_holder_name } : undefined,
      immediateDestination: s?.immediate_destination || undefined,
      immediateDestinationName: s?.immediate_destination_name || undefined,
      immediateOrigin: s?.immediate_origin || undefined,
      lineEnding: s?.line_ending ?? 'lf',
    })
    const filename = s?.file_name_pattern
      ? nachaFileName(s.file_name_pattern, { companyId, draftDate: row.draft_date })
      : `ach-drafts-${stamp}.ach`
    return { success: true, filename, content, count: debits.length, total }
  } catch (e) {
    if (e instanceof NachaError) return { success: false, error: e.message }
    throw e
  }
}

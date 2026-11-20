'use server'

import { createClient } from '@/lib/supabase/server'
import { friendlyBillingError } from '@/lib/billing'
import type { AchSettingsData } from '@/lib/ach-banks'
import { buildBatchFile } from '@/lib/server/ach-file'
import { BankKeyMissingError, decryptSecret } from '@/lib/server/bank-account'
import { SftpError, pgpEncrypt, uploadSftp } from '@/lib/server/ach-sftp'

type Result<T> = ({ success: true } & T) | { success: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AchExportInput {
  format: 'nacha' | 'csv'
  companyId?: string         // from the center's bank (Nacha only); empty = the saved ACH settings
  companyName?: string       // shows on the family's statement (Nacha only)
  balanced?: boolean         // add an offsetting credit to the center's account (Nacha only)
}

async function centerOfBatch(supabase: Awaited<ReturnType<typeof createClient>>, batchId: string): Promise<string | null> {
  const { data } = await supabase.from('billing_ach_batches').select('center_id').eq('id', batchId).maybeSingle()
  return (data as { center_id: string } | null)?.center_id ?? null
}

/**
 * Owner: the ACH drafts of a billing run as a file for the center's bank (Nacha, or CSV), built with the center's
 * saved ACH settings. The file goes straight back to this caller.
 */
export async function exportAchBatch(batchId: string, input: AchExportInput): Promise<Result<{ filename: string; content: string; count: number; total: number }>> {
  if (!UUID.test(batchId) || !input || (input.format !== 'nacha' && input.format !== 'csv')) return { success: false, error: 'Bad request' }
  const supabase = await createClient()
  const centerId = await centerOfBatch(supabase, batchId)
  let settings: AchSettingsData['settings'] = null
  if (centerId) {
    const { data } = await supabase.rpc('center_ach_settings_get', { p_center_id: centerId })
    settings = (data as AchSettingsData | null)?.settings ?? null
  }
  return buildBatchFile(supabase, batchId, { ...input, settings })
}

interface StoredSettings {
  send_method: 'manual' | 'sftp' | 'api'
  company_id: string | null; company_name: string | null; entry_description: string | null
  immediate_destination: string | null; immediate_destination_name: string | null; immediate_origin: string | null
  balanced: boolean; line_ending: 'lf' | 'crlf'; file_name_pattern: string | null
  sftp_host: string | null; sftp_port: number; sftp_username: string | null; sftp_auth: 'password' | 'key'
  sftp_secret_enc: string | null; sftp_passphrase_enc: string | null; sftp_remote_dir: string | null
  sftp_host_fingerprint: string | null; pgp_public_key: string | null
}

/**
 * Owner: build the batch's NACHA file and send it to the bank's SFTP server, then mark the batch sent.
 * The batch is claimed first, so two clicks (or two people) can't deliver the same drafts twice.
 */
export async function sendAchBatchBySftp(batchId: string): Promise<Result<{ fileName: string; count: number; total: number }>> {
  if (!UUID.test(batchId)) return { success: false, error: 'Bad request' }
  const supabase = await createClient()

  const { data: centerId, error: claimErr } = await supabase.rpc('billing_ach_sftp_claim', { p_batch_id: batchId })
  if (claimErr) return { success: false, error: friendlyBillingError(claimErr) }
  const center = centerId as string
  const release = () => supabase.rpc('billing_ach_sftp_done', { p_batch_id: batchId, p_file_name: null })
  const log = (action: 'sent' | 'send_failed', summary: string) =>
    supabase.rpc('center_ach_settings_log', { p_center_id: center, p_action: action, p_summary: summary })

  const { data: raw, error: sErr } = await supabase.rpc('center_ach_settings_secrets', { p_center_id: center, p_purpose: 'send' })
  if (sErr) { await release(); return { success: false, error: friendlyBillingError(sErr) } }
  const s = raw as StoredSettings
  if (s.send_method !== 'sftp' || !s.sftp_host || !s.sftp_username || !s.sftp_secret_enc || !s.sftp_host_fingerprint) {
    await release()
    return { success: false, error: 'SFTP sending isn’t set up for this center. Finish the ACH bank settings (About → Center Profile), or download the file and upload it by hand.' }
  }

  let secret: string, passphrase: string | undefined
  try {
    secret = decryptSecret(s.sftp_secret_enc)
    passphrase = s.sftp_passphrase_enc ? decryptSecret(s.sftp_passphrase_enc) : undefined
  } catch (e) {
    await release()
    return { success: false, error: e instanceof BankKeyMissingError
      ? 'Bank settings can’t be read on this server (the encryption key is not set). Ask your CareLocal administrator.'
      : 'The saved SFTP password or key can’t be read with the current key. Enter it again in the ACH bank settings.' }
  }

  const built = await buildBatchFile(supabase, batchId, { format: 'nacha', settings: s })
  if (!built.success) { await release(); return built }

  let payload: Buffer, fileName = built.filename
  try {
    payload = s.pgp_public_key ? await pgpEncrypt(built.content, s.pgp_public_key) : Buffer.from(built.content, 'utf8')
    if (s.pgp_public_key) fileName += '.pgp'
    await uploadSftp({ host: s.sftp_host, port: s.sftp_port, username: s.sftp_username, auth: s.sftp_auth, secret, passphrase,
      remoteDir: s.sftp_remote_dir, fingerprint: s.sftp_host_fingerprint }, fileName, payload)
  } catch (e) {
    const msg = e instanceof SftpError ? e.message : 'The file couldn’t be sent to the bank.'
    if (!(e instanceof SftpError)) console.error('[ach-sftp] send failed', e instanceof Error ? e.name : 'unknown')
    await release()
    await log('send_failed', `${fileName}: ${msg}`)
    return { success: false, error: `${msg} The batch was not marked sent.` }
  }

  const { error: doneErr } = await supabase.rpc('billing_ach_sftp_done', { p_batch_id: batchId, p_file_name: fileName })
  await log('sent', `${fileName} · ${built.count} ${built.count === 1 ? 'draft' : 'drafts'}`)
  if (doneErr) {
    return { success: false, error: `The bank received ${fileName}, but CareLocal couldn’t mark the batch sent (${friendlyBillingError(doneErr)}). Don’t send it again: press “Mark sent”.` }
  }
  return { success: true, fileName, count: built.count, total: built.total }
}

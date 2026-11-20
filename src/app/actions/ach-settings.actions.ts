'use server'

import { createClient } from '@/lib/supabase/server'
import { friendlyTuitionError } from '@/lib/tuition'
import { BANK_PRESETS, checkAchSettings, type AchSettings, type AchSettingsData, type AchSettingsInput, type SecretName } from '@/lib/ach-banks'
import { BankKeyMissingError, decryptSecret, encryptSecret } from '@/lib/server/bank-account'
import { SftpError, readHostFingerprint, testSftp } from '@/lib/server/ach-sftp'

type Result<T> = ({ success: true } & T) | { success: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY_MISSING = 'Bank settings can’t be saved on this server yet (the encryption key is not set). Ask your CareLocal administrator.'
const SECRETS: SecretName[] = ['sftp_secret', 'sftp_passphrase', 'api_client_secret', 'api_client_key']

/**
 * Owner: save the center's ACH bank settings. Runs with the signed-in user's own session (the database refuses anyone
 * but the center's owner). Secrets typed in the form are encrypted here; only ciphertext reaches the database and the
 * plain values are never logged or sent back to the browser.
 */
export async function saveAchSettings(centerId: string, input: AchSettingsInput): Promise<Result<{ settings: AchSettings }>> {
  if (!UUID.test(centerId) || !input || typeof input !== 'object') return { success: false, error: 'Bad request' }
  const supabase = await createClient()
  const { data: cur, error: getErr } = await supabase.rpc('center_ach_settings_get', { p_center_id: centerId })
  if (getErr) return { success: false, error: friendlyTuitionError(getErr) }
  const current = cur as AchSettingsData
  if (!current.is_owner) return { success: false, error: 'Only the center’s owner can change the ACH bank settings.' }

  const clear = (input.clear ?? []).filter(n => SECRETS.includes(n))
  const problem = checkAchSettings({ ...input, clear }, { sftp_secret: !!current.settings?.has_sftp_secret })
  if (problem) return { success: false, error: problem }

  // Only the API fields the chosen bank uses, as short plain strings
  const extra: Record<string, string> = {}
  for (const f of BANK_PRESETS[input.bank].apiExtra) {
    const v = String(input.api_extra?.[f.key] ?? '').trim().slice(0, 200)
    if (v) extra[f.key] = v
  }

  const p: Record<string, unknown> = {
    bank: input.bank, bank_label: input.bank === 'other' ? input.bank_label.trim() : '', send_method: input.send_method,
    company_id: input.company_id.trim(), company_name: input.company_name.trim(), entry_description: input.entry_description.trim(),
    immediate_destination: input.immediate_destination.trim(), immediate_destination_name: input.immediate_destination_name.trim(),
    immediate_origin: input.immediate_origin.trim(), balanced: !!input.balanced, line_ending: input.line_ending === 'crlf' ? 'crlf' : 'lf',
    file_name_pattern: input.file_name_pattern.trim(),
    sftp_host: input.sftp_host.trim(), sftp_port: Number(input.sftp_port || 22), sftp_username: input.sftp_username.trim(),
    sftp_auth: input.sftp_auth === 'password' ? 'password' : 'key', sftp_remote_dir: input.sftp_remote_dir.trim(),
    sftp_host_fingerprint: input.sftp_host_fingerprint.trim(), pgp_public_key: input.pgp_public_key.trim(),
    api_environment: input.api_environment === 'production' ? 'production' : 'sandbox', api_base_url: input.api_base_url.trim(),
    api_client_id: input.api_client_id.trim(), api_client_cert: input.api_client_cert.trim(), api_extra: extra,
    clear,
  }
  try {
    for (const name of SECRETS) {
      const v = input[name]
      // Passwords keep their spaces; keys and secrets are trimmed of the surrounding whitespace a paste adds
      const value = name === 'sftp_secret' && input.sftp_auth === 'password' ? v : v?.trim()
      if (value) {
        if (value.length > 12_000) return { success: false, error: 'That key is too long.' }
        p[`${name}_enc`] = encryptSecret(name === 'sftp_secret' && input.sftp_auth === 'key' ? value + '\n' : value)
      }
    }
  } catch (e) {
    if (e instanceof BankKeyMissingError) {
      console.error('[ach-settings] TUITION_BANK_KEY is missing or not 32 bytes; refusing to store a bank secret')
      return { success: false, error: KEY_MISSING }
    }
    throw e
  }

  const { data, error } = await supabase.rpc('center_ach_settings_save', { p_center_id: centerId, p })
  if (error) return { success: false, error: friendlyTuitionError(error) }
  return { success: true, settings: data as AchSettings }
}

interface Stored {
  sftp_host: string | null; sftp_port: number; sftp_username: string | null; sftp_auth: 'password' | 'key'
  sftp_secret_enc: string | null; sftp_passphrase_enc: string | null; sftp_remote_dir: string | null; sftp_host_fingerprint: string | null
}

/** Owner: sign in to the bank's SFTP server with the saved settings and check the folder. Sends nothing. Logged. */
export async function testAchConnection(centerId: string): Promise<Result<{ folder: string }>> {
  if (!UUID.test(centerId)) return { success: false, error: 'Bad request' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('center_ach_settings_secrets', { p_center_id: centerId, p_purpose: 'test' })
  if (error) return { success: false, error: friendlyTuitionError(error) }
  const s = data as Stored
  if (!s.sftp_host || !s.sftp_username || !s.sftp_secret_enc || !s.sftp_host_fingerprint) {
    return { success: false, error: 'Save the SFTP host, username, password or private key, and host key fingerprint first.' }
  }
  const log = (action: 'tested' | 'test_failed', summary: string) =>
    supabase.rpc('center_ach_settings_log', { p_center_id: centerId, p_action: action, p_summary: summary })
  try {
    const res = await testSftp({
      host: s.sftp_host, port: s.sftp_port, username: s.sftp_username, auth: s.sftp_auth,
      secret: decryptSecret(s.sftp_secret_enc), passphrase: s.sftp_passphrase_enc ? decryptSecret(s.sftp_passphrase_enc) : undefined,
      remoteDir: s.sftp_remote_dir, fingerprint: s.sftp_host_fingerprint,
    })
    await log('tested', `Signed in to ${s.sftp_host}, folder ${res.folder} is there`)
    return { success: true, folder: res.folder }
  } catch (e) {
    const msg = e instanceof BankKeyMissingError ? KEY_MISSING
      : e instanceof SftpError ? e.message
      : e instanceof Error && /Unsupported state|auth/i.test(e.message) ? 'The saved password or key can’t be read with the current key. Enter it again.'
      : 'The connection test failed.'
    await log('test_failed', `${s.sftp_host}: ${msg}`)
    return { success: false, error: msg }
  }
}

/**
 * Owner: the host key the saved SFTP server presents, to compare with the fingerprint your bank gives you.
 * Only the saved host and port, so this can't be pointed at other servers.
 */
export async function readAchHostFingerprint(centerId: string): Promise<Result<{ fingerprint: string }>> {
  if (!UUID.test(centerId)) return { success: false, error: 'Bad request' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('center_ach_settings_get', { p_center_id: centerId })
  if (error) return { success: false, error: friendlyTuitionError(error) }
  const d = data as AchSettingsData
  if (!d.is_owner) return { success: false, error: 'Only the center’s owner can connect to the bank.' }
  if (!d.settings?.sftp_host) return { success: false, error: 'Save the SFTP host and port first.' }
  try {
    return { success: true, fingerprint: await readHostFingerprint(d.settings.sftp_host, d.settings.sftp_port) }
  } catch (e) {
    return { success: false, error: e instanceof SftpError ? e.message : 'The server couldn’t be reached.' }
  }
}

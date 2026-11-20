/**
 * ACH bank settings shared by the browser and the server: the banks CareLocal knows, how each takes an ACH (NACHA)
 * file, and the checks the settings form and the server both run. No secrets here.
 *
 * What we know about each bank, and where it came from (Nov 2026):
 *  - Every bank on the list takes a NACHA file uploaded on its business banking website, and by file transmission
 *    (SFTP, "direct transmission") once the bank sets it up for the center.
 *  - Bank APIs (Wells Fargo Gateway, Bank of America CashPro API) take ACH payments one at a time as JSON, need an OAuth
 *    client, a client certificate (mutual TLS) and a signed agreement, so they don't send NACHA files. Their
 *    credentials are kept for a later phase; nothing is sent by API yet.
 *  - SFTP host names, folders, file names and PGP keys are given by the bank when it sets the center up. They are not
 *    filled in here because they differ per customer.
 */

export type AchBank = 'truist' | 'wells_fargo' | 'bank_of_america' | 'other'
export type AchSendMethod = 'manual' | 'sftp' | 'api'
export type SecretName = 'sftp_secret' | 'sftp_passphrase' | 'api_client_secret' | 'api_client_key'

export interface BankPreset {
  label: string
  uploadHint: string                       // where the file goes when it's uploaded by hand
  transmissionHint: string                 // how to get SFTP set up
  apiHint: string
  apiBaseUrl?: string                      // production base URL, when the bank publishes it
  apiExtra: { key: string; label: string; help?: string }[]   // non-secret API values the bank gives you
}

export const BANK_PRESETS: Record<AchBank, BankPreset> = {
  truist: {
    label: 'Truist',
    uploadHint: 'Truist One View → ACH → file import.',
    transmissionHint: 'Ask your Truist treasury consultant to set up ACH file transmission (SFTP). They give you the host, username, folder and file name rules, and ask for CareLocal’s IP address.',
    apiHint: 'Ask your Truist treasury consultant about API access for ACH.',
    apiExtra: [],
  },
  wells_fargo: {
    label: 'Wells Fargo',
    uploadHint: 'The ACH file upload page in your Wells Fargo commercial banking portal (Vantage or CEO).',
    transmissionHint: 'Ask your Wells Fargo treasury representative to set up ACH file transmission (SFTP). They give you the host, username, folder and file name rules, and ask for CareLocal’s IP address.',
    apiHint: 'Wells Fargo Gateway (developer.wellsfargo.com): an OAuth client ID and secret plus a client certificate, issued after Wells Fargo approves the app.',
    apiBaseUrl: 'https://api.wellsfargo.com',
    apiExtra: [
      { key: 'gateway_entity_id', label: 'Gateway entity ID', help: 'From Wells Fargo Gateway, sent with each API call' },
      { key: 'gateway_company_id', label: 'Gateway company ID' },
    ],
  },
  bank_of_america: {
    label: 'Bank of America',
    uploadHint: 'The ACH file import page in CashPro Online.',
    transmissionHint: 'Ask your Bank of America treasury representative about CashPro Connect (file transmission by SFTP). They give you the host, username, folder and file name rules, and ask for CareLocal’s IP address.',
    apiHint: 'CashPro API (developer.bankofamerica.com): request production access in CashPro Developer Studio for an app ID, client ID and secret. Its ACH API is for payments one at a time.',
    apiExtra: [
      { key: 'app_id', label: 'App ID', help: 'From CashPro Developer Studio' },
      { key: 'cashpro_user_id', label: 'CashPro user ID', help: 'The CashPro user the API connects as' },
    ],
  },
  other: {
    label: 'Another bank',
    uploadHint: 'Your bank’s ACH file upload page in its business banking website.',
    transmissionHint: 'Ask your bank about ACH file transmission (SFTP). They give you the host, username, folder and file name rules, and ask for CareLocal’s IP address.',
    apiHint: 'Ask your bank which API credentials it issues.',
    apiExtra: [],
  },
}

export const SEND_METHOD_LABEL: Record<AchSendMethod, string> = {
  manual: 'Download the file and upload it on the bank’s website',
  sftp: 'CareLocal sends the file to the bank by SFTP',
  api: 'Bank API (saved for later; files are still uploaded by hand)',
}

/** The settings as the browser sees them: no secrets, only whether each is set */
export interface AchSettings {
  center_id: string
  bank: AchBank; bank_label: string | null; send_method: AchSendMethod
  company_id: string | null; company_name: string | null; entry_description: string | null
  immediate_destination: string | null; immediate_destination_name: string | null; immediate_origin: string | null
  balanced: boolean; line_ending: 'lf' | 'crlf'; file_name_pattern: string | null
  sftp_host: string | null; sftp_port: number; sftp_username: string | null; sftp_auth: 'password' | 'key'
  sftp_remote_dir: string | null; sftp_host_fingerprint: string | null; pgp_public_key: string | null
  api_environment: 'sandbox' | 'production'; api_base_url: string | null; api_client_id: string | null
  api_client_cert: string | null; api_extra: Record<string, string>
  has_sftp_secret: boolean; has_sftp_passphrase: boolean; has_api_client_secret: boolean; has_api_client_key: boolean
  created_at: string; updated_at: string; updated_by: string
}

export interface AchSettingsData {
  is_owner: boolean
  settings: AchSettings | null
  events: { action: 'saved' | 'secrets_read' | 'tested' | 'test_failed' | 'sent' | 'send_failed'; at: string; who: string; summary: string | null }[]
}

/** What the form sends. Secrets: a value replaces the stored one, a name in `clear` removes it, empty keeps it. */
export interface AchSettingsInput {
  bank: AchBank; bank_label: string; send_method: AchSendMethod
  company_id: string; company_name: string; entry_description: string
  immediate_destination: string; immediate_destination_name: string; immediate_origin: string
  balanced: boolean; line_ending: 'lf' | 'crlf'; file_name_pattern: string
  sftp_host: string; sftp_port: string; sftp_username: string; sftp_auth: 'password' | 'key'
  sftp_remote_dir: string; sftp_host_fingerprint: string; pgp_public_key: string
  api_environment: 'sandbox' | 'production'; api_base_url: string; api_client_id: string; api_client_cert: string
  api_extra: Record<string, string>
  sftp_secret?: string; sftp_passphrase?: string; api_client_secret?: string; api_client_key?: string
  clear?: SecretName[]
}

export function settingsToInput(s: AchSettings | null): AchSettingsInput {
  return {
    bank: s?.bank ?? 'truist', bank_label: s?.bank_label ?? '', send_method: s?.send_method ?? 'manual',
    company_id: s?.company_id ?? '', company_name: s?.company_name ?? '', entry_description: s?.entry_description ?? '',
    immediate_destination: s?.immediate_destination ?? '', immediate_destination_name: s?.immediate_destination_name ?? '',
    immediate_origin: s?.immediate_origin ?? '', balanced: s?.balanced ?? false, line_ending: s?.line_ending ?? 'lf',
    file_name_pattern: s?.file_name_pattern ?? '',
    sftp_host: s?.sftp_host ?? '', sftp_port: String(s?.sftp_port ?? 22), sftp_username: s?.sftp_username ?? '',
    sftp_auth: s?.sftp_auth ?? 'key', sftp_remote_dir: s?.sftp_remote_dir ?? '', sftp_host_fingerprint: s?.sftp_host_fingerprint ?? '',
    pgp_public_key: s?.pgp_public_key ?? '',
    api_environment: s?.api_environment ?? 'sandbox', api_base_url: s?.api_base_url ?? '', api_client_id: s?.api_client_id ?? '',
    api_client_cert: s?.api_client_cert ?? '', api_extra: { ...(s?.api_extra ?? {}) },
  }
}

export const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}=?$/
const HOST = /^[A-Za-z0-9.-]{1,253}$/
const FILE_PATTERN = /^[A-Za-z0-9{}._-]{1,120}$/

/** The first problem with the form, or null. The database checks the same rules again. */
export function checkAchSettings(i: AchSettingsInput, has: { sftp_secret: boolean }): string | null {
  if (!(i.bank in BANK_PRESETS)) return 'Pick the bank.'
  if (i.bank === 'other' && !i.bank_label.trim()) return 'Enter the bank’s name.'
  if (i.company_id.trim() && !/^[A-Za-z0-9]{1,10}$/.test(i.company_id.trim())) return 'The Company ID is up to 10 letters or digits.'
  if (i.company_name.trim().length > 16) return 'The company name on statements is up to 16 characters.'
  if (i.entry_description.trim().length > 10) return 'The entry description is up to 10 characters.'
  if (i.immediate_destination.trim() && !/^\d{9}$/.test(i.immediate_destination.trim())) return 'The immediate destination is 9 digits.'
  if (i.immediate_destination_name.trim().length > 23) return 'The destination name is up to 23 characters.'
  if (i.immediate_origin.trim() && !/^[A-Za-z0-9]{1,10}$/.test(i.immediate_origin.trim())) return 'The immediate origin is up to 10 letters or digits.'
  if (i.file_name_pattern.trim() && !FILE_PATTERN.test(i.file_name_pattern.trim())) return 'The file name can use letters, digits, . _ - and the {tokens} only.'
  if (i.sftp_host.trim() && !HOST.test(i.sftp_host.trim())) return 'The SFTP host is a server name like sftp.yourbank.com (no https:// or slashes).'
  const port = Number(i.sftp_port || 22)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'The SFTP port is a number from 1 to 65535.'
  if (i.sftp_username.trim().length > 100) return 'The SFTP username is too long.'
  if (i.sftp_remote_dir.includes('..') || i.sftp_remote_dir.length > 200) return 'The SFTP folder can’t contain “..”.'
  if (i.sftp_host_fingerprint.trim() && !FINGERPRINT.test(i.sftp_host_fingerprint.trim())) return 'The host key fingerprint looks like SHA256: followed by 43 characters. Ask your bank for it.'
  if (i.pgp_public_key.trim() && !i.pgp_public_key.trim().startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----')) return 'Paste the bank’s PGP public key, starting with -----BEGIN PGP PUBLIC KEY BLOCK-----.'
  if (i.sftp_auth === 'key' && i.sftp_secret?.trim() && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(i.sftp_secret)) return 'Paste the whole private key, starting with -----BEGIN … PRIVATE KEY-----.'
  if (i.api_base_url.trim() && !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/.test(i.api_base_url.trim())) return 'The API URL starts with https:// and has no query string.'
  if (i.api_client_cert.trim() && !i.api_client_cert.trim().startsWith('-----BEGIN CERTIFICATE-----')) return 'Paste the client certificate, starting with -----BEGIN CERTIFICATE-----.'
  if (i.api_client_key?.trim() && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(i.api_client_key)) return 'Paste the whole certificate private key, starting with -----BEGIN … PRIVATE KEY-----.'
  if (i.send_method === 'sftp') {
    const secret = !!i.sftp_secret?.trim() || (has.sftp_secret && !i.clear?.includes('sftp_secret'))
    if (!i.sftp_host.trim() || !i.sftp_username.trim() || !secret || !i.sftp_host_fingerprint.trim()) {
      return 'To send by SFTP, enter the host, username, password or private key, and the host key fingerprint from your bank.'
    }
  }
  return null
}

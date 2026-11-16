// Server only. Self-contained on purpose (node:crypto, no path aliases) so scripts/tuition/tuition.test.mjs can load it.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Bank account numbers for ACH tuition drafts are encrypted here, on the server, before they reach the database, so a
 * database dump or a leaked backup holds only ciphertext (Nacha: account numbers stored electronically must be
 * unreadable). The key lives only in the server environment:
 *
 *   TUITION_BANK_KEY = 32 random bytes, base64   (openssl rand -base64 32)   one per environment
 *
 * Format: "v1:<iv>:<tag>:<ciphertext>" (AES-256-GCM, 12-byte IV, base64). The version prefix lets a later key or
 * algorithm sit alongside old rows. Losing or changing the key makes every stored account number unreadable, so keep
 * it with the other production secrets.
 */

const VERSION = 'v1'
/**
 * What the number is for, bound into the ciphertext (GCM additional data), so a center's deposit account can't be
 * copied into a payer row (or the other way round) and still decrypt.
 */
export type BankPurpose = 'payer' | 'center'
const AAD: Record<BankPurpose, Buffer> = {
  payer: Buffer.from('carelocal:tuition:ach-account:v1'),
  center: Buffer.from('carelocal:center:deposit-account:v1'),
}

export class BankKeyMissingError extends Error {
  constructor() { super('TUITION_BANK_KEY is not set (32 random bytes, base64)') }
}

export function bankKey(raw = process.env.TUITION_BANK_KEY): Buffer {
  if (!raw) throw new BankKeyMissingError()
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new BankKeyMissingError()
  return key
}

/** Digits only, 4 to 17 of them (the Nacha account field is 17 characters) */
export function normalizeAccountNumber(input: string): string | null {
  const digits = (input ?? '').replace(/[\s-]/g, '')
  return /^\d{4,17}$/.test(digits) ? digits : null
}

export function encryptAccountNumber(accountNumber: string, key: Buffer = bankKey(), purpose: BankPurpose = 'payer'): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(AAD[purpose])
  const ct = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decryptAccountNumber(stored: string, key: Buffer = bankKey(), purpose: BankPurpose = 'payer'): string {
  const [version, iv, tag, ct] = (stored ?? '').split(':')
  if (version !== VERSION || !iv || !tag || !ct) throw new Error('Unknown bank account format')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  decipher.setAAD(AAD[purpose])
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
}

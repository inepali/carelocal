// Self-contained on purpose (no imports) so the tests can load it with plain node.

/**
 * Parent PINs: 6 digits, unique within a center. A parent signs in on their center's private link
 * (/parent/<key>) with the PIN, so a stranger needs both. Owners and admins can type a PIN or let CareLocal
 * pick one; typed PINs that are easy to guess (123456, 000000, 121212...) are refused.
 */

export const PIN_LENGTH = 6

/** What the parent or admin typed, as 6 digits, or null when it cannot be a PIN (spaces and dashes are ignored) */
export function normalizePin(input: string): string | null {
  const pin = input.replace(/[\s\-.]/g, '')
  return /^\d{6}$/.test(pin) ? pin : null
}

const COMMON = new Set(['112233', '123321', '111222', '121212', '159753', '147258', '258369', '102030', '101010', '696969', '131313', '202020'])

/** Why a typed PIN is too easy to guess, or null when it is fine */
export function weakPinReason(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return 'Use exactly 6 digits.'
  if (/^(\d)\1{5}$/.test(pin)) return 'Do not use the same digit six times.'
  const d = [...pin].map(Number)
  const steps = d.slice(1).map((x, i) => x - d[i])
  if (steps.every(s => s === 1) || steps.every(s => s === -1)) return 'Do not use digits in order, like 123456.'
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)) return 'Do not repeat a pattern, like 121212 or 123123.'
  if (COMMON.has(pin)) return 'That PIN is too common. Pick another.'
  return null
}

/** A PIN from a random number below 1,000,000 (the caller supplies it, e.g. crypto.randomInt) */
export function pinFromNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1_000_000) throw new Error('Need a whole number below 1,000,000')
  return String(n).padStart(PIN_LENGTH, '0')
}

/** "482913" -> "482 913", easier to read out loud */
export function formatPin(pin: string): string {
  return `${pin.slice(0, 3)} ${pin.slice(3)}`
}

/** A center link key as it appears in /parent/<key>, or null */
export function normalizeCenterKey(input: string | undefined | null): string | null {
  const key = (input ?? '').toLowerCase()
  return /^[0-9a-hjkmnp-tv-z]{8}$/.test(key) ? key : null
}

// Self-contained on purpose (no imports) so the tests can load it with plain node.

/**
 * Parent access codes: 8 characters from Crockford's base32 alphabet (no I, L, O or U), shown as "K7QF-29XM".
 * 32^8 is about 1.1 trillion codes (40 bits), so with 5 tries per 15 minutes per IP nobody guesses one.
 * Parents can type it in any case, with or without the dash or spaces, and O/I/L are read as 0/1/1.
 */

export const PARENT_CODE_LENGTH = 8
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const VALID = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/

/** A new code from 8 random bytes (each byte keeps its low 5 bits: 256 is a multiple of 32, so no bias). */
export function codeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < PARENT_CODE_LENGTH) throw new Error('Need 8 random bytes')
  let code = ''
  for (let i = 0; i < PARENT_CODE_LENGTH; i++) code += ALPHABET[bytes[i] & 31]
  return code
}

/** What the parent typed, as the stored form ("K7QF29XM"), or null when it cannot be a code. */
export function normalizeParentCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s\-_.]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return VALID.test(code) ? code : null
}

/** "K7QF29XM" -> "K7QF-29XM" */
export function formatParentCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/** The last 4 characters, which staff see to tell codes apart */
export function parentCodeHint(code: string): string {
  return code.slice(-4)
}

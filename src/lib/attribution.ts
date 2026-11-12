/**
 * Ad and campaign attribution: the utm_* tags on a landing page visit are carried onto its sign-up links, and the
 * register page saves them with the new account so a sign-up can be traced back to the ad or post that brought it.
 * Values are kept short and plain (letters, digits, space, dot, dash, underscore) so nothing odd reaches the database.
 */

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
export type UtmKey = (typeof UTM_KEYS)[number]
export type Utm = Partial<Record<UtmKey, string>>

const SAFE = /^[\w.\- ]{1,80}$/

type ParamSource = Record<string, string | string[] | undefined> | URLSearchParams

function read(sp: ParamSource, key: string) {
  const v = sp instanceof URLSearchParams ? sp.get(key) : sp[key]
  const value = Array.isArray(v) ? v[0] : v
  return value && SAFE.test(value) ? value : undefined
}

/** The valid utm_* tags in a page's search params */
export function pickUtm(sp: ParamSource): Utm {
  const out: Utm = {}
  for (const key of UTM_KEYS) {
    const value = read(sp, key)
    if (value) out[key] = value
  }
  return out
}

/** Sign-up link for staff or a center, keeping the visit's utm_* tags */
export function registerHref(type: 'staff' | 'center', sp: ParamSource, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ type, ...extra })
  for (const [k, v] of Object.entries(pickUtm(sp))) if (v) q.set(k, v)
  return `/register?${q.toString()}`
}

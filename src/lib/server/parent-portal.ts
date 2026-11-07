import { createHash, createHmac, randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'
import type { ReportData } from '@/lib/daily-report'

/**
 * The parent portal's server side: no Supabase account, so everything here runs with the service role and the
 * database functions (20261228000000_parent_portal.sql) decide what a session may see.
 *
 *  - Codes are stored as HMAC-SHA256(code, PARENT_CODE_PEPPER); IPs the same way, so the attempt log holds no IPs.
 *  - A signed-in device holds a random 256-bit token in the httpOnly cookie below; only its SHA-256 is stored.
 *  - Photos are signed for 15 minutes, and only keys under the child's own center are signed.
 */

export const PARENT_COOKIE = 'cl_parent'
/** The cookie outlives the session on purpose: the database slides the real expiry (30 days, 180 at most). */
export const PARENT_COOKIE_MAX_AGE = 180 * 24 * 60 * 60
const PHOTO_URL_SECONDS = 15 * 60

export const parentDb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

function pepper() {
  const value = process.env.PARENT_CODE_PEPPER
  if (!value || value.length < 32) throw new Error('PARENT_CODE_PEPPER is not set (32+ random characters)')
  return value
}

const hmac = (purpose: string, value: string) => createHmac('sha256', pepper()).update(`${purpose}:${value}`).digest('hex')

/** The stored form of a normalized code ("K7QF29XM") */
export const hashParentCode = (code: string) => hmac('code', code)
export const hashIp = (ip: string) => hmac('ip', ip)
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const newSessionToken = () => randomBytes(32).toString('base64url')

/** The visitor's IP as Vercel reports it (first x-forwarded-for hop), for the attempt limit only */
export async function clientIp() {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
}

export async function userAgent() {
  return ((await headers()).get('user-agent') ?? '').slice(0, 300)
}

/** The current device's token hash, or null when it has no cookie */
export async function parentTokenHash() {
  const token = (await cookies()).get(PARENT_COOKIE)?.value
  return token && token.length >= 40 && token.length <= 64 ? hashToken(token) : null
}

export interface PortalChild { id: string; first_name: string; photo_key: string | null }
export interface PortalHome {
  center: { id: string; name: string; email: string | null; phone: string | null; timezone: string; today: string; domain_key: string | null }
  parent: { name: string | null }
  children: PortalChild[]
}
export interface PortalDay extends ReportData { today: string; entries: (ReportData['entries'][number] & { id: string })[] }
export interface PortalPhoto { id: string; day: string; at: string; photo_key: string; caption: string | null }

export async function loadPortalHome(tokenHash: string) {
  const { data, error } = await parentDb().rpc('parent_portal_home', { p_token_hash: tokenHash })
  if (error) throw new Error(`parent_portal_home: ${error.message}`)
  return (data as PortalHome | null) ?? null
}

export async function loadPortalDay(tokenHash: string, childId: string, day: string | null) {
  const { data, error } = await parentDb().rpc('parent_portal_day', { p_token_hash: tokenHash, p_child_id: childId, p_day: day })
  if (error) throw new Error(`parent_portal_day: ${error.message}`)
  return (data as PortalDay | null) ?? null
}

export async function loadPortalPhotos(tokenHash: string, childId: string, before: string | null) {
  const { data, error } = await parentDb().rpc('parent_portal_photos', { p_token_hash: tokenHash, p_child_id: childId, p_before: before, p_limit: 30 })
  if (error) throw new Error(`parent_portal_photos: ${error.message}`)
  return (data as { center_id: string; timezone: string; photos: PortalPhoto[] } | null) ?? null
}

/** Short-lived links for photo keys, only for keys inside this center's folder. Unsigned keys are left out. */
export async function signPortalPhotos(centerId: string, keys: (string | null | undefined)[]) {
  const bucket = process.env.R2_CHILD_BUCKET
  if (!bucket) return {} as Record<string, string>
  const prefix = `child/${centerId}/`
  const wanted = [...new Set(keys.filter((k): k is string => !!k && k.startsWith(prefix) && !k.includes('..')))]
  const pairs = await Promise.all(wanted.map(async k => {
    try {
      return [k, await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: k }), { expiresIn: PHOTO_URL_SECONDS })] as const
    } catch {
      return null
    }
  }))
  return Object.fromEntries(pairs.filter((p): p is readonly [string, string] => !!p)) as Record<string, string>
}

// ── Messages (20261229000000_parent_message_threads.sql) ──────────────────────────────────────────────────────

export interface PortalThreadSummary {
  id: string
  subject: string
  last_at: string
  last_from: string
  preview: string
  unread: number
  needs_ack: boolean
}
export interface PortalThreadMessage {
  id: string
  from: string
  from_parent: boolean
  mine: boolean
  body: string
  at: string
  to_me: boolean
  acknowledged_at: string | null
  seen_by_center: boolean
}
export interface PortalThread {
  id: string
  subject: string
  child: { id: string; first_name: string }
  center: { name: string; phone: string | null }
  messages: PortalThreadMessage[]
}

/** null = messages are not available to this parent (signed out, or the center turned messages off for them) */
export async function loadPortalThreads(tokenHash: string, childId: string) {
  const { data, error } = await parentDb().rpc('parent_portal_threads', { p_token_hash: tokenHash, p_child_id: childId })
  if (error) throw new Error(`parent_portal_threads: ${error.message}`)
  return (data as PortalThreadSummary[] | null) ?? null
}

/** One conversation, with the device session or with an email link (which opens only its own conversation) */
export async function loadPortalThread(auth: { tokenHash: string } | { linkHash: string }, threadId: string | null) {
  const { data, error } = await parentDb().rpc('parent_portal_thread', {
    p_token_hash: 'tokenHash' in auth ? auth.tokenHash : null,
    p_link_hash: 'linkHash' in auth ? auth.linkHash : null,
    p_thread_id: threadId,
  })
  if (error) throw new Error(`parent_portal_thread: ${error.message}`)
  return (data as PortalThread | null) ?? null
}

/** An email link token from the URL, as stored (null when it cannot be one) */
export function linkHash(token: string | undefined | null) {
  return token && /^[A-Za-z0-9_-]{40,64}$/.test(token) ? hashToken(token) : null
}

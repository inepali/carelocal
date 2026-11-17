'use server'

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { normalizeTimePin } from '@/lib/timeclock'
import {
  TIMECLOCK_COOKIE, TIMECLOCK_ROOM_COOKIE, TIMECLOCK_ROOM_MAX_AGE, deviceTokenHash, hashTimePin, loadDevice, timeclockDb, withPhoto,
  type ClockAuthFailure, type ClockPerson,
} from '@/lib/server/timeclock'

/**
 * The Time Clock tablet (/timeclock). No sign-in: the device cookie says which center's Time Clock this is, and the
 * 4-digit PIN says who is there. The database functions check both and apply the limits (5 wrong PINs per tablet
 * per 15 minutes, 30 per center per hour). Answers never say whose PIN a wrong one is close to.
 */

export type ClockFail = { ok: false; error: string; retryAfter?: number; noDevice?: boolean }
type ClockOk<T> = { ok: true } & T

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
// Our own functions raise these codes with wording meant for staff; anything else gets a generic message
const FRIENDLY_CODES = new Set(['22023', '23505', 'P0002', '42501'])
const INTERNAL = /permission denied|relation|column|function|constraint|violates|syntax|schema|null value/i

function friendly(error: { message?: string; code?: string } | null): string {
  const msg = error?.message?.replace(/^.*?ERROR:\s*/, '')
  if (msg && msg.length < 200 && error?.code && FRIENDLY_CODES.has(error.code) && !INTERNAL.test(msg)) return msg
  return 'Something went wrong. Please try again.'
}

function authFailure(result: ClockAuthFailure): ClockFail {
  switch (result.status) {
    case 'invalid':
      return { ok: false, error: result.left > 0 ? 'That PIN did not work. Try again.' : 'That PIN did not work. The Time Clock will pause for a few minutes.' }
    case 'locked': {
      const minutes = Math.max(1, Math.ceil(result.retry_after / 60))
      return { ok: false, retryAfter: result.retry_after, error: `Too many wrong PINs. Please wait ${minutes} minute${minutes === 1 ? '' : 's'}.` }
    }
    case 'paused':
      return { ok: false, retryAfter: result.retry_after, error: 'The Time Clock is paused after many wrong PINs. Please tell the office.' }
    default:
      return { ok: false, noDevice: true, error: 'This tablet is no longer a Time Clock. Ask an admin to set it up again.' }
  }
}

/** The device and the PIN's hash, or why not */
async function context(pinInput: unknown) {
  const pin = normalizeTimePin(typeof pinInput === 'string' ? pinInput.slice(0, 10) : '')
  if (!pin) return { fail: { ok: false, error: 'Your PIN has 4 digits.' } as ClockFail }
  const tokenHash = await deviceTokenHash()
  const device = await loadDevice(tokenHash)
  if (!device || !tokenHash) return { fail: authFailure({ status: 'no_device' }) }
  return { tokenHash, pinHash: hashTimePin(device.center.id, pin), device }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<ClockOk<T> | ClockFail> {
  const { data, error } = await timeclockDb().rpc(fn, args)
  if (error) {
    if (!error.code || !FRIENDLY_CODES.has(error.code)) console.error(`[timeclock] ${fn} failed:`, error.message)
    return { ok: false, error: friendly(error) }
  }
  const result = data as ({ status: 'ok' } & T) | ClockAuthFailure | { status: string }
  if (result.status === 'ok') {
    const { status: _status, ...rest } = result as { status: 'ok' } & T
    const person = (rest as { person?: ClockPerson }).person
    if (person) (rest as { person?: ClockPerson }).person = await withPhoto(person)
    return { ok: true, ...(rest as T) }
  }
  if (['invalid', 'locked', 'paused', 'no_device'].includes(result.status)) return authFailure(result as ClockAuthFailure)
  return { ok: false, error: 'Something went wrong. Please try again.' }
}

/** PIN typed: who it is, whether they are clocked in, their PTO */
export async function clockIdentify(pin: string): Promise<ClockOk<{ person: ClockPerson }> | ClockFail> {
  try {
    const c = await context(pin)
    if ('fail' in c) return c.fail!
    return await call<{ person: ClockPerson }>('timeclock_identify', { p_token_hash: c.tokenHash, p_pin_hash: c.pinHash })
  } catch (e) {
    console.error('[timeclock] identify failed:', e)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }
}

export async function clockPunch(pin: string, action: 'in' | 'out'): Promise<ClockOk<{ action: 'in' | 'out'; at: string; minutes?: number; person: ClockPerson }> | ClockFail> {
  if (action !== 'in' && action !== 'out') return { ok: false, error: 'Something went wrong. Please try again.' }
  try {
    const c = await context(pin)
    if ('fail' in c) return c.fail!
    const { data, error } = await timeclockDb().rpc('timeclock_punch', { p_token_hash: c.tokenHash, p_pin_hash: c.pinHash, p_action: action })
    if (error) {
      console.error('[timeclock] punch failed:', error.message)
      return { ok: false, error: friendly(error) }
    }
    const r = data as { status: string; action?: 'in' | 'out'; at?: string; minutes?: number; person?: ClockPerson; since?: string }
    if (r.status === 'already_in') return { ok: false, error: 'You are already clocked in.' }
    if (r.status === 'not_in') return { ok: false, error: 'You are not clocked in.' }
    if (r.status !== 'ok') return authFailure(r as ClockAuthFailure)
    return { ok: true, action: r.action!, at: r.at!, minutes: r.minutes, person: await withPhoto(r.person!) }
  } catch (e) {
    console.error('[timeclock] punch failed:', e)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }
}

export async function clockRequestOff(pin: string, input: { kind: string; start: string; end: string; fullDay: boolean; reason?: string }): Promise<ClockOk<{ person: ClockPerson }> | ClockFail> {
  if (!['pto', 'unpaid', 'sick'].includes(input?.kind) || !DAY.test(input?.start ?? '') || !DAY.test(input?.end ?? '')) {
    return { ok: false, error: 'Pick the type and the days.' }
  }
  try {
    const c = await context(pin)
    if ('fail' in c) return c.fail!
    return await call<{ person: ClockPerson }>('timeclock_request_off', {
      p_token_hash: c.tokenHash, p_pin_hash: c.pinHash, p_kind: input.kind, p_start: input.start, p_end: input.end,
      p_full_day: !!input.fullDay, p_reason: (input.reason ?? '').slice(0, 300) || null,
    })
  } catch (e) {
    console.error('[timeclock] time off failed:', e)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }
}

export async function clockCancelOff(pin: string, requestId: string): Promise<ClockOk<{ person: ClockPerson }> | ClockFail> {
  if (!UUID.test(requestId ?? '')) return { ok: false, error: 'Something went wrong. Please try again.' }
  try {
    const c = await context(pin)
    if ('fail' in c) return c.fail!
    return await call<{ person: ClockPerson }>('timeclock_cancel_off', { p_token_hash: c.tokenHash, p_pin_hash: c.pinHash, p_request_id: requestId })
  } catch (e) {
    console.error('[timeclock] cancel failed:', e)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }
}

/**
 * My Room by PIN: signs this tablet in as the teacher (a normal CareLocal session, so the Live Roster works as on
 * their own phone) until they tap Done, the page sits idle, or 15 minutes pass. Only for regular staff of a center
 * with the Live Roster on, and never for a disabled account.
 */
export async function clockOpenRoom(pin: string): Promise<{ ok: true } | ClockFail> {
  try {
    const c = await context(pin)
    if ('fail' in c) return c.fail!
    const db = timeclockDb()
    const res = await call<{ user_id: string; email: string; center_id: string }>('timeclock_room_user', { p_token_hash: c.tokenHash, p_pin_hash: c.pinHash })
    if (!res.ok) return res
    const { data: found } = await db.auth.admin.getUserById(res.user_id)
    if (!found?.user || found.user.app_metadata?.disabled === true || found.user.banned_until) {
      return { ok: false, error: 'Your account is turned off. Please talk to the office.' }
    }
    const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: 'magiclink', email: res.email })
    const tokenHash = link?.properties?.hashed_token
    if (linkError || !tokenHash) {
      console.error('[timeclock] My Room link failed:', linkError?.message)
      return { ok: false, error: 'My Room could not open. Please try again.' }
    }
    const supabase = await createClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
    if (verifyError) {
      console.error('[timeclock] My Room sign-in failed:', verifyError.message)
      return { ok: false, error: 'My Room could not open. Please try again.' }
    }
    const jar = await cookies()
    jar.set(TIMECLOCK_ROOM_COOKIE, String(Date.now() + TIMECLOCK_ROOM_MAX_AGE * 1000), {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: TIMECLOCK_ROOM_MAX_AGE,
    })
    console.warn(`[timeclock] My Room opened for user ${res.user_id} on tablet ${c.device.device_id} (center ${c.device.center.id})`)
    return { ok: true }
  } catch (e) {
    console.error('[timeclock] My Room failed:', e)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }
}

/** Close My Room: the teacher's session on this tablet ends (only here; their phone stays signed in) */
export async function clockCloseRoom(): Promise<{ ok: true }> {
  const jar = await cookies()
  // Only a registered Time Clock signs someone out this way
  if (jar.get(TIMECLOCK_COOKIE)) {
    try {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) await supabase.auth.signOut({ scope: 'local' })
    } catch (e) {
      console.error('[timeclock] My Room sign-out failed:', e)
    }
  }
  jar.delete({ name: TIMECLOCK_ROOM_COOKIE, path: '/' })
  return { ok: true }
}

/** Whether My Room is still open on this tablet (the page closes it when not) */
export async function clockRoomOpen(): Promise<boolean> {
  const until = Number((await cookies()).get(TIMECLOCK_ROOM_COOKIE)?.value)
  return Number.isFinite(until) && until > Date.now()
}

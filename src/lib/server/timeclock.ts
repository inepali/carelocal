import { createHash, createHmac, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'
import type { PtoBalance, TimeOff } from '@/lib/timeclock'

/**
 * The Time Clock's server side (20270120000000_time_clock.sql). The tablet has no CareLocal sign-in: it holds a
 * random device token in an httpOnly cookie (only its SHA-256 is stored) and every call goes through the service
 * role and the timeclock_* database functions, which check the device, the PIN and the attempt limits.
 *
 *  - Time Card PINs are stored as HMAC-SHA256('timepin:' + center id + PIN, PARENT_CODE_PEPPER). The purpose
 *    prefix keeps them apart from parent PINs; the same PIN at two centers is two different hashes.
 *  - The PIN is sent again with each action on the tablet (it lives only in the page's memory for a minute).
 */

export const TIMECLOCK_COOKIE = 'cl_timeclock'
/** Set while a teacher has My Room open on the tablet, so the Time Clock knows to sign them out */
export const TIMECLOCK_ROOM_COOKIE = 'cl_timeclock_room'
export const TIMECLOCK_COOKIE_MAX_AGE = 400 * 24 * 60 * 60   // the device stays registered until an admin removes it
export const TIMECLOCK_ROOM_MAX_AGE = 15 * 60

export const timeclockDb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function pepper() {
  const value = process.env.PARENT_CODE_PEPPER
  if (!value || value.length < 32) throw new Error('PARENT_CODE_PEPPER is not set (32+ random characters)')
  return value
}

export const hashTimePin = (centerId: string, pin: string) => createHmac('sha256', pepper()).update(`timepin:${centerId}:${pin}`).digest('hex')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const newDeviceToken = () => randomBytes(32).toString('base64url')

/** This browser's device token hash, or null */
export async function deviceTokenHash() {
  const token = (await cookies()).get(TIMECLOCK_COOKIE)?.value
  return token && token.length >= 40 && token.length <= 64 && /^[A-Za-z0-9_-]+$/.test(token) ? hashToken(token) : null
}

export interface TimeClockDevice {
  device_id: string
  device_name: string
  center: { id: string; name: string; timezone: string; today: string; roster: boolean; full_day_hours: number }
}

/** The Time Clock this browser is, or null (not registered, removed, module off) */
export async function loadDevice(tokenHash: string | null): Promise<TimeClockDevice | null> {
  if (!tokenHash) return null
  const { data, error } = await timeclockDb().rpc('timeclock_device', { p_token_hash: tokenHash })
  if (error) throw new Error(`timeclock_device: ${error.message}`)
  return (data as TimeClockDevice | null) ?? null
}

export interface ClockPerson {
  center_staff_id: string
  first_name: string
  name: string
  avatar_url: string | null
  /** a 5-minute link to their profile photo, when they have one */
  photo_url?: string | null
  clocked_in_at: string | null
  missed: boolean
  today_minutes: number
  room: boolean
  pto: PtoBalance | null
  requests: TimeOff[]
}

export type ClockAuthFailure =
  | { status: 'invalid'; left: number }
  | { status: 'locked' | 'paused'; retry_after: number }
  | { status: 'no_device' }

/** The person with a short-lived link to their profile photo (keys under avatars/ in the employee bucket only) */
export async function withPhoto(person: ClockPerson): Promise<ClockPerson> {
  const key = person.avatar_url
  const bucket = process.env.R2_EMPLOYEE_BUCKET
  let photo_url: string | null = null
  if (bucket && key && key.startsWith('avatars/') && !key.includes('..')) {
    try {
      photo_url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 })
    } catch {
      photo_url = null
    }
  }
  return { ...person, avatar_url: null, photo_url }
}

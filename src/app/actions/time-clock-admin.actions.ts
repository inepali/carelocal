'use server'

import { randomInt } from 'node:crypto'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { normalizeTimePin, timePinFromNumber, weakTimePinReason } from '@/lib/timeclock'
import { TIMECLOCK_COOKIE, TIMECLOCK_COOKIE_MAX_AGE, hashTimePin, hashToken, newDeviceToken } from '@/lib/server/timeclock'

/**
 * Owners and admins: Time Card PINs and Time Clock tablets. The database checks the caller (timeclock_* functions,
 * run with the caller's own session). Everything else on the admin page calls those functions directly.
 */

type Fail = { success: false; error: string }
const fail = (error: { message?: string } | null | undefined, fallback = 'Something went wrong.'): Fail =>
  ({ success: false, error: error?.message?.replace(/^.*?ERROR:\s*/, '') || fallback })

/**
 * Set an employee's 4-digit Time Card PIN: the one the admin typed, or a random one. Returned once, never stored
 * in plain text. The old PIN stops working right away.
 */
export async function setTimeCardPin(centerId: string, centerStaffId: string, typedPin?: string | null): Promise<{ success: true; pin: string } | Fail> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail(null, 'Please sign in again.')

  let chosen: string | null = null
  if (typedPin != null && typedPin !== '') {
    chosen = normalizeTimePin(typedPin)
    if (!chosen) return fail(null, 'A Time Card PIN has exactly 4 digits.')
    const weak = weakTimePinReason(chosen)
    if (weak) return fail(null, weak)
  }

  // A picked PIN someone else here already has is simply picked again
  for (let attempt = 0; attempt < (chosen ? 1 : 12); attempt++) {
    let pin = chosen
    while (!pin) {
      const next = timePinFromNumber(randomInt(0, 10_000))
      if (!weakTimePinReason(next)) pin = next
    }
    const { error } = await supabase.rpc('timeclock_pin_set', {
      p_center_id: centerId, p_center_staff_id: centerStaffId, p_pin_hash: hashTimePin(centerId, pin),
    })
    if (error?.code === '23505' && !chosen) continue
    if (error) return fail(error, 'Could not save the PIN.')
    console.warn(`[timeclock] ${user.id} set a Time Card PIN (${chosen ? 'typed' : 'picked'}) for ${centerStaffId} at center ${centerId}`)
    return { success: true, pin }
  }
  return fail(null, 'Could not pick a free PIN. Please type one.')
}

/**
 * Turn this browser into the center's Time Clock. The admin is signed out of this browser right after, so the
 * tablet never stays signed in to an admin account; it then works with PINs only.
 */
export async function registerTimeClockDevice(centerId: string, name: string): Promise<{ success: true } | Fail> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail(null, 'Please sign in again.')
  const token = newDeviceToken()
  const { error } = await supabase.rpc('timeclock_device_register', {
    p_center_id: centerId, p_token_hash: hashToken(token), p_name: (name ?? '').slice(0, 60),
  })
  if (error) return fail(error, 'Could not set up this tablet.')
  const jar = await cookies()
  jar.set(TIMECLOCK_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: TIMECLOCK_COOKIE_MAX_AGE,
  })
  console.warn(`[timeclock] ${user.id} made a Time Clock tablet "${name}" for center ${centerId}`)
  await supabase.auth.signOut({ scope: 'local' })
  return { success: true }
}

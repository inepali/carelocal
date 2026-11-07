'use server'

import { cookies } from 'next/headers'
import { normalizeCenterKey, normalizePin } from '@/lib/parent-code'
import {
  PARENT_CENTER_COOKIE, PARENT_COOKIE, PARENT_COOKIE_MAX_AGE, clientIp, hashIp, hashPin, hashToken, linkHash, loadPortalCenter, newSessionToken,
  parentDb, parentTokenHash, userAgent,
} from '@/lib/server/parent-portal'
import { sendParentMessageNow } from '@/lib/server/parent-message-send'

/**
 * Parent portal sign-in (no account): the parent opens their center's link (/parent/<key>) and types the
 * 6-digit PIN the center gave them. parent_login() checks it, applies the limits (5 wrong PINs per IP per
 * 15 minutes; 20 per center per hour) and starts a session for this device. The answer never says whether a
 * PIN exists, only that it did not work.
 */
export type SignInResult =
  | { ok: true }
  | { ok: false; error: string; retryAfter?: number }

export async function parentSignIn(centerKey: string, input: string): Promise<SignInResult> {
  const key = normalizeCenterKey(centerKey)
  const pin = normalizePin(typeof input === 'string' ? input.slice(0, 20) : '')
  if (!key) return { ok: false, error: 'This link is not right. Open the link from your center’s email or card.' }
  if (!pin) return { ok: false, error: 'Your PIN has 6 digits.' }
  try {
    const center = await loadPortalCenter(key)
    if (!center) return { ok: false, error: 'This link is not working. Please check with your center.' }
    const token = newSessionToken()
    const { data, error } = await parentDb().rpc('parent_login', {
      p_center_id: center.id,
      p_code_hash: hashPin(center.id, pin),
      p_ip_hash: hashIp(await clientIp()),
      p_token_hash: hashToken(token),
      p_user_agent: await userAgent(),
    })
    if (error) throw new Error(error.message)
    const result = data as
      | { status: 'ok' }
      | { status: 'invalid'; left: number }
      | { status: 'rate_limited' | 'center_paused'; retry_after: number }

    if (result.status === 'rate_limited') {
      const minutes = Math.max(1, Math.ceil(result.retry_after / 60))
      return { ok: false, retryAfter: result.retry_after, error: `Too many tries. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.` }
    }
    if (result.status === 'center_paused') {
      return { ok: false, retryAfter: result.retry_after, error: `Sign-in is paused for a while after many wrong PINs. Please try again in an hour, or call ${center.name}.` }
    }
    if (result.status === 'invalid') {
      return {
        ok: false,
        error: result.left > 0
          ? 'That PIN did not work. Check it with your center and try again.'
          : 'That PIN did not work. Please wait 15 minutes before trying again.',
      }
    }

    const jar = await cookies()
    const secure = process.env.NODE_ENV === 'production'
    jar.set(PARENT_COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: '/parent', maxAge: PARENT_COOKIE_MAX_AGE })
    jar.set(PARENT_CENTER_COOKIE, center.key, { httpOnly: true, secure, sameSite: 'lax', path: '/parent', maxAge: PARENT_COOKIE_MAX_AGE })
    return { ok: true }
  } catch (e) {
    console.error('[parent-portal] sign-in failed:', e)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }
}

/** Sign this device out (the session row is deleted, so the cookie is useless even if copied) */
export async function parentSignOut() {
  const tokenHash = await parentTokenHash()
  if (tokenHash) {
    await parentDb().rpc('parent_logout', { p_token_hash: tokenHash }).then(({ error }) => {
      if (error) console.error('[parent-portal] sign-out failed:', error.message)
    })
  }
  ;(await cookies()).delete({ name: PARENT_COOKIE, path: '/parent' })
}

// ── Messages ──────────────────────────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The device session, or the email link the page was opened with (the link only reaches its own conversation) */
async function actor(link: string | null | undefined) {
  if (link) {
    const hash = linkHash(link)
    return hash ? { token: null, link: hash } : null
  }
  const token = await parentTokenHash()
  return token ? { token, link: null } : null
}

function friendly(error: { message?: string } | null) {
  const msg = error?.message?.replace(/^.*?ERROR:\s*/, '')
  return msg && msg.length < 200 ? msg : 'Something went wrong. Please try again.'
}

/**
 * A parent writes: a new message about their child (threadId null, needs the PIN) or a reply.
 * The center's owners and admins are copied by email right away; teachers see it on the Live roster.
 */
export async function parentSendMessage(input: {
  link?: string | null
  childId?: string | null
  threadId?: string | null
  subject?: string
  body: string
  key: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const who = await actor(input.link)
    if (!who) return { ok: false, error: 'Please enter your PIN again.' }
    if (!UUID.test(input.key) || (input.threadId && !UUID.test(input.threadId)) || (input.childId && !UUID.test(input.childId))) {
      return { ok: false, error: 'Something went wrong. Please try again.' }
    }
    const { data, error } = await parentDb().rpc('parent_portal_post', {
      p_token_hash: who.token,
      p_link_hash: who.link,
      p_child_id: input.childId ?? null,
      p_thread_id: input.threadId ?? null,
      p_subject: (input.subject ?? '').slice(0, 200),
      p_body: (input.body ?? '').slice(0, 4000),
      p_client_key: input.key,
    })
    if (error || !data) return { ok: false, error: friendly(error) }
    await sendParentMessageNow(data as string).catch(e => console.error('[parent-portal] admin copy failed (cron retries):', e))
    return { ok: true, id: data as string }
  } catch (e) {
    console.error('[parent-portal] send failed:', e)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }
}

/** Acknowledge a message the center sent this parent */
export async function parentAcknowledge(input: { link?: string | null; messageId: string }): Promise<{ ok: boolean }> {
  const who = await actor(input.link)
  if (!who || !UUID.test(input.messageId)) return { ok: false }
  const { data, error } = await parentDb().rpc('parent_portal_ack', { p_token_hash: who.token, p_link_hash: who.link, p_message_id: input.messageId })
  if (error) console.error('[parent-portal] acknowledge failed:', error.message)
  return { ok: data === true }
}

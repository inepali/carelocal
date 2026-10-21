import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import webpush from 'web-push'
import { JWT } from 'google-auth-library'

/**
 * Delivers a notification to users over every channel they allow:
 * in-app (app_notifications), web push, native push (FCM) and email.
 * Mirrors the delivery used for shift alerts in /api/notifications.
 * Server-only (service role key): import it only from server actions / route handlers.
 */
export interface NotifyPayload {
  title: string
  message: string
  type: string            // e.g. 'document_request'
  referenceId?: string
  url: string             // path inside the app, e.g. /staff/requests
  emailCta?: string       // button label in the email
}

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

let vapidReady = false
function ensureVapid() {
  if (vapidReady || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return vapidReady
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@carelocal.co',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  )
  vapidReady = true
  return vapidReady
}

let fcm: { jwt: JWT; projectId: string } | null | undefined
function getFcm() {
  if (fcm !== undefined) return fcm
  fcm = null
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      fcm = {
        projectId: creds.project_id,
        jwt: new JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] }),
      }
    } catch (err) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT:', err)
    }
  }
  return fcm
}

export function siteForDomain(domainKey: string | null | undefined) {
  const key = domainKey || 'childcare'
  const senderName = key === 'healthcare' ? 'CareLocal Health' : key === 'senior' ? 'CareLocal Senior' : 'CareLocal'
  const senderEmail = key === 'healthcare' ? 'updates@carelocal.net' : key === 'senior' ? 'updates@carelocalsenior.com' : 'updates@carelocal.co'
  let appUrl = key === 'healthcare' ? 'https://carelocal.net' : key === 'senior' ? 'https://carelocalsenior.com' : 'https://carelocal.co'
  if (process.env.NEXT_PUBLIC_APP_URL?.includes('localhost')) {
    appUrl = key === 'healthcare' ? 'http://localhost:3001' : key === 'senior' ? 'http://localhost:3002' : 'http://localhost:3000'
  }
  return { senderName, senderEmail, appUrl }
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/** One transactional email from the site's sender (does nothing when email is not configured). */
export async function sendEmail({ to, subject, html, domainKey, replyTo }: { to: string; subject: string; html: string; domainKey?: string | null; replyTo?: string }) {
  if (!process.env.RESEND_API_KEY) return false
  const site = siteForDomain(domainKey)
  try {
    await new Resend(process.env.RESEND_API_KEY).emails.send({ from: `${site.senderName} <${site.senderEmail}>`, to, subject, html, ...(replyTo ? { replyTo } : {}) })
    return true
  } catch (err) {
    console.error(`Email failed for ${to}:`, err)
    return false
  }
}

export async function notifyUsers(userIds: string[], payload: NotifyPayload, domainKey?: string | null) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return

  const supabase = admin()
  const site = siteForDomain(domainKey)
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

  const [{ data: prefs }, { data: subs }, { data: tokens }] = await Promise.all([
    supabase.from('notification_preferences').select('*').in('user_id', ids),
    supabase.from('push_subscriptions').select('*').in('user_id', ids),
    supabase.from('native_push_tokens').select('*').in('user_id', ids),
  ])
  const prefMap = new Map((prefs || []).map(p => [p.user_id, p]))

  for (const userId of ids) {
    const pref = prefMap.get(userId) || { app_enabled: true, email_enabled: true }

    if (pref.app_enabled !== false) {
      const { error } = await supabase.from('app_notifications').insert({
        user_id: userId, title: payload.title, message: payload.message, type: payload.type, reference_id: payload.referenceId ?? null,
      })
      if (error) console.error('app_notifications insert failed:', error)

      // Web push (PWA)
      if (ensureVapid()) {
        for (const sub of (subs || []).filter(s => s.user_id === userId)) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({ title: payload.title, body: payload.message, url: payload.url }),
              { headers: { Urgency: 'high' }, TTL: 24 * 60 * 60 },
            )
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode
            if (status === 404 || status === 410) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
            else console.error('Web push failed:', err)
          }
        }
      }

      // Native push (Capacitor via FCM)
      const fcmClient = getFcm()
      const userTokens = (tokens || []).filter(t => t.user_id === userId)
      if (fcmClient && userTokens.length > 0) {
        const { token: accessToken } = await fcmClient.jwt.getAccessToken()
        for (const t of userTokens) {
          try {
            const res = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmClient.projectId}/messages:send`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: {
                  token: t.token,
                  notification: { title: payload.title, body: payload.message },
                  data: { url: payload.url },
                  android: { notification: { sound: 'default' } },
                  apns: { payload: { aps: { sound: 'default', alert: { title: payload.title, body: payload.message } } } },
                },
              }),
            })
            if (res.status === 404 || res.status === 410) await supabase.from('native_push_tokens').delete().eq('token', t.token)
          } catch (err) {
            console.error('FCM send failed:', err)
          }
        }
      }
    }

    if (pref.email_enabled !== false && resend) {
      const { data: userData } = await supabase.auth.admin.getUserById(userId)
      const email = userData?.user?.email
      if (email) {
        try {
          await resend.emails.send({
            from: `${site.senderName} <${site.senderEmail}>`,
            to: email,
            subject: payload.title,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>${escapeHtml(payload.title)}</h2>
                <p>${escapeHtml(payload.message)}</p>
                <a href="${site.appUrl}${payload.url}" style="display: inline-block; padding: 12px 24px; background-color: #157354; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 16px;">${escapeHtml(payload.emailCta || 'Open CareLocal')}</a>
              </div>`,
          })
        } catch (err) {
          console.error(`Email failed for ${email}:`, err)
        }
      }
    }
  }
}

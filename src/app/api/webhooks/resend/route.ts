import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Resend webhook: delivered / bounced / complained for emails we sent. Today it updates announcement deliveries
 * (announcement_delivery_event); other emails are ignored. Resend signs each call the Svix way:
 * base64(HMAC-SHA256(secret, "<svix-id>.<svix-timestamp>.<raw body>")), secret = RESEND_WEBHOOK_SECRET ("whsec_…").
 * Calls older than 5 minutes or with a bad signature are refused.
 *
 * Set up in Resend: Webhooks → endpoint https://<site>/api/webhooks/resend, events email.delivered,
 * email.bounced, email.complained; copy its signing secret into RESEND_WEBHOOK_SECRET (each environment).
 */
const EVENTS: Record<string, 'delivered' | 'bounced' | 'complained'> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}

function verified(secret: string, id: string | null, timestamp: string | null, signatures: string | null, body: string) {
  if (!id || !timestamp || !signatures) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 5 * 60) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()
  return signatures.split(' ').some(part => {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) return false
    const given = Buffer.from(sig, 'base64')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  const body = await request.text()
  if (!verified(secret, request.headers.get('svix-id'), request.headers.get('svix-timestamp'), request.headers.get('svix-signature'), body)) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 })
  }

  let event: { type?: string; data?: { email_id?: string } }
  try { event = JSON.parse(body) } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }) }
  const kind = event.type ? EVENTS[event.type] : undefined
  const emailId = event.data?.email_id
  if (!kind || !emailId) return NextResponse.json({ ignored: true })

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data, error } = await db.rpc('announcement_delivery_event', { p_provider_id: emailId, p_event: kind })
  if (error) {
    // Resend retries on a 5xx
    console.error('[resend-webhook] update failed:', error.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
  return NextResponse.json({ matched: data === true })
}

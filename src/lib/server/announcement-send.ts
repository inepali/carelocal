import { createHash, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { reportSenderName } from '@/lib/daily-report'
import { escapeHtml, siteForDomain } from '@/lib/server/notify'

/**
 * Sends center announcements by email (server only, service role).
 *
 * The database decides who gets what: announcement_claim() marks each delivery as tried and locks it, so two runs
 * never send the same email twice, and announcement_delivery_result() records each answer. Emails go out through
 * Resend's batch endpoint (up to 100 per call), one email per person, from "<center> via CareLocal", with replies
 * going to the center's email. Each email carries its own link (/a/<token>, 30 days) that opens only that
 * announcement; a new token on every attempt. Anything not sent is retried by the cron run 10 minutes later, up
 * to 3 tries in all.
 */

type Claimed = {
  delivery_id: string
  recipient_id: string
  announcement_id: string
  center_id: string
  channel: 'email' | 'groupme' | 'sms'
  kind: 'parent' | 'staff'
  name: string
  email: string
  subject: string
  body: string
  urgent: boolean
  requires_ack: boolean
  sender_label: string
  center_name: string
  center_email: string | null
  center_domain: string | null
  attempts: number
}

export interface AnnouncementEmailInput {
  subject: string
  body: string
  urgent: boolean
  requires_ack: boolean
  sender_label: string
  center_name: string
  center_email: string | null
  kind: 'parent' | 'staff'
}

const BATCH = 100

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

const LINK_BUTTON = (href: string, label: string) =>
  `<p style="margin:4px 0 16px"><a href="${escapeHtml(href)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">${escapeHtml(label)}</a></p>`

/** The email. link: this person's own link to the announcement (none for a test send). */
export function buildAnnouncementEmail(a: AnnouncementEmailInput, link: string | null, opts: { test?: boolean } = {}) {
  const center = a.center_name
  const prefix = `${opts.test ? '[Test] ' : ''}${a.urgent ? 'Urgent: ' : ''}`
  const subject = `${prefix}${a.subject} · ${center}`.replace(/[\r\n]+/g, ' ').slice(0, 200)
  const paragraphs = a.body.trim().split(/\n{2,}/).map(p => escapeHtml(p).replace(/\n/g, '<br>'))
  const buttonLabel = a.requires_ack ? 'Read and acknowledge' : 'Open in CareLocal'
  const replyLine = a.center_email
    ? 'Reply to this email to reach the center.'
    : ''
  const audienceLine = a.kind === 'staff' ? `Sent to staff at ${center}.` : `Sent to families at ${center}.`
  const footer = [
    opts.test ? 'This is a test only you received. The real email has a button that opens the announcement.' : null,
    `From ${a.sender_label}. ${audienceLine} Sent with CareLocal.`,
    replyLine || null,
    link ? 'The button opens only this announcement and works for 30 days.' : null,
  ].filter(Boolean).join(' ')

  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16202a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
${a.urgent ? '<tr><td style="background:#b42318;color:#ffffff;font-size:13px;font-weight:700;padding:8px 24px;letter-spacing:.04em">URGENT</td></tr>' : ''}
<tr><td style="padding:24px 24px 8px">
<p style="margin:0;font-size:13px;color:#5b6773">${escapeHtml(center)} · Announcement</p>
<h1 style="margin:6px 0 4px;font-size:22px;line-height:1.3">${escapeHtml(a.subject)}</h1>
</td></tr>
<tr><td style="padding:8px 24px 0">${paragraphs.map(p => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${p}</p>`).join('')}</td></tr>
${link ? `<tr><td style="padding:4px 24px 0">${LINK_BUTTON(link, buttonLabel)}</td></tr>` : ''}
<tr><td style="padding:12px 24px 24px"><p style="margin:0;font-size:12px;color:#5b6773">${escapeHtml(footer)}</p></td></tr>
</table></td></tr></table></body></html>`

  const text = [
    a.urgent ? 'URGENT' : null,
    a.subject, '', a.body.trim(), '',
    link ? `${buttonLabel}: ${link}` : null,
    link ? '' : null,
    footer,
  ].filter(l => l !== null).join('\n')
  return { subject, html, text }
}

const newToken = () => randomBytes(32).toString('base64url')
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

/** Resend's batch answer is { data: { data: [{ id }] } } in recent SDKs and { data: [{ id }] } in older ones */
function batchIds(data: unknown): (string | null)[] {
  const list = Array.isArray(data) ? data : (data as { data?: unknown } | null)?.data
  return Array.isArray(list) ? list.map(x => (x as { id?: string } | null)?.id ?? null) : []
}

async function sendClaimed(supabase: ReturnType<typeof admin>, resend: Resend, rows: Claimed[]) {
  const summary = { sent: 0, failed: 0 }
  const email = rows.filter(r => r.channel === 'email')
  // Not yet sendable on this channel: leave a clear reason (the database fails it after 3 tries)
  for (const r of rows.filter(r => r.channel !== 'email')) {
    summary.failed++
    await supabase.rpc('announcement_delivery_result', { p_delivery_id: r.delivery_id, p_ok: false, p_error: `${r.channel} is not available yet` })
  }

  for (let i = 0; i < email.length; i += BATCH) {
    const chunk = email.slice(i, i + BATCH).map(row => {
      const token = newToken()
      const site = siteForDomain(row.center_domain)
      return { row, hash: tokenHash(token), site, built: buildAnnouncementEmail(row, `${site.appUrl}/a/${token}`) }
    })
    const res = await resend.batch.send(chunk.map(({ row, site, built }) => ({
      from: `${reportSenderName(row.center_name)} <${site.senderEmail}>`,
      to: row.email,
      subject: built.subject,
      html: built.html,
      text: built.text,
      ...(row.center_email ? { replyTo: row.center_email } : {}),
      headers: { 'X-Entity-Ref-ID': `announcement-${row.delivery_id}` },
    }))).catch((e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }))

    const ids = res.error ? [] : batchIds(res.data)
    for (const [n, { row, hash }] of chunk.entries()) {
      const ok = !res.error && ids.length === chunk.length
      const { error } = await supabase.rpc('announcement_delivery_result', ok
        ? { p_delivery_id: row.delivery_id, p_ok: true, p_provider_id: ids[n], p_error: null, p_token_hash: hash }
        : { p_delivery_id: row.delivery_id, p_ok: false, p_provider_id: null, p_error: res.error?.message ?? 'Unexpected batch answer', p_token_hash: null })
      if (error) console.error(`[announcement] recording delivery ${row.delivery_id} failed:`, error.message)
      if (ok) summary.sent++
      else summary.failed++
    }
    if (res.error) console.error(`[announcement] batch of ${chunk.length} failed:`, res.error.message)
  }
  return summary
}

/** Right after Send: every delivery of this announcement, in rounds of up to 500. */
export async function sendAnnouncementNow(announcementId: string) {
  if (!process.env.RESEND_API_KEY) {
    console.error('[announcement] RESEND_API_KEY is not set; left for the retry')
    return { sent: 0, failed: 0, error: 'Email is not configured' }
  }
  const supabase = admin()
  const resend = new Resend(process.env.RESEND_API_KEY)
  const total = { sent: 0, failed: 0 }
  // An announcement holds at most 2,000 people; the guard stops a loop if a claim ever keeps answering
  for (let round = 0; round < 5; round++) {
    const { data, error } = await supabase.rpc('announcement_claim', { p_announcement_id: announcementId, p_limit: 500 })
    if (error) throw new Error(`claim failed: ${error.message}`)
    const rows = (data ?? []) as Claimed[]
    if (rows.length === 0) break
    const s = await sendClaimed(supabase, resend, rows)
    total.sent += s.sent
    total.failed += s.failed
  }
  return total
}

/** The cron retry: anything still unsent 10 minutes after its last try (and the cleanup of what gave up) */
export async function sendDueAnnouncements(limit = 200) {
  if (!process.env.RESEND_API_KEY) return { claimed: 0, sent: 0, failed: 0, error: 'Email is not configured' }
  const supabase = admin()
  const { data, error } = await supabase.rpc('announcement_claim', { p_announcement_id: null, p_limit: limit })
  if (error) throw new Error(`claim failed: ${error.message}`)
  const rows = (data ?? []) as Claimed[]
  return { claimed: rows.length, ...(await sendClaimed(supabase, new Resend(process.env.RESEND_API_KEY), rows)) }
}

/** A test copy to the person writing it, before they send to everyone. Nothing is recorded. */
export async function sendAnnouncementTestEmail(to: string, input: AnnouncementEmailInput & { center_domain: string | null }) {
  if (!process.env.RESEND_API_KEY) return { ok: false as const, error: 'Email is not configured.' }
  const site = siteForDomain(input.center_domain)
  const built = buildAnnouncementEmail(input, null, { test: true })
  const res = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: `${reportSenderName(input.center_name)} <${site.senderEmail}>`,
    to,
    subject: built.subject,
    html: built.html,
    text: built.text,
  }).catch((e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }))
  if (res.error) {
    console.error('[announcement] test send failed:', res.error.message)
    return { ok: false as const, error: 'Could not send the test email.' }
  }
  return { ok: true as const }
}

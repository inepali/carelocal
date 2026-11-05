import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { reportSenderName } from '@/lib/daily-report'
import { escapeHtml, siteForDomain } from '@/lib/server/notify'

/**
 * Sends parent messages by email (server only, service role).
 *
 * The database decides who gets what (parent_message_claim marks each recipient as tried, so two runs never send
 * the same email twice) and records each result (parent_message_recipient_finish). Each address gets its own email,
 * from "<center> via CareLocal", replies going to the center's email. Anything not sent is retried by the cron
 * run (sendDueParentMessages) 10 minutes later, up to 3 tries in all.
 */

interface MessageData {
  id: string
  subject: string
  body: string
  sender_label: string
  child: { first_name: string }
  center: { name: string; email: string | null; phone: string | null; domain_key: string | null }
}

type Claimed = { recipient_id: string; message_id: string; name: string; email: string }

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

export function buildParentMessageEmail(m: MessageData) {
  const center = m.center.name
  const child = m.child.first_name
  const subject = `${m.subject} · ${child} at ${center}`.replace(/[\r\n]+/g, ' ').slice(0, 200)
  const replyLine = m.center.email ? 'Reply to this email to reach the center.' : m.center.phone ? `Questions? Call the center at ${m.center.phone}.` : ''
  const from = `From ${m.sender_label} at ${center}, about ${child}.`
  const paragraphs = m.body.trim().split(/\n{2,}/).map(p => escapeHtml(p).replace(/\n/g, '<br>'))

  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16202a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="padding:24px 24px 8px">
<p style="margin:0;font-size:13px;color:#5b6773">${escapeHtml(center)} · A note about ${escapeHtml(child)}</p>
<h1 style="margin:6px 0 4px;font-size:22px;line-height:1.3">${escapeHtml(m.subject)}</h1>
</td></tr>
<tr><td style="padding:8px 24px 0">${paragraphs.map(p => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${p}</p>`).join('')}</td></tr>
<tr><td style="padding:12px 24px 24px"><p style="margin:0;font-size:12px;color:#5b6773">${escapeHtml(from)} Sent with CareLocal. ${escapeHtml(replyLine)}</p></td></tr>
</table></td></tr></table></body></html>`

  const text = [m.subject, '', m.body.trim(), '', `${from} Sent with CareLocal. ${replyLine}`.trim()].join('\n')
  return { subject, html, text }
}

async function sendClaimed(supabase: ReturnType<typeof admin>, resend: Resend, rows: Claimed[]) {
  const summary = { sent: 0, failed: 0 }
  const cache = new Map<string, MessageData | null>()
  for (const row of rows) {
    try {
      if (!cache.has(row.message_id)) {
        const { data, error } = await supabase.rpc('parent_message_data', { p_message_id: row.message_id })
        if (error) throw new Error(error.message)
        cache.set(row.message_id, (data as MessageData | null) ?? null)
      }
      const message = cache.get(row.message_id)
      if (!message) throw new Error('message not found')
      const email = buildParentMessageEmail(message)
      const site = siteForDomain(message.center.domain_key)
      const res = await resend.emails.send({
        from: `${reportSenderName(message.center.name)} <${site.senderEmail}>`,
        to: row.email,
        subject: email.subject, html: email.html, text: email.text,
        ...(message.center.email ? { replyTo: message.center.email } : {}),
        headers: { 'X-Entity-Ref-ID': `parent-message-${row.recipient_id}` },
      }).catch((e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }))
      if (res.error) throw new Error(res.error.message)
      await supabase.rpc('parent_message_recipient_finish', { p_recipient_id: row.recipient_id, p_ok: true, p_provider_id: res.data?.id ?? null, p_error: null })
      summary.sent++
    } catch (e) {
      summary.failed++
      console.error(`[parent-message] recipient ${row.recipient_id} failed:`, e)
      await supabase.rpc('parent_message_recipient_finish', {
        p_recipient_id: row.recipient_id, p_ok: false, p_provider_id: null, p_error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return summary
}

/** Right after Send: this message's recipients. Returns how many were sent and how many failed (for now). */
export async function sendParentMessageNow(messageId: string) {
  if (!process.env.RESEND_API_KEY) {
    console.error('[parent-message] RESEND_API_KEY is not set; left for the retry')
    return { sent: 0, failed: 0, error: 'Email is not configured' }
  }
  const supabase = admin()
  const { data, error } = await supabase.rpc('parent_message_claim', { p_message_id: messageId, p_limit: 20 })
  if (error) throw new Error(`claim failed: ${error.message}`)
  return sendClaimed(supabase, new Resend(process.env.RESEND_API_KEY), (data ?? []) as Claimed[])
}

/** The cron retry: anything still unsent 10 minutes after its last try */
export async function sendDueParentMessages(limit = 50) {
  if (!process.env.RESEND_API_KEY) return { claimed: 0, sent: 0, failed: 0, error: 'Email is not configured' }
  const supabase = admin()
  const { data, error } = await supabase.rpc('parent_message_claim', { p_message_id: null, p_limit: limit })
  if (error) throw new Error(`claim failed: ${error.message}`)
  const rows = (data ?? []) as Claimed[]
  return { claimed: rows.length, ...(await sendClaimed(supabase, new Resend(process.env.RESEND_API_KEY), rows)) }
}

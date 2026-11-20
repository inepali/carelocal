import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { reportSenderName } from '@/lib/daily-report'
import { escapeHtml, siteForDomain } from '@/lib/server/notify'

/**
 * Bill emails to families (server only, service role). See 20270122000000_parent_billing.sql.
 *
 * Submitting a billing run lists one email per person who pays (billing_notices); voiding it lists a "bill canceled"
 * email for each person already told. billing_notice_claim() hands out the rows to send (marked as tried and locked,
 * so two runs never send the same email twice) with what each email says, and billing_notice_result() records each
 * answer. Anything not sent is retried by the cron run 10 minutes later, up to 3 tries.
 *
 * Each email shows only that person's own share. The button opens the Billing tab on the center's parent page, which
 * asks for the parent's PIN. No amounts in the subject line.
 */

export interface BillingNotice {
  notice_id: string
  kind: 'bill' | 'void'
  email: string
  name: string | null
  attempts: number
  center: { name: string; email: string | null; phone: string | null; domain_key: string | null; portal_key: string | null }
  has_pin: boolean
  run: { frequency: 'weekly' | 'monthly'; period_start: string; period_end: string; draft_date: string | null }
  lines: {
    child: string; bill_total: number; share: number; ach: number; due: number; paid: number
    last4: string | null; account_type: 'checking' | 'savings' | null; draft_date: string | null
  }[]
}

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)
const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts })

/** "the week of Nov 24" or "November 2026" */
export function billPeriod(run: BillingNotice['run']) {
  return run.frequency === 'monthly'
    ? day(run.period_start, { month: 'long', year: 'numeric' })
    : `the week of ${day(run.period_start, { month: 'short', day: 'numeric' })}`
}

/** How one child's share is paid, in a short sentence */
export function howPaid(l: BillingNotice['lines'][number]) {
  const parts: string[] = []
  if (l.ach > 0) {
    const acct = l.last4 ? `${l.account_type === 'savings' ? 'Savings' : 'Checking'} ••${l.last4}` : 'your bank account'
    const when = l.draft_date ? ` on ${day(l.draft_date, { weekday: 'short', month: 'short', day: 'numeric' })}` : ''
    parts.push(`${usd(l.ach)} by ACH draft${when} from ${acct}`)
  }
  const fromCredit = Math.max(Number(l.share) - Number(l.ach) - Number(l.due), 0)
  if (fromCredit >= 0.01) parts.push(`${usd(fromCredit)} paid from your credit`)
  if (l.due >= 0.01) parts.push(`${usd(l.due)} to pay at the center`)
  return parts.join(' · ') || 'Nothing to pay'
}

const BUTTON = (href: string, label: string) =>
  `<p style="margin:8px 0 16px"><a href="${escapeHtml(href)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">${escapeHtml(label)}</a></p>`

export function buildBillingEmail(n: BillingNotice) {
  const center = n.center.name
  const period = billPeriod(n.run)
  const first = n.name?.trim().split(/\s+/)[0]
  const site = siteForDomain(n.center.domain_key)
  const link = n.center.portal_key ? `${site.appUrl}/parent/${n.center.portal_key}?to=billing` : null
  const contact = [n.center.phone, n.center.email].filter(Boolean).join(' or ')
  const greeting = first ? `Hi ${first},` : 'Hello,'

  if (n.kind === 'void') {
    const subject = `Bill canceled: ${period} · ${center}`.replace(/[\r\n]+/g, ' ').slice(0, 200)
    const body = [
      `${center} canceled the bill for ${period} that we emailed you about. Nothing will be drafted or charged for it.`,
      'If the center sends a corrected bill, you’ll get a new email.',
    ]
    const footer = `Sent by CareLocal for ${center}.${n.center.email ? ' Reply to this email to reach the center.' : ''}`
    const html = shell(center, `Bill canceled: ${period}`, `<p style="margin:0 0 12px;font-size:15px">${escapeHtml(greeting)}</p>${body.map(p => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapeHtml(p)}</p>`).join('')}`, footer)
    return { subject, html, text: [greeting, '', ...body, '', footer].join('\n') }
  }

  const total = n.lines.reduce((t, l) => t + Number(l.share), 0)
  const subject = `Your bill for ${period} · ${center}`.replace(/[\r\n]+/g, ' ').slice(0, 200)
  const rows = n.lines.map(l => {
    const split = Math.abs(Number(l.bill_total) - Number(l.share)) >= 0.01
    return { child: l.child, amount: usd(l.share), note: split ? `Your share of ${usd(l.bill_total)}` : null, how: howPaid(l) }
  })
  const intro = `${center} has billed ${period}. Here is what you pay:`
  const button = link && n.has_pin ? BUTTON(link, 'See your bill') : ''
  const pinLine = link && !n.has_pin ? `Ask ${center} for a parent page PIN to see your bills and payments online.` : null
  const questions = contact ? `Questions about this bill? Contact ${center} at ${contact}.` : `Questions about this bill? Contact ${center}.`
  const footer = `Sent by CareLocal for ${center}.${n.center.email ? ' Reply to this email to reach the center.' : ''}${button ? ' The button opens your parent page; you may need your PIN.' : ''}`

  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 12px">
${rows.map(r => `<tr><td style="padding:10px 0;border-top:1px solid #e5e9ee;font-size:15px;vertical-align:top"><b>${escapeHtml(r.child)}</b>${r.note ? `<br><span style="font-size:12px;color:#5b6773">${escapeHtml(r.note)}</span>` : ''}<br><span style="font-size:13px;color:#5b6773">${escapeHtml(r.how)}</span></td><td style="padding:10px 0;border-top:1px solid #e5e9ee;font-size:15px;text-align:right;vertical-align:top;white-space:nowrap">${escapeHtml(r.amount)}</td></tr>`).join('\n')}
<tr><td style="padding:10px 0;border-top:2px solid #16202a;font-size:15px;font-weight:700">Total</td><td style="padding:10px 0;border-top:2px solid #16202a;font-size:15px;font-weight:700;text-align:right">${escapeHtml(usd(total))}</td></tr>
</table>`
  const inner = `<p style="margin:0 0 12px;font-size:15px">${escapeHtml(greeting)}</p>
<p style="margin:0 0 8px;font-size:15px;line-height:1.5">${escapeHtml(intro)}</p>${table}${button}
${pinLine ? `<p style="margin:0 0 12px;font-size:14px;color:#5b6773">${escapeHtml(pinLine)}</p>` : ''}
<p style="margin:0 0 4px;font-size:14px;color:#5b6773">${escapeHtml(questions)}</p>`
  const html = shell(center, `Your bill for ${period}`, inner, footer)
  const text = [
    greeting, '', intro, '',
    ...rows.flatMap(r => [`${r.child}: ${r.amount}${r.note ? ` (${r.note})` : ''}`, `  ${r.how}`]),
    `Total: ${usd(total)}`, '',
    button && link ? `See your bill: ${link}` : null,
    pinLine, questions, '', footer,
  ].filter(l => l !== null).join('\n')
  return { subject, html, text }
}

function shell(center: string, heading: string, inner: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16202a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="padding:24px 24px 8px"><p style="margin:0;font-size:13px;color:#5b6773">${escapeHtml(center)} · Billing</p>
<h1 style="margin:6px 0 4px;font-size:22px;line-height:1.3">${escapeHtml(heading)}</h1></td></tr>
<tr><td style="padding:8px 24px 0">${inner}</td></tr>
<tr><td style="padding:12px 24px 24px"><p style="margin:0;font-size:12px;color:#5b6773">${escapeHtml(footer)}</p></td></tr>
</table></td></tr></table></body></html>`
}

async function sendClaimed(supabase: ReturnType<typeof admin>, resend: Resend, rows: BillingNotice[]) {
  const summary = { sent: 0, failed: 0 }
  for (const n of rows) {
    const built = buildBillingEmail(n)
    const site = siteForDomain(n.center.domain_key)
    const res = await resend.emails.send({
      from: `${reportSenderName(n.center.name)} <${site.senderEmail}>`,
      to: n.email,
      subject: built.subject,
      html: built.html,
      text: built.text,
      ...(n.center.email ? { replyTo: n.center.email } : {}),
      headers: { 'X-Entity-Ref-ID': `billing-${n.notice_id}` },
    }).catch((e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }))
    const ok = !res.error
    const { error } = await supabase.rpc('billing_notice_result', {
      p_notice_id: n.notice_id, p_ok: ok, p_provider_id: ok ? (res.data as { id?: string } | null)?.id ?? null : null,
      p_error: ok ? null : res.error?.message ?? 'Not sent',
    })
    if (error) console.error(`[billing-notice] recording ${n.notice_id} failed:`, error.message)
    if (ok) summary.sent++
    else { summary.failed++; console.error(`[billing-notice] ${n.notice_id} not sent:`, res.error?.message) }
  }
  return summary
}

/** Right after Submit Billing or Void: this run's new emails */
export async function sendBillingNoticesNow(runId: string) {
  if (!process.env.RESEND_API_KEY) {
    console.error('[billing-notice] RESEND_API_KEY is not set; left for the retry')
    return { sent: 0, failed: 0, error: 'Email is not configured' }
  }
  const supabase = admin()
  const resend = new Resend(process.env.RESEND_API_KEY)
  const total = { sent: 0, failed: 0 }
  for (let round = 0; round < 10; round++) {
    const { data, error } = await supabase.rpc('billing_notice_claim', { p_run_id: runId, p_limit: 100 })
    if (error) throw new Error(`claim failed: ${error.message}`)
    const rows = (data ?? []) as BillingNotice[]
    if (rows.length === 0) break
    const s = await sendClaimed(supabase, resend, rows)
    total.sent += s.sent
    total.failed += s.failed
  }
  return total
}

/** The cron retry: anything not sent 10 minutes after its last try, up to 3 tries */
export async function sendDueBillingNotices(limit = 100) {
  if (!process.env.RESEND_API_KEY) return { claimed: 0, sent: 0, failed: 0, error: 'Email is not configured' }
  const supabase = admin()
  const { data, error } = await supabase.rpc('billing_notice_claim', { p_run_id: null, p_limit: limit })
  if (error) throw new Error(`claim failed: ${error.message}`)
  const rows = (data ?? []) as BillingNotice[]
  return { claimed: rows.length, ...(await sendClaimed(supabase, new Resend(process.env.RESEND_API_KEY), rows)) }
}

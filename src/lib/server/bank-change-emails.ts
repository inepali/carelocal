import { escapeHtml, sendEmail } from '@/lib/server/notify'

/**
 * Emails about a parent's bank change request (server only): the parent's confirmation when they send it, and the
 * center's answer. Last 4 only. From CareLocal, replies to the center when it has an email.
 */

type Kind = 'new_account' | 'stop_ach'
const acct = (type: string | null | undefined, last4: string | null | undefined) =>
  last4 ? `${type === 'savings' ? 'Savings' : 'Checking'} ••${last4}` : 'your new account'
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })

function wrap(center: string, heading: string, paragraphs: string[]) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16202a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="padding:24px 24px 8px"><p style="margin:0;font-size:13px;color:#5b6773">${escapeHtml(center)} · Billing</p>
<h1 style="margin:6px 0 4px;font-size:22px;line-height:1.3">${escapeHtml(heading)}</h1></td></tr>
<tr><td style="padding:8px 24px 24px">${paragraphs.map(p => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapeHtml(p)}</p>`).join('')}
<p style="margin:12px 0 0;font-size:12px;color:#5b6773">Sent by CareLocal for ${escapeHtml(center)}. If you didn’t ask for this, contact the center right away.</p></td></tr>
</table></td></tr></table></body></html>`
}

export function bankChangeReceivedEmail(v: { center: string; name: string; kind: Kind; account_type?: string | null; last4?: string | null; old?: string | null }) {
  const first = v.name.trim().split(/\s+/)[0] || 'there'
  const what = v.kind === 'new_account'
    ? `We sent ${v.center} your request to pay by ACH from ${acct(v.account_type, v.last4)}.`
    : `We sent ${v.center} your request to stop ACH drafts and pay at the center.`
  const next = v.kind === 'new_account'
    ? `Nothing changes yet. The center will ask you to sign an authorization form, then switch your drafts to the new account.${v.old ? ` Until then, drafts still come from ${v.old}.` : ''}`
    : 'Nothing changes until the center confirms it. Drafts already scheduled may still go out.'
  return { subject: `We got your bank change request · ${v.center}`, html: wrap(v.center, 'Bank change request sent', [`Hi ${first},`, what, next]) }
}

export function bankChangeDecisionEmail(v: {
  center: string; name: string; kind: Kind; approved: boolean; account_type?: string | null; last4?: string | null
  effective_from?: string | null; reason?: string | null
}) {
  const first = v.name.trim().split(/\s+/)[0] || 'there'
  if (!v.approved) {
    return {
      subject: `Your bank change request · ${v.center}`,
      html: wrap(v.center, 'Bank change not made', [`Hi ${first},`, `${v.center} didn’t make the change you asked for.`,
        v.reason ? `Their note: ${v.reason}` : '', 'Your drafts stay as they were. Contact the center with any questions.'].filter(Boolean)),
    }
  }
  const from = v.effective_from ? day(v.effective_from) : 'the next bill'
  return {
    subject: `Your bank change is done · ${v.center}`,
    html: wrap(v.center, v.kind === 'new_account' ? 'Bank account changed' : 'ACH drafts stopped', [`Hi ${first},`,
      v.kind === 'new_account'
        ? `From ${from}, your ACH drafts come from ${acct(v.account_type, v.last4)}.`
        : `From ${from}, ${v.center} won’t draft your bank account. Pay at the center instead.`,
      'Drafts already scheduled before then still use your old account.']),
  }
}

export async function sendBankChangeEmail(to: string | null | undefined, built: { subject: string; html: string }, domainKey?: string | null, replyTo?: string | null) {
  if (!to) return false
  return sendEmail({ to, subject: built.subject, html: built.html, domainKey, replyTo: replyTo || undefined })
}

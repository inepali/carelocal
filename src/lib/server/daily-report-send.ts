import { createClient } from '@supabase/supabase-js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Resend } from 'resend'
import { r2 } from '@/lib/r2'
import { buildDailyReport, reportSenderName, type ReportData } from '@/lib/daily-report'
import { siteForDomain } from '@/lib/server/notify'

/**
 * Sends the parent daily reports that are due (server only, service role).
 *
 * The database decides what is due (daily_reports_claim: queued about 10 minutes after the final check-out,
 * centers with reports on) and what a report holds (daily_report_data). Each guardian gets their own email, from
 * "<center> via CareLocal", replies going to the center's email. Photo links are signed for 7 days, the longest
 * R2 allows. The result is recorded; a failure is retried in 15 minutes, up to 3 attempts.
 */
const PHOTO_LINK_SECONDS = 7 * 24 * 60 * 60

type Claimed = { id: string; center_id: string; child_id: string; service_date: string; attempts: number }

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function signPhotos(data: ReportData) {
  const bucket = process.env.R2_CHILD_BUCKET
  if (!bucket) return {}
  const keys = data.entries.map(e => e.details.photo_key).filter((k): k is string => !!k && k.startsWith(`child/${data.center.id}/`))
  const pairs = await Promise.all(keys.map(async k => {
    try {
      return [k, await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: k }), { expiresIn: PHOTO_LINK_SECONDS })] as const
    } catch {
      return null
    }
  }))
  return Object.fromEntries(pairs.filter((p): p is readonly [string, string] => !!p))
}

export async function sendDueDailyReports(limit = 25) {
  const supabase = admin()
  const summary = { claimed: 0, sent: 0, skipped: 0, failed: 0 }
  if (!process.env.RESEND_API_KEY) {
    console.error('[daily-report] RESEND_API_KEY is not set; nothing sent')
    return { ...summary, error: 'Email is not configured' }
  }
  const resend = new Resend(process.env.RESEND_API_KEY)

  const { data: claimed, error } = await supabase.rpc('daily_reports_claim', { p_limit: limit })
  if (error) throw new Error(`claim failed: ${error.message}`)
  const rows = (claimed ?? []) as Claimed[]
  summary.claimed = rows.length

  for (const row of rows) {
    try {
      const { data, error: readError } = await supabase.rpc('daily_report_data', { p_child_id: row.child_id, p_day: row.service_date })
      if (readError || !data) throw new Error(readError?.message ?? 'report not found')
      const report = data as ReportData
      if (!report.recipients.length) {
        await supabase.rpc('daily_report_skip', { p_id: row.id, p_reason: 'No guardian with an email has Daily report turned on' })
        summary.skipped++
        continue
      }

      const email = buildDailyReport(report, await signPhotos(report))
      const site = siteForDomain(report.center.domain_key)
      const from = `${reportSenderName(report.center.name)} <${site.senderEmail}>`
      const sentTo: string[] = []
      const errors: string[] = []
      for (const to of report.recipients) {
        const res = await resend.emails.send({
          from, to, subject: email.subject, html: email.html, text: email.text,
          ...(report.center.email ? { replyTo: report.center.email } : {}),
          headers: { 'X-Entity-Ref-ID': `daily-report-${row.id}-${to}` },
        }).catch((e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }))
        if (res.error) errors.push(`${to}: ${res.error.message}`)
        else sentTo.push(to)
      }

      // Sent to at least one guardian counts as sent (the others are noted); nobody reached is retried
      const ok = sentTo.length > 0
      await supabase.rpc('daily_report_finish', {
        p_id: row.id, p_ok: ok, p_recipients: sentTo, p_error: errors.length ? errors.join('; ') : null,
      })
      if (ok) summary.sent++
      else summary.failed++
    } catch (e) {
      summary.failed++
      console.error(`[daily-report] ${row.id} failed:`, e)
      await supabase.rpc('daily_report_finish', { p_id: row.id, p_ok: false, p_recipients: [], p_error: e instanceof Error ? e.message : String(e) })
    }
  }
  return summary
}

'use server'

import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'
import { createClient } from '@/lib/supabase/server'
import { buildDailyReport, type ReportData } from '@/lib/daily-report'
import { friendlyDailyError } from '@/lib/daily'

/**
 * Owners and admins: the parent daily report for a child and day, exactly as it would be emailed now.
 * daily_report_preview() decides who may see it (owner or admin of the child's center); photos are linked for an hour.
 */
export async function previewDailyReport(centerId: string, childId: string, day: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false as const, error: 'Please sign in again.' }
    const { data, error } = await supabase.rpc('daily_report_preview', { p_center_id: centerId, p_child_id: childId, p_day: day })
    if (error) return { success: false as const, error: friendlyDailyError(error) }
    const report = data as ReportData

    const bucket = process.env.R2_CHILD_BUCKET
    const urls: Record<string, string> = {}
    if (bucket) {
      await Promise.all(report.entries.map(async e => {
        const k = e.details.photo_key
        if (!k || !k.startsWith(`child/${centerId}/`)) return
        try { urls[k] = await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: k }), { expiresIn: 3600 }) } catch { /* left out */ }
      }))
    }
    const email = buildDailyReport(report, urls)
    return { success: true as const, subject: email.subject, html: email.html, recipients: report.recipients, replyTo: report.center.email }
  } catch (error) {
    console.error('[daily-report] preview failed:', error)
    return { success: false as const, error: 'Could not build the report.' }
  }
}

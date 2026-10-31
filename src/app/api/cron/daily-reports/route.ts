import { NextResponse } from 'next/server'
import { rejectUnauthorizedCron } from '@/lib/server/cron-auth'
import { sendDueDailyReports } from '@/lib/server/daily-report-send'

/**
 * Parent daily reports. Called every 5 minutes by Supabase (pg_cron + pg_net, see
 * scripts/roster/schedule-daily-reports.sql) and once a day by Vercel Cron as a safety net.
 * Both send `Authorization: Bearer $CRON_SECRET`.
 */
export const maxDuration = 60

export async function GET(request: Request) {
  const rejected = rejectUnauthorizedCron(request)
  if (rejected) return rejected
  try {
    const summary = await sendDueDailyReports(25)
    return NextResponse.json(summary)
  } catch (error) {
    console.error('[daily-report] run failed:', error)
    return NextResponse.json({ error: 'Daily reports failed' }, { status: 500 })
  }
}

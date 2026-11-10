import { NextResponse } from 'next/server'
import { rejectUnauthorizedCron } from '@/lib/server/cron-auth'
import { sendDueDailyReports } from '@/lib/server/daily-report-send'
import { sendDueParentMessages } from '@/lib/server/parent-message-send'
import { sendDueAnnouncements } from '@/lib/server/announcement-send'

/**
 * Parent daily reports. Called every 5 minutes by Supabase (pg_cron + pg_net, see
 * scripts/roster/schedule-daily-reports.sql) and once a day by Vercel Cron as a safety net.
 * Both send `Authorization: Bearer $CRON_SECRET`.
 * The same run retries parent messages and announcements that were not delivered when sent.
 */
export const maxDuration = 60

export async function GET(request: Request) {
  const rejected = rejectUnauthorizedCron(request)
  if (rejected) return rejected
  try {
    const summary = await sendDueDailyReports(25)
    const messages = await sendDueParentMessages(50).catch(e => {
      console.error('[parent-message] retry run failed:', e)
      return { error: 'Parent message retry failed' }
    })
    const announcements = await sendDueAnnouncements(200).catch(e => {
      console.error('[announcement] retry run failed:', e)
      return { error: 'Announcement retry failed' }
    })
    return NextResponse.json({ ...summary, messages, announcements })
  } catch (error) {
    console.error('[daily-report] run failed:', error)
    return NextResponse.json({ error: 'Daily reports failed' }, { status: 500 })
  }
}

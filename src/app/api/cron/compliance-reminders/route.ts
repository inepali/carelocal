import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { rejectUnauthorizedCron } from '@/lib/server/cron-auth'
import { loadCenterCompliance, countStates, daysUntil } from '@/lib/compliance-data'
import { notifyUsers } from '@/lib/server/notify'

/**
 * Daily compliance reminders (Vercel Cron).
 *
 * Staff — one message per center listing what needs them, sent when an item they can act
 * on is due in 30, 7 or 1 days or today, then weekly once overdue. Open document requests
 * remind 3 days before, on the due date, then weekly. Because the job runs once a day,
 * these day-based rules are what keep reminders from repeating.
 *
 * Admins — a digest whenever something waits for their review; on Mondays also the
 * overdue / due-soon summary.
 */
const REMIND_AT_DAYS = new Set([30, 7, 1, 0])
const REQUEST_REMIND_AT_DAYS = new Set([3, 0])

function shouldRemind(days: number, schedule: Set<number>) {
  return schedule.has(days) || (days < 0 && -days % 7 === 0)
}

function describeDays(days: number) {
  if (days < 0) return `overdue by ${-days} day${days === -1 ? '' : 's'}`
  if (days === 0) return 'due today'
  return `due in ${days} day${days === 1 ? '' : 's'}`
}

function listItems(items: string[]) {
  return items.length <= 4 ? items.join('; ') : `${items.slice(0, 4).join('; ')}; and ${items.length - 4} more`
}

export async function GET(request: Request) {
  const rejected = rejectUnauthorizedCron(request)
  if (rejected) return rejected

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const today = new Date()
  const isMonday = today.getDay() === 1
  const summary = { centers: 0, staffReminders: 0, adminDigests: 0 }

  try {
    const { data: centers, error } = await supabase.from('centers').select('id, name, domain_key')
    if (error) throw error

    for (const center of centers || []) {
      const data = await loadCenterCompliance(supabase, center.id, today)
      if (data.requirements.length === 0) continue
      summary.centers++

      const { data: requests } = await supabase
        .from('document_requests')
        .select('staff_id, title, due_date, status')
        .eq('center_id', center.id)
        .in('status', ['open', 'submitted'])

      // ── Staff reminders ──
      for (const emp of data.employees) {
        if (!emp.userId) continue
        const lines: string[] = []

        for (const req of data.requirements) {
          const item = emp.items[req.id]
          if (!item?.dueDate || req.evidence_type === 'center_record') continue
          if (!['missing', 'due_soon', 'overdue', 'rejected'].includes(item.state)) continue
          const days = daysUntil(item.dueDate, today)
          if (!shouldRemind(days, REMIND_AT_DAYS)) continue
          const renewal = item.record?.status === 'accepted'
          lines.push(`${req.document_name} (${renewal && days >= 0 ? `renewal ${describeDays(days)}` : describeDays(days)})`)
        }

        for (const r of (requests || []).filter(r => r.staff_id === emp.staffId && r.status === 'open' && r.due_date)) {
          const days = daysUntil(new Date(`${r.due_date}T00:00:00`), today)
          if (shouldRemind(days, REQUEST_REMIND_AT_DAYS)) lines.push(`Requested: ${r.title} (${describeDays(days)})`)
        }

        if (lines.length === 0) continue
        await notifyUsers([emp.userId], {
          title: `${center.name}: ${lines.length} item${lines.length === 1 ? ' needs' : 's need'} your attention`,
          message: listItems(lines),
          type: 'compliance_reminder',
          url: '/staff/centers',
          emailCta: 'Open my checklist',
        }, center.domain_key)
        summary.staffReminders++
      }

      // ── Admin digest ──
      const counts = countStates(data)
      const awaitingReview = counts.pending_review + (requests || []).filter(r => r.status === 'submitted').length
      const sendDigest = awaitingReview > 0 || (isMonday && counts.overdue + counts.due_soon > 0)
      if (!sendDigest) continue

      const parts = [
        awaitingReview > 0 && `${awaitingReview} waiting for your review`,
        counts.overdue > 0 && `${counts.overdue} overdue`,
        counts.due_soon > 0 && `${counts.due_soon} due within 30 days`,
      ].filter(Boolean) as string[]

      const { data: admins } = await supabase.from('center_admins').select('user_id').eq('center_id', center.id)
      await notifyUsers((admins || []).map(a => a.user_id), {
        title: `${center.name}: personnel file update`,
        message: `${parts.join(', ')}.`,
        type: 'compliance_digest',
        url: awaitingReview > 0 ? '/center/requests' : '/center/compliance',
        emailCta: 'Open compliance overview',
      }, center.domain_key)
      summary.adminDigests++
    }

    return NextResponse.json({ success: true, ...summary })
  } catch (err) {
    console.error('Compliance reminders failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal Server Error', ...summary }, { status: 500 })
  }
}

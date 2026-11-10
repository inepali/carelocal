'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/server/notify'
import { formatDate, formatTime } from '@/lib/schedule'

type Result = { success: true; count: number } | { success: false; error: string }

/** "Infant A 07:00-11:00 · Toddler 11:00-15:00" -> "Infant A 7 AM–11 AM · Toddler 11 AM–3 PM" */
function readable(summary: string): string {
  return summary.replace(/(\d{2}:\d{2})-(\d{2}:\d{2})/g, (_, a: string, b: string) => `${formatTime(a)}–${formatTime(b)}`)
}

/**
 * Owner/admin: tell everyone on a published day whose boxes changed since they were last told (on the first
 * publish, that is everyone on the day). In-app and push only, no email. The database decides who may do this and
 * who needs telling (schedule_notice_targets), and records what each person was told (schedule_notice_mark), so
 * pressing it twice tells nobody twice.
 */
export async function notifySchedule(centerId: string, date: string): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Please sign in again.' }

  const { data: targets, error } = await supabase.rpc('schedule_notice_targets', { p_center_id: centerId, p_date: date })
  if (error) return { success: false, error: error.message }
  const rows = (targets ?? []) as { staff_id: string; user_id: string | null; first_name: string | null; summary: string; hash: string; first_notice: boolean }[]
  if (rows.length === 0) return { success: true, count: 0 }

  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: center } = await db.from('centers').select('name, domain_key').eq('id', centerId).maybeSingle()
  const day = formatDate(date)
  const url = `/staff/schedule?date=${date}`

  for (const r of rows) {
    if (!r.user_id) continue
    const where = readable(r.summary)
    await notifyUsers([r.user_id], {
      title: r.first_notice ? `Your schedule for ${day}` : `Your schedule for ${day} changed`,
      message: where ? where : `You're not on the schedule at ${center?.name ?? 'your center'} that day.`,
      type: 'schedule',
      url,
      skipEmail: true,
    }, center?.domain_key)
  }

  const { data: marked, error: markError } = await supabase.rpc('schedule_notice_mark', {
    p_center_id: centerId, p_date: date, p_items: rows.map(r => ({ staff_id: r.staff_id, hash: r.hash })),
  })
  if (markError) return { success: false, error: markError.message }
  return { success: true, count: typeof marked === 'number' ? marked : rows.length }
}

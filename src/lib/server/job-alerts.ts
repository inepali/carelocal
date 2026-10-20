import { createClient } from '@supabase/supabase-js'
import { notifyUsers } from '@/lib/server/notify'

/**
 * Server-only (service role): sends job alerts for a newly published posting, once per posting.
 * Matches active alerts of staff in the center's metro area and vertical, by city (or any) and
 * role (or any). One notification per person, however many of their alerts match.
 */
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

export async function sendJobAlerts(jobId: string) {
  const supabase = db()

  // Claim the posting first so concurrent publishes cannot alert twice
  const { data: claimed } = await supabase.from('job_postings')
    .update({ alerts_sent_at: new Date().toISOString() })
    .eq('id', jobId).eq('status', 'published').is('alerts_sent_at', null)
    .select('id, title, role_value, domain_key, center:centers(name, city, state, metro_area_id)')
    .maybeSingle()
  if (!claimed) return { sent: 0 }

  const center = (Array.isArray(claimed.center) ? claimed.center[0] : claimed.center) as { name: string; city: string | null; state: string | null; metro_area_id: string | null } | null
  if (!center?.metro_area_id) return { sent: 0 }

  const { data: alerts } = await supabase.from('job_alerts')
    .select('city, state, role_value, staff:staff_profiles!inner(user_id, metro_area_id, domain_key)')
    .eq('is_active', true)
  const recipients = new Set<string>()
  for (const alert of alerts ?? []) {
    const staff = (Array.isArray(alert.staff) ? alert.staff[0] : alert.staff) as { user_id: string; metro_area_id: string | null; domain_key: string | null } | null
    if (!staff?.user_id || staff.metro_area_id !== center.metro_area_id) continue
    if (staff.domain_key && staff.domain_key !== claimed.domain_key) continue
    if (alert.city && !same(alert.city, center.city)) continue
    if (alert.state && !same(alert.state, center.state)) continue
    if (alert.role_value && alert.role_value !== claimed.role_value) continue
    recipients.add(staff.user_id)
  }
  if (recipients.size === 0) return { sent: 0 }

  await notifyUsers([...recipients], {
    title: `New job: ${claimed.title}`,
    message: `${center.name}${center.city ? ` in ${center.city}` : ''} is hiring. Take a look and apply in one tap.`,
    type: 'job_alert',
    referenceId: claimed.id,
    url: `/staff/jobs/${claimed.id}`,
    emailCta: 'View the job',
  }, claimed.domain_key)
  return { sent: recipients.size }
}

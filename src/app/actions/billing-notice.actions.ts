'use server'

import { createClient } from '@/lib/supabase/server'
import { sendBillingNoticesNow } from '@/lib/server/billing-notice-send'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Center owner or admin, right after Submit Billing or Void: email the run's families now (bill, or "bill canceled").
 * The caller's own session must be able to read the run (owners and admins of its center). Anything not sent here is
 * retried by the cron, so a failure never blocks billing.
 */
export async function sendRunEmails(runId: string): Promise<{ sent: number; failed: number }> {
  if (!UUID.test(runId)) return { sent: 0, failed: 0 }
  const supabase = await createClient()
  const { data } = await supabase.from('billing_runs').select('id').eq('id', runId).maybeSingle()
  if (!data) return { sent: 0, failed: 0 }
  try {
    const r = await sendBillingNoticesNow(runId)
    return { sent: r.sent, failed: r.failed }
  } catch (e) {
    console.error('[billing-notice] send after submit failed:', e instanceof Error ? e.message : e)
    return { sent: 0, failed: 0 }
  }
}

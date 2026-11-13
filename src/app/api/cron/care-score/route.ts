import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { rejectUnauthorizedCron } from '@/lib/server/cron-auth'
import { promptPendingReviews, sendReviewReminders } from '@/lib/server/care-review-prompts'

/**
 * Nightly Care Score job:
 *  1. Recompute every score: recency decay changes them daily, and reviews whose blind window closed today
 *     start counting.
 *  2. Ask for reviews on shifts that ended without a check-out (check-outs prompt right away).
 *  3. One reminder, 48 hours after the prompt, to whichever side has not reviewed yet.
 */
export async function GET(request: Request) {
  const rejected = rejectUnauthorizedCron(request)
  if (rejected) return rejected

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  try {
    const { data: recomputed, error } = await supabase.rpc('recompute_all_care_scores')
    if (error) {
      console.error('Care Score recompute failed:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const prompted = await promptPendingReviews()
    const reminded = await sendReviewReminders()
    return NextResponse.json({ success: true, recomputed: recomputed ?? 0, prompted, reminded })
  } catch (err) {
    console.error('Care Score cron failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, { status: 500 })
  }
}

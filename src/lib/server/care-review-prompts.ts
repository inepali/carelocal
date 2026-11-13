import { createClient } from '@supabase/supabase-js'
import { notifyUsers } from '@/lib/server/notify'
import { REVIEW_WINDOW_DAYS } from '@/lib/care-score'

/**
 * Asks both sides of a worked shift for a Care Score review: the staff member reviews the center, the center's
 * owners/admins review the staff member. Each claim is prompted once (shift_claims.review_prompted_at is claimed
 * before sending, so two runs never double-send). Server-only: uses the service role.
 */
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

type ClaimRow = {
  id: string
  shift_id: string
  staff_id: string
  shifts: { id: string; center_id: string; shift_date: string; centers: { name: string; domain_key: string | null } | null } | null
  staff_profiles: { user_id: string | null; first_name: string | null } | null
}

async function promptClaims(claimIds: string[]) {
  if (claimIds.length === 0) return 0
  const db = admin()

  // Claim the prompt first; only rows we flipped from null are ours to send.
  const { data: mine, error } = await db.from('shift_claims')
    .update({ review_prompted_at: new Date().toISOString() })
    .in('id', claimIds).is('review_prompted_at', null).eq('status', 'confirmed')
    .select('id, shift_id, staff_id, shifts(id, center_id, shift_date, centers(name, domain_key)), staff_profiles(user_id, first_name)')
  if (error) { console.error('care review prompt claim failed:', error); return 0 }

  const rows = (mine ?? []) as unknown as ClaimRow[]
  const centerIds = [...new Set(rows.map(r => r.shifts?.center_id).filter(Boolean) as string[])]
  const { data: admins } = centerIds.length
    ? await db.from('center_admins').select('center_id, user_id, role').in('center_id', centerIds).in('role', ['owner', 'admin'])
    : { data: [] as { center_id: string; user_id: string; role: string }[] }

  let sent = 0
  for (const r of rows) {
    const shift = r.shifts
    if (!shift) continue
    const centerName = shift.centers?.name ?? 'the center'
    const domainKey = shift.centers?.domain_key ?? null
    const staffName = r.staff_profiles?.first_name || 'your staff member'
    const day = new Date(`${shift.shift_date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

    try {
      if (r.staff_profiles?.user_id) {
        await notifyUsers([r.staff_profiles.user_id], {
          title: `How was your shift at ${centerName}?`,
          message: `Rate your ${day} shift. Your review stays hidden until ${centerName} reviews you too, or ${REVIEW_WINDOW_DAYS} days pass.`,
          type: 'care_review_request',
          referenceId: shift.id,
          url: '/staff/my-shifts',
          emailCta: 'Leave a review',
          skipEmail: true,
        }, domainKey)
      }
      const adminIds = (admins ?? []).filter(a => a.center_id === shift.center_id).map(a => a.user_id)
      if (adminIds.length > 0) {
        await notifyUsers(adminIds, {
          title: `Review ${staffName}'s shift`,
          message: `How did ${staffName} do on ${day}? Reviews build their Care Score; you have ${REVIEW_WINDOW_DAYS} days.`,
          type: 'care_review_request',
          referenceId: shift.id,
          url: '/center/shifts',
          emailCta: 'Leave a review',
          skipEmail: true,
        }, domainKey)
      }
      sent++
    } catch (err) {
      console.error('care review prompt failed for claim', r.id, err)
    }
  }
  return sent
}

/** Right after check-out: prompt this shift's confirmed claims. Never throws. */
export async function promptReviewsForShift(shiftId: string, staffId?: string) {
  try {
    let q = admin().from('shift_claims').select('id').eq('shift_id', shiftId).eq('status', 'confirmed').is('review_prompted_at', null)
    if (staffId) q = q.eq('staff_id', staffId)
    const { data } = await q
    return await promptClaims((data ?? []).map(d => d.id))
  } catch (err) {
    console.error('promptReviewsForShift failed:', err)
    return 0
  }
}

/**
 * Nightly: prompt confirmed claims on shifts that ended without a check-out (or whose prompt was missed),
 * as long as the review window is still open.
 */
export async function promptPendingReviews() {
  const db = admin()
  const today = new Date()
  const from = new Date(today.getTime() - (REVIEW_WINDOW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10)
  const to = today.toISOString().slice(0, 10)
  const { data, error } = await db.from('shift_claims')
    .select('id, check_out_time, shifts!inner(shift_date)')
    .eq('status', 'confirmed').is('review_prompted_at', null)
    .gte('shifts.shift_date', from).lt('shifts.shift_date', to)
    .limit(500)
  if (error) { console.error('promptPendingReviews query failed:', error); return 0 }
  return promptClaims((data ?? []).map(d => d.id))
}

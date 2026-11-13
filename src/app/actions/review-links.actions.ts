'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  MAX_COMMENT_LENGTH, cleanSubRatings,
  type CareSubjectType, type ReviewLinkInfo, type ReviewLinkOption, type ReviewLinkOptions,
} from '@/lib/care-score'

/**
 * "Ask for a review" links (/r/<code>). The database decides everything: who may get a subject's link (the staff
 * member themself, or the center's owner/admins), who may review from it (a real working relationship), and the
 * 90-day / 48-hour rules (20270106000000_care_review_links.sql).
 */

const CODE = /^[0-9a-hjkmnp-tv-z]{12}$/

/** Your (or your center's) review link; rotate = turn the old one off and make a new code */
export async function getReviewLink(subjectType: CareSubjectType, subjectId: string, rotate = false) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('care_review_link_get', { p_subject_type: subjectType, p_subject_id: subjectId, p_rotate: rotate })
  if (error) return { error: error.message }
  const link = data as { code: string; expires_at: string; uses: number }
  return { code: link.code, expiresAt: link.expires_at, uses: link.uses }
}

/** Who a link asks about (fine before sign-in), or null when the link is wrong, turned off or expired */
export async function getReviewLinkInfo(code: string): Promise<ReviewLinkInfo | null> {
  const c = code?.toLowerCase() ?? ''
  if (!CODE.test(c)) return null
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('care_review_link_info', { p_code: c })
  if (error) { console.error('[review-links] info failed:', error.message); return null }
  return (data ?? null) as ReviewLinkInfo | null
}

/** How the signed-in viewer may review from a link (empty options = no working relationship) */
export async function getReviewLinkOptions(code: string): Promise<ReviewLinkOptions | null> {
  const c = code?.toLowerCase() ?? ''
  if (!CODE.test(c)) return null
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('care_review_link_options', { p_code: c })
  if (error) { console.error('[review-links] options failed:', error.message); return null }
  return (data ?? null) as ReviewLinkOptions | null
}

export async function submitLinkReview(code: string, input: {
  as: ReviewLinkOption['as']
  orgId: string
  rating: number
  comment?: string
  privateFeedback?: string
  subRatings?: Record<string, number>
}): Promise<{ ok: true; held: boolean } | { ok: false; error: string }> {
  const c = code?.toLowerCase() ?? ''
  if (!CODE.test(c)) return { ok: false, error: 'This review link is not right.' }
  if (!['staff', 'center', 'peer'].includes(input.as)) return { ok: false, error: 'Choose how you are reviewing.' }
  const rating = Math.round(Number(input.rating))
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return { ok: false, error: 'Choose a rating from 1 to 5 stars.' }
  const comment = input.comment?.trim() ?? ''
  const privateFeedback = input.privateFeedback?.trim() ?? ''
  if (comment.length > MAX_COMMENT_LENGTH || privateFeedback.length > MAX_COMMENT_LENGTH) {
    return { ok: false, error: `Comments can be up to ${MAX_COMMENT_LENGTH} characters.` }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('care_review_link_submit', {
    p_code: c, p_as: input.as, p_org_id: input.orgId, p_rating: rating,
    p_comment: comment || null, p_private_feedback: privateFeedback || null,
    p_sub_ratings: cleanSubRatings(input.as, input.subRatings),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/r/${c}`)
  return { ok: true, held: !!(data as { held?: boolean } | null)?.held }
}

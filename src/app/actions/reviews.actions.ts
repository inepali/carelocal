'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  MAX_COMMENT_LENGTH, MAX_REPLY_LENGTH, reviewErrorMessage,
  type CareReview, type CareScoreRow, type CareSubjectType,
} from '@/lib/care-score'

type ReviewContent = {
  rating: number
  punctual?: boolean
  tags?: string[]
  public_comment?: string
  private_feedback?: string
  do_not_return?: boolean
}

function cleanContent(data: ReviewContent, reviewerType: 'center' | 'staff') {
  const rating = Math.round(Number(data.rating))
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return { error: 'Choose a rating from 1 to 5 stars.' } as const
  const publicComment = data.public_comment?.trim() || null
  const privateFeedback = data.private_feedback?.trim() || null
  if ((publicComment?.length ?? 0) > MAX_COMMENT_LENGTH || (privateFeedback?.length ?? 0) > MAX_COMMENT_LENGTH) {
    return { error: `Comments can be up to ${MAX_COMMENT_LENGTH} characters.` } as const
  }
  const tags = Array.isArray(data.tags) ? data.tags.filter(t => typeof t === 'string').map(t => t.slice(0, 50)).slice(0, 10) : []
  return {
    value: {
      rating,
      tags,
      public_comment: publicComment,
      private_feedback: privateFeedback,
      // Punctuality and "do not return" are a center's call about staff
      punctual: reviewerType === 'center' ? data.punctual ?? null : null,
      do_not_return: reviewerType === 'center' ? !!data.do_not_return : false,
    },
  } as const
}

/**
 * Review the other side of a shift you worked. The reviewer is always the signed-in user: a staff member reviews
 * the shift's center as themselves, a center admin reviews the staff member for the shift's center. The database
 * (guard_shift_review) checks the shift was worked together, has ended and is within the 7-day window, captures
 * the author's name and role, and keeps the review hidden until both sides have reviewed or the window closes.
 */
export async function submitReview(data: ReviewContent & {
  shift_id: string
  reviewer_type: 'center' | 'staff'
  /** Staff member being reviewed (center reviews). Ignored for staff reviews: the shift's center is the reviewee. */
  reviewee_id?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Please sign in again.' }

  const content = cleanContent(data, data.reviewer_type)
  if ('error' in content) return { error: content.error }

  const { data: shift } = await supabase.from('shifts').select('id, center_id').eq('id', data.shift_id).maybeSingle()
  if (!shift) return { error: 'Shift not found.' }

  let reviewerId: string
  let revieweeId: string
  if (data.reviewer_type === 'staff') {
    const { data: me } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
    if (!me) return { error: 'Staff profile not found.' }
    reviewerId = me.id
    revieweeId = shift.center_id
  } else {
    if (!data.reviewee_id) return { error: 'Choose who you are reviewing.' }
    reviewerId = shift.center_id
    revieweeId = data.reviewee_id
  }

  const { error } = await supabase.from('shift_reviews').insert({
    shift_id: shift.id,
    reviewer_id: reviewerId,
    reviewee_id: revieweeId,
    reviewer_type: data.reviewer_type,
    ...content.value,
  })
  if (error) return { error: reviewErrorMessage(error.message) }

  revalidatePath('/staff/my-shifts')
  revalidatePath('/center/shifts')
  return { success: true }
}

/** Edit your own review during its 48-hour edit window. Earlier versions are kept in edit_history. */
export async function updateReview(reviewId: string, data: ReviewContent) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Please sign in again.' }

  const { data: existing } = await supabase.from('shift_reviews')
    .select('id, reviewer_type').eq('id', reviewId).eq('author_user_id', user.id).maybeSingle()
  if (!existing) return { error: 'Review not found.' }

  const content = cleanContent(data, existing.reviewer_type as 'center' | 'staff')
  if ('error' in content) return { error: content.error }

  const { error } = await supabase.from('shift_reviews').update(content.value).eq('id', reviewId)
  if (error) return { error: reviewErrorMessage(error.message) }

  revalidatePath('/staff/my-shifts')
  revalidatePath('/center/shifts')
  return { success: true }
}

/** Reviews you wrote for a shift (reviews about you come through getCareReviews once revealed) */
export async function getReviewsForShift(shiftId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('shift_reviews')
    .select('id, shift_id, reviewer_id, reviewee_id, reviewer_type, rating, tags, public_comment, private_feedback, punctual, do_not_return, reveal_at, locked_at, created_at')
    .eq('shift_id', shiftId)

  if (error) return { reviews: [], error: error.message }
  return { reviews: data || [] }
}

/** Care Scores for one or more subjects. Visible to every signed-in user (all centers can see every score). */
export async function getCareScores(subjectType: CareSubjectType, subjectIds: string[]) {
  const ids = Array.from(new Set(subjectIds.filter(Boolean)))
  if (ids.length === 0) return { scores: {} as Record<string, CareScoreRow> }
  const supabase = await createClient()
  const { data, error } = await supabase.from('care_scores').select('*').eq('subject_type', subjectType).in('subject_id', ids)
  if (error) return { scores: {} as Record<string, CareScoreRow>, error: error.message }
  const scores: Record<string, CareScoreRow> = {}
  for (const row of (data ?? []) as CareScoreRow[]) scores[row.subject_id] = { ...row, score: row.score == null ? null : Number(row.score), average: row.average == null ? null : Number(row.average) }
  return { scores }
}

/** Revealed, visible reviews about a subject: attributed, without private feedback, newest first, with replies */
export async function getCareReviews(subjectType: CareSubjectType, subjectId: string, limit = 20, offset = 0) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_care_reviews', {
    p_subject_type: subjectType, p_subject_id: subjectId, p_limit: limit, p_offset: offset,
  })
  if (error) return { reviews: [] as CareReview[], error: error.message }
  return { reviews: (data ?? []) as CareReview[] }
}

/** One public reply to a review about you (optional, but recommended). Calling again edits the reply. */
export async function respondToReview(reviewId: string, body: string) {
  const text = body?.trim() ?? ''
  if (!text) return { error: 'Write a reply first.' }
  if (text.length > MAX_REPLY_LENGTH) return { error: `Replies can be up to ${MAX_REPLY_LENGTH} characters.` }
  const supabase = await createClient()
  const { error } = await supabase.rpc('respond_to_care_review', { p_review_id: reviewId, p_body: text })
  if (error) return { error: error.message }
  revalidatePath('/staff/profile')
  revalidatePath('/center/dashboard')
  return { success: true }
}

/** Super admins: hide a review (with a reason) or show it again. Reviews are never deleted. */
export async function moderateReview(reviewId: string, hide: boolean, reason?: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('moderate_care_review', { p_review_id: reviewId, p_hide: hide, p_reason: reason ?? null })
  if (error) return { error: error.message }
  revalidatePath('/admin/reviews')
  return { success: true }
}

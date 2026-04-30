'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function submitReview(data: {
  shift_id: string
  reviewer_id: string
  reviewee_id: string
  reviewer_type: 'center' | 'staff'
  rating: number
  punctual?: boolean
  tags?: string[]
  public_comment?: string
  private_feedback?: string
  do_not_return?: boolean
}) {
  const supabase = await createClient()
  
  // Check if a review already exists between this reviewer and reviewee
  const { data: existing } = await supabase
    .from('shift_reviews')
    .select('id')
    .eq('reviewer_id', data.reviewer_id)
    .eq('reviewee_id', data.reviewee_id)
    .eq('reviewer_type', data.reviewer_type)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('shift_reviews')
      .update({
        shift_id: data.shift_id, // Update to the latest shift
        rating: data.rating,
        punctual: data.punctual,
        tags: data.tags || [],
        public_comment: data.public_comment,
        private_feedback: data.private_feedback,
        do_not_return: data.do_not_return || false
      })
      .eq('id', existing.id)

    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('shift_reviews')
      .insert({
        shift_id: data.shift_id,
        reviewer_id: data.reviewer_id,
        reviewee_id: data.reviewee_id,
        reviewer_type: data.reviewer_type,
        rating: data.rating,
        punctual: data.punctual,
        tags: data.tags || [],
        public_comment: data.public_comment,
        private_feedback: data.private_feedback,
        do_not_return: data.do_not_return || false
      })

    if (error) return { error: error.message }
  }

  revalidatePath('/staff/my-shifts')
  revalidatePath('/center/shifts')
  return { success: true }
}

export async function getReviewsForShift(shiftId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('shift_reviews')
    .select('*')
    .eq('shift_id', shiftId)

  if (error) {
    return { reviews: [], error: error.message }
  }
  return { reviews: data || [] }
}

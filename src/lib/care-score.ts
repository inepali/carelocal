/**
 * Care Score: the weighted 1–5★ reputation score for centers and staff (plan: claude/care-score-plan.md).
 *
 * The database is the source of truth: public.recompute_care_score() writes care_scores on every review change
 * and nightly. This module mirrors formula v1 so the UI and tests can explain and check it. Keep the two in step.
 *
 *   w_i   = starWeight(r_i) × 0.5^(age_days / 365) × trust_i / n_reviewer_i
 *   score = (C·m + Σ w_i·r_i) / (C + Σ w_i),  C = 5, m = 4.0
 */

export const CARE_SCORE_VERSION = 1
export const PRIOR_WEIGHT = 5
export const PRIOR_MEAN = 4.0
export const HALF_LIFE_DAYS = 365
/** Below this many reviews a profile shows "New" instead of a number */
export const MIN_REVIEWS_FOR_SCORE = 3
/** Days after a shift ends during which either side may review it (public.care_review_window) */
export const REVIEW_WINDOW_DAYS = 7
/** Hours an author may edit a review after writing it */
export const EDIT_WINDOW_HOURS = 48
export const MAX_COMMENT_LENGTH = 2000
export const MAX_REPLY_LENGTH = 1000

export const STAR_WEIGHTS: Record<number, number> = { 1: 1.5, 2: 1.25, 3: 1.0, 4: 1.0, 5: 0.9 }

export type CareSubjectType = 'center' | 'staff'
export type Histogram = Record<'1' | '2' | '3' | '4' | '5', number>

export interface ScoreInput {
  rating: number
  reviewerId: string
  ageDays: number
  trust?: number
}

export interface CareScoreRow {
  subject_type: CareSubjectType
  subject_id: string
  score: number | null
  average: number | null
  review_count: number
  reviewer_count: number
  histogram: Histogram
  score_version: number
  computed_at: string
}

export interface CareReview {
  id: string
  shift_id: string
  rating: number
  tags: string[] | null
  public_comment: string | null
  punctual: boolean | null
  created_at: string
  author_name: string | null
  author_role: string | null
  author_org: string | null
  response_body: string | null
  response_author_name: string | null
  response_at: string | null
  is_mine: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function starWeight(rating: number) {
  return STAR_WEIGHTS[rating] ?? 1
}

export function recencyWeight(ageDays: number) {
  return Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS)
}

/** Formula v1, same as public.recompute_care_score(). Null when there are no reviews. */
export function computeCareScore(reviews: ScoreInput[]): number | null {
  if (reviews.length === 0) return null
  const perReviewer = new Map<string, number>()
  for (const r of reviews) perReviewer.set(r.reviewerId, (perReviewer.get(r.reviewerId) ?? 0) + 1)

  let weightSum = 0
  let weighted = 0
  for (const r of reviews) {
    const w = starWeight(r.rating) * recencyWeight(r.ageDays) * (r.trust ?? 1) / perReviewer.get(r.reviewerId)!
    weightSum += w
    weighted += w * r.rating
  }
  return round2((PRIOR_WEIGHT * PRIOR_MEAN + weighted) / (PRIOR_WEIGHT + weightSum))
}

export function emptyHistogram(): Histogram {
  return { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
}

export function buildHistogram(ratings: number[]): Histogram {
  const h = emptyHistogram()
  for (const r of ratings) if (r >= 1 && r <= 5) h[String(r) as keyof Histogram]++
  return h
}

/** Rows for the 5→1 bar chart, with each bar's share of all reviews */
export function histogramRows(histogram: Histogram | null | undefined) {
  const h = histogram ?? emptyHistogram()
  const total = (Object.values(h) as number[]).reduce((a, b) => a + b, 0)
  return ([5, 4, 3, 2, 1] as const).map(star => {
    const count = h[String(star) as keyof Histogram] ?? 0
    return { star, count, share: total > 0 ? count / total : 0 }
  })
}

/** Whether the score is shown as a number (enough reviews) or as "New" */
export function hasEnoughReviews(row: Pick<CareScoreRow, 'review_count'> | null | undefined) {
  return !!row && row.review_count >= MIN_REVIEWS_FOR_SCORE
}

export function formatScore(score: number | null | undefined) {
  return score == null ? '–' : score.toFixed(1)
}

/** "Priya S. · Owner · Sunrise KA" */
export function attributionLine(review: Pick<CareReview, 'author_name' | 'author_role' | 'author_org'>) {
  return [review.author_name, review.author_role, review.author_org].filter(Boolean).join(' · ')
}

/** Which side reviews a subject: centers review staff, staff review centers */
export function reviewerTypeFor(subject: CareSubjectType): 'center' | 'staff' {
  return subject === 'staff' ? 'center' : 'staff'
}

/** A shift may be reviewed from its end (or check-out) until REVIEW_WINDOW_DAYS later */
export function reviewWindow(endedAt: Date, now: Date = new Date()) {
  const closesAt = new Date(endedAt.getTime() + REVIEW_WINDOW_DAYS * 86_400_000)
  return { open: now >= endedAt && now <= closesAt, closesAt }
}

/** Plain-language messages for the database's review errors */
export function reviewErrorMessage(raw: string | null | undefined) {
  const msg = raw ?? ''
  if (/duplicate key|shift_pair_key/i.test(msg)) return 'You have already reviewed this shift.'
  if (/no longer be edited/i.test(msg)) return `Reviews can only be edited for ${EDIT_WINDOW_HOURS} hours after you write them.`
  if (/window for this shift has closed/i.test(msg)) return `The review window for this shift has closed (${REVIEW_WINDOW_DAYS} days after it ended).`
  if (/once it has ended/i.test(msg)) return 'You can review this shift once it has ended.'
  if (/worked together/i.test(msg)) return 'Reviews are only for shifts you worked together.'
  return msg || 'Something went wrong. Please try again.'
}

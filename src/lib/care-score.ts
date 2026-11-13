/**
 * Care Score: the weighted 1–5★ reputation score for centers and staff (plan: claude/care-score-plan.md).
 *
 * The database is the source of truth: public.recompute_care_score() writes care_scores on every review change
 * and nightly. This module mirrors formula v2 so the UI and tests can explain and check it. Keep the two in step.
 *
 *   w_i   = starWeight(r_i) × 0.5^(age_days / 365) × trust_i × calibration_i / n_reviewer_i
 *   calibration = 1, or for a reviewer who has rated more than 5 subjects: 0.6 + 0.4 × min(sd / 0.3, 1)
 *   score = (C·m + Σ w_i·r_i) / (C + Σ w_i),  C = 5, m = 4.0
 *   rank  = Wilson lower bound (95%) of the share of 4–5★ reviews (sorting only)
 */

export const CARE_SCORE_VERSION = 2
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
/** Weight of a parent's review compared with a verified shift review */
export const PARENT_TRUST = 0.8
/** A parent may review their center once per this many days (and edit for EDIT_WINDOW_HOURS) */
export const PARENT_REVIEW_INTERVAL_DAYS = 90
export const REPORTS_PER_DAY = 5

export type CareSubjectType = 'center' | 'staff'
export type ReviewerType = 'center' | 'staff' | 'parent' | 'peer'

/** Optional 1–5 topics per reviewer side (public.care_sub_rating_keys). Shown as a breakdown, not in the score. */
export const SUB_RATING_TOPICS: Record<ReviewerType, { key: string; label: string }[]> = {
  center: [
    { key: 'punctuality', label: 'Punctuality' },
    { key: 'ratio_compliance', label: 'Ratio compliance' },
    { key: 'communication', label: 'Communication' },
    { key: 'classroom_readiness', label: 'Classroom readiness' },
  ],
  staff: [
    { key: 'organization', label: 'Organization' },
    { key: 'support', label: 'Support from staff' },
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'would_return', label: 'Would work here again' },
  ],
  parent: [
    { key: 'communication', label: 'Communication' },
    { key: 'safety', label: 'Safety & cleanliness' },
    { key: 'learning', label: 'Learning' },
    { key: 'caring_staff', label: 'Caring teachers' },
  ],
  peer: [
    { key: 'teamwork', label: 'Teamwork' },
    { key: 'reliability', label: 'Reliability' },
    { key: 'communication', label: 'Communication' },
    { key: 'classroom_skills', label: 'Classroom skills' },
  ],
}

export type SubRatings = Record<string, number>

/** Only the reviewer side's topics, whole stars 1–5 */
export function cleanSubRatings(reviewerType: ReviewerType, input: unknown): SubRatings {
  const allowed = new Set(SUB_RATING_TOPICS[reviewerType].map(t => t.key))
  const out: SubRatings = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const n = Number(v)
    if (allowed.has(k) && Number.isInteger(n) && n >= 1 && n <= 5) out[k] = n
  }
  return out
}

export function subRatingLabel(key: string) {
  for (const list of Object.values(SUB_RATING_TOPICS)) {
    const hit = list.find(t => t.key === key)
    if (hit) return hit.label
  }
  return key.replace(/_/g, ' ')
}
export type Histogram = Record<'1' | '2' | '3' | '4' | '5', number>

export interface ScoreInput {
  rating: number
  reviewerId: string
  ageDays: number
  trust?: number
  /** From reviewerCalibration(); 1 when unknown */
  calibration?: number
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
  rank_score: number | null
  sub_scores: Record<string, { average: number; count: number }>
  by_source: Partial<Record<ReviewerType, { average: number; count: number }>>
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
  like_count: number
  liked_by_me: boolean
  reported_by_me: boolean
  source: ReviewerType
  sub_ratings: SubRatings | null
}

export type ReviewSort = 'recent' | 'helpful'

export const REPORT_REASONS = [
  { value: 'retaliation', label: 'Retaliation for my review' },
  { value: 'false_information', label: 'False information' },
  { value: 'child_info', label: "Mentions a child's information" },
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'other', label: 'Something else' },
] as const
export type ReportReason = typeof REPORT_REASONS[number]['value']

/** Why a review is held back for a super admin's look (shift_reviews.held_reasons) */
export const HOLD_REASON_LABELS: Record<string, string> = {
  phone: 'Phone number',
  email: 'Email address',
  address: 'Street address',
  child_name: "A child's name",
  reported_child_info: "Reported: child's information",
}

export type PersonalInfoKind = 'phone' | 'email' | 'address'

// Same patterns as public.care_review_pii_reasons() (child names are only checked by the database)
const PHONE_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
const ADDRESS_RE = /\b\d{1,6}\s+([a-z0-9.]+\s+){0,3}(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|way|pl|place|cir|circle|pkwy|parkway|hwy|highway)\b/i

/** Personal info a public comment should not carry. Used to warn before submitting. */
export function personalInfoWarnings(text: string | null | undefined): PersonalInfoKind[] {
  const t = text ?? ''
  const found: PersonalInfoKind[] = []
  if (PHONE_RE.test(t)) found.push('phone')
  if (EMAIL_RE.test(t)) found.push('email')
  if (ADDRESS_RE.test(t)) found.push('address')
  return found
}

export function personalInfoMessage(kinds: string[]) {
  const words = kinds.map(k => (HOLD_REASON_LABELS[k] ?? k).toLowerCase().replace("a child's name", "children's names"))
  return words.length === 0 ? '' : `Please remove ${words.join(', ')}. Public comments with personal details are held for review.`
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function starWeight(rating: number) {
  return STAR_WEIGHTS[rating] ?? 1
}

export function recencyWeight(ageDays: number) {
  return Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS)
}

/**
 * How much a reviewer's reviews count, from all ratings they have given (one per subject is enough).
 * Full weight until they have rated more than 5 subjects; then 0.6 with no spread, rising to 1 at sd 0.3.
 */
export function reviewerCalibration(ratings: number[], subjectCount: number) {
  if (subjectCount <= 5 || ratings.length === 0) return 1
  const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length
  const sd = Math.sqrt(ratings.reduce((a, b) => a + (b - mean) ** 2, 0) / ratings.length)
  return 0.6 + 0.4 * Math.min(sd / 0.3, 1)
}

/** Wilson lower bound (z = 1.96) of positives/n, for ranking lists. Null with no reviews. */
export function wilsonLowerBound(positives: number, n: number, z = 1.96) {
  if (n <= 0) return null
  const p = positives / n
  const z2 = z * z
  return Math.round(((p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n)) * 10_000) / 10_000
}

/** Sort helper: higher rank_score first, unrated last, then more reviews first */
export function compareByRank(a: Pick<CareScoreRow, 'rank_score' | 'review_count'> | null | undefined, b: Pick<CareScoreRow, 'rank_score' | 'review_count'> | null | undefined) {
  const ra = a?.rank_score ?? -1
  const rb = b?.rank_score ?? -1
  if (rb !== ra) return rb - ra
  return (b?.review_count ?? 0) - (a?.review_count ?? 0)
}

/** Formula v2, same as public.recompute_care_score(). Null when there are no reviews. */
export function computeCareScore(reviews: ScoreInput[]): number | null {
  if (reviews.length === 0) return null
  const perReviewer = new Map<string, number>()
  for (const r of reviews) perReviewer.set(r.reviewerId, (perReviewer.get(r.reviewerId) ?? 0) + 1)

  let weightSum = 0
  let weighted = 0
  for (const r of reviews) {
    const w = starWeight(r.rating) * recencyWeight(r.ageDays) * (r.trust ?? 1) * (r.calibration ?? 1) / perReviewer.get(r.reviewerId)!
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

/** Which side reviews a subject: centers review staff; staff (and parents) review centers */
export function reviewerTypeFor(subject: CareSubjectType): 'center' | 'staff' {
  return subject === 'staff' ? 'center' : 'staff'
}

export const SOURCE_LABELS: Record<ReviewerType, string> = { center: 'Centers', staff: 'Staff', parent: 'Parents', peer: 'Coworkers' }

/** Trust of a review left from an "ask for a review" link (shift reviews are 1.0, parents 0.8) */
export const LINK_TRUST = { center: 0.9, staff: 0.9, peer: 0.7 } as const
export const LINK_REVIEWS_PER_DAY = 10

/** What /r/<code> shows before sign-in (care_review_link_info) */
export interface ReviewLinkInfo {
  subject_type: CareSubjectType
  name: string
  line: string | null
  /** A center whose parent portal is on: parents can rate through it */
  parents: boolean
}

/** One way the signed-in viewer may review from a link (care_review_link_options) */
export interface ReviewLinkOption {
  as: 'staff' | 'center' | 'peer'
  org_id: string
  label: string
  existing: {
    rating: number
    public_comment: string | null
    private_feedback: string | null
    sub_ratings: SubRatings
    editable: boolean
    next_review_at: string
  } | null
}

export interface ReviewLinkOptions {
  subject_type: CareSubjectType
  is_self: boolean
  options: ReviewLinkOption[]
  /** The signed-in person, so the page can explain why a way to review is not open */
  viewer?: {
    email: string | null
    has_staff_profile: boolean
    staff_name: string | null
    admin_of: string[]
    pending_shift_here: boolean
  }
}

/** Why a signed-in person cannot review from a link, in plain words (null when they can) */
export function linkIneligibleReason(subjectType: CareSubjectType, subjectName: string, o: ReviewLinkOptions) {
  if (o.is_self || o.options.length > 0) return null
  const v = o.viewer
  const who = v?.email ? `You're signed in as ${v.email}` : `You're signed in`
  if (!v?.has_staff_profile) {
    const admin = v && v.admin_of.length > 0 ? `, a center account for ${v.admin_of.join(', ')}` : ''
    return subjectType === 'center'
      ? `${who}${admin}. To review ${subjectName} as staff, sign in with your staff account.`
      : `${who}${admin}, which has not worked with ${subjectName}. Centers can review people who work or worked a shift there in the last 6 months.`
  }
  if (subjectType === 'center') {
    return v.pending_shift_here
      ? `${who} (${v.staff_name ?? 'staff'}). Your shift at ${subjectName} counts once it is checked out.`
      : `${who} (${v.staff_name ?? 'staff'}), who is not on ${subjectName}'s team and has not worked a shift there in the last 6 months.`
  }
  return `${who} (${v.staff_name ?? 'staff'}). Coworker reviews are for people who work, or worked in the last 6 months, at the same center.`
}

/** Whether the viewer may write (new or edit) for an option now */
export function canWriteOption(o: ReviewLinkOption, now: Date = new Date()) {
  return !o.existing || o.existing.editable || new Date(o.existing.next_review_at) <= now
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

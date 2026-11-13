'use client'

import { useCallback, useEffect, useState } from 'react'
import { Flag, Loader2, MessageSquareReply, Star, ThumbsUp } from 'lucide-react'
import { getCareReviews, getCareScores, reportReview, respondToReview, toggleReviewLike } from '@/app/actions/reviews.actions'
import {
  MAX_REPLY_LENGTH, MIN_REVIEWS_FOR_SCORE, REPORT_REASONS, SOURCE_LABELS, attributionLine, formatScore, hasEnoughReviews, histogramRows, subRatingLabel,
  type CareReview, type CareScoreRow, type CareSubjectType, type ReportReason, type ReviewSort,
} from '@/lib/care-score'

const PAGE_SIZE = 20

export function Stars({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5'
  return (
    <div className="flex gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`${cls} ${value >= i - 0.25 ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-border'}`} />
      ))}
    </div>
  )
}

/** Compact "★ 4.3 (12)" or "New" for lists and headers */
export function CareScoreBadge({ score }: { score: CareScoreRow | null | undefined }) {
  if (!hasEnoughReviews(score)) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">New</span>
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800" title="Care Score">
      <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {formatScore(score!.score)}
      <span className="font-medium text-amber-700/80">({score!.review_count})</span>
    </span>
  )
}

/** Score, 5→1 histogram and attributed reviews with replies for one center or staff member */
export function CareScorePanel({
  subjectType, subjectId, canRespond = false, emptyTitle = 'No Care Score ratings yet.', emptyHint,
}: {
  subjectType: CareSubjectType
  subjectId: string
  /** The viewer is the one reviewed and may reply */
  canRespond?: boolean
  emptyTitle?: string
  emptyHint?: string
}) {
  const [score, setScore] = useState<CareScoreRow | null>(null)
  const [reviews, setReviews] = useState<CareReview[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<ReviewSort>('recent')

  const load = useCallback(async () => {
    setLoading(true)
    const [s, r] = await Promise.all([
      getCareScores(subjectType, [subjectId]),
      getCareReviews(subjectType, subjectId, PAGE_SIZE, 0, sort),
    ])
    setScore(s.scores[subjectId] ?? null)
    setReviews(r.reviews)
    setHasMore(r.reviews.length === PAGE_SIZE)
    setError(r.error ?? s.error ?? null)
    setLoading(false)
  }, [subjectType, subjectId, sort])

  useEffect(() => { load() }, [load])

  async function loadMore() {
    setLoadingMore(true)
    const r = await getCareReviews(subjectType, subjectId, PAGE_SIZE, reviews.length, sort)
    setReviews(prev => [...prev, ...r.reviews])
    setHasMore(r.reviews.length === PAGE_SIZE)
    setLoadingMore(false)
  }

  if (loading) {
    return <div className="h-48 animate-pulse rounded-[1.5rem] border border-border bg-white" />
  }

  const total = score?.review_count ?? 0
  const rated = hasEnoughReviews(score)
  const unanswered = canRespond ? reviews.filter(r => !r.response_body).length : 0

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-6 rounded-[1.5rem] border border-border bg-white p-6 sm:grid-cols-[auto,1fr]">
        <div className="flex flex-col items-center justify-center sm:min-w-40 sm:border-r sm:border-border sm:pr-6">
          <div className="text-xs font-black uppercase tracking-widest text-muted">Care Score</div>
          {rated ? (
            <>
              <div className="mt-1 text-5xl font-black text-heading">{formatScore(score!.score)}</div>
              <Stars value={score!.score ?? 0} size="lg" />
            </>
          ) : (
            <div className="mt-2 rounded-full bg-brand-50 px-4 py-1.5 text-lg font-black text-brand-700">New</div>
          )}
          <div className="mt-2 text-center text-xs text-muted">
            {total === 0 ? 'No ratings yet' : `${total} rating${total === 1 ? '' : 's'}`}
            {!rated && total > 0 && <> · score shows at {MIN_REVIEWS_FOR_SCORE}</>}
          </div>
        </div>

        <div className="space-y-1.5" aria-label="Ratings by star">
          {histogramRows(score?.histogram).map(row => (
            <div key={row.star} className="flex items-center gap-3 text-sm">
              <span className="flex w-8 items-center gap-0.5 font-bold text-text-main">{row.star}<Star className="h-3 w-3 fill-amber-400 text-amber-400" /></span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.round(row.share * 100)}%` }} />
              </div>
              <span className="w-8 text-right text-xs font-bold text-muted">{row.count}</span>
            </div>
          ))}
        </div>
      </div>

      {score && (Object.keys(score.sub_scores ?? {}).length > 0 || Object.keys(score.by_source ?? {}).length > 1) && (
        <div className="grid gap-4 rounded-[1.5rem] border border-border bg-white p-6 sm:grid-cols-2">
          {Object.keys(score.by_source ?? {}).length > 1 && (
            <div>
              <div className="mb-2 text-xs font-black uppercase tracking-widest text-muted">By who reviewed</div>
              <div className="space-y-1.5">
                {Object.entries(score.by_source).map(([src, v]) => v && (
                  <div key={src} className="flex items-center justify-between text-sm">
                    <span className="text-text-main">{SOURCE_LABELS[src as keyof typeof SOURCE_LABELS] ?? src}</span>
                    <span className="flex items-center gap-1 font-bold text-heading">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {Number(v.average).toFixed(1)}
                      <span className="font-medium text-muted">({v.count})</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {Object.keys(score.sub_scores ?? {}).length > 0 && (
            <div>
              <div className="mb-2 text-xs font-black uppercase tracking-widest text-muted">Details</div>
              <div className="space-y-1.5">
                {Object.entries(score.sub_scores).map(([key, v]) => (
                  <div key={key} className="flex items-center gap-3 text-sm">
                    <span className="w-40 shrink-0 truncate text-text-main">{subRatingLabel(key)}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round((Number(v.average) / 5) * 100)}%` }} />
                    </div>
                    <span className="w-14 text-right text-xs font-bold text-muted">{Number(v.average).toFixed(1)} ({v.count})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] text-subtle sm:col-span-2">Breakdowns are plain averages and are not part of the Care Score.</p>
        </div>
      )}

      {canRespond && unanswered > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-800">
          <MessageSquareReply className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            You have {unanswered} review{unanswered === 1 ? '' : 's'} without a reply. Replying is optional, but a short,
            professional reply shows centers you take feedback seriously.
          </p>
        </div>
      )}

      {reviews.length === 0 ? (
        <div className="rounded-[2rem] border-2 border-dashed border-border bg-white py-16 text-center">
          <Star className="mx-auto mb-3 h-10 w-10 text-subtle" />
          <p className="text-sm font-bold text-muted">{emptyTitle}</p>
          {emptyHint && <p className="mt-1 text-xs text-subtle">{emptyHint}</p>}
        </div>
      ) : (
        <div className="grid gap-4">
          {reviews.length > 1 && (
            <div className="flex justify-end gap-1 text-xs font-bold" role="group" aria-label="Sort reviews">
              {(['recent', 'helpful'] as const).map(s => (
                <button key={s} type="button" onClick={() => setSort(s)} aria-pressed={sort === s}
                  className={`rounded-full px-3 py-1 ${sort === s ? 'bg-heading text-white' : 'border border-border bg-white text-text-main hover:bg-surface'}`}>
                  {s === 'recent' ? 'Most recent' : 'Most helpful'}
                </button>
              ))}
            </div>
          )}
          {reviews.map(review => (
            <ReviewCard key={review.id} review={review} canRespond={canRespond} onReplied={load} />
          ))}
          {hasMore && (
            <button type="button" onClick={loadMore} disabled={loadingMore} className="mx-auto flex items-center gap-2 rounded-xl border border-border bg-white px-5 py-2.5 text-sm font-bold text-text-main hover:bg-surface disabled:opacity-50">
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />} Show more reviews
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ReviewCard({ review, canRespond, onReplied }: { review: CareReview; canRespond: boolean; onReplied: () => void }) {
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState(review.response_body ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liked, setLiked] = useState(review.liked_by_me)
  const [likes, setLikes] = useState(review.like_count)
  const [liking, setLiking] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reported, setReported] = useState(review.reported_by_me)
  const date = new Date(review.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  const lowRating = review.rating <= 2

  async function save() {
    setSaving(true)
    setError(null)
    const res = await respondToReview(review.id, text)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    setReplying(false)
    onReplied()
  }

  async function like() {
    setLiking(true)
    const res = await toggleReviewLike(review.id)
    setLiking(false)
    if ('error' in res && res.error) { setError(res.error); return }
    if ('liked' in res) { setLiked(!!res.liked); setLikes(res.likeCount ?? 0) }
  }

  return (
    <div className="rounded-[1.5rem] border border-border bg-white p-6 transition-shadow hover:shadow-md">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-bold text-text-main">{attributionLine(review) || 'CareLocal member'}</div>
          <div className="text-xs text-muted">
            {date}{review.punctual === false && ' · Arrived late'}
            {review.source === 'parent' && <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 font-bold text-sky-700">Parent review</span>}
          </div>
        </div>
        <Stars value={review.rating} />
      </div>

      {review.tags && review.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {review.tags.map(tag => (
            <span key={tag} className="rounded-lg border border-brand-100 bg-brand-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-brand-600">{tag}</span>
          ))}
        </div>
      )}

      {review.sub_ratings && Object.keys(review.sub_ratings).length > 0 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {Object.entries(review.sub_ratings).map(([k, v]) => (
            <span key={k}>{subRatingLabel(k)} <span className="font-bold text-text-main">{v}★</span></span>
          ))}
        </div>
      )}

      {review.public_comment && (
        <p className="mt-3 rounded-xl border border-border bg-surface p-4 text-sm italic text-text-muted">&ldquo;{review.public_comment}&rdquo;</p>
      )}

      {review.response_body && !replying && (
        <div className="ml-4 mt-4 border-l-2 border-brand-200 pl-4">
          <div className="text-xs font-bold text-brand-700">Reply from {review.response_author_name ?? 'the reviewed party'}</div>
          <p className="mt-1 text-sm text-text-main">{review.response_body}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
        {!review.is_mine && (
          <button type="button" onClick={like} disabled={liking} aria-pressed={liked}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold disabled:opacity-50 ${liked ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-surface'}`}>
            <ThumbsUp className={`h-3.5 w-3.5 ${liked ? 'fill-current' : ''}`} /> Helpful{likes > 0 ? ` · ${likes}` : ''}
          </button>
        )}
        {review.is_mine && likes > 0 && <span className="text-muted">{likes} found this helpful</span>}
        {!review.is_mine && (reported
          ? <span className="inline-flex items-center gap-1 text-muted"><Flag className="h-3.5 w-3.5" /> Reported</span>
          : <button type="button" onClick={() => setReporting(true)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-bold text-muted hover:bg-surface"><Flag className="h-3.5 w-3.5" /> Report</button>)}
      </div>

      {error && !replying && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {reporting && <ReportForm reviewId={review.id} onDone={(ok) => { setReporting(false); if (ok) setReported(true) }} />}

      {canRespond && !replying && (
        <button type="button" onClick={() => setReplying(true)} className={`mt-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold ${!review.response_body && lowRating ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-border text-text-main hover:bg-surface'}`}>
          <MessageSquareReply className="h-3.5 w-3.5" /> {review.response_body ? 'Edit reply' : 'Respond to this review'}
        </button>
      )}

      {replying && (
        <div className="mt-4 space-y-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            maxLength={MAX_REPLY_LENGTH}
            placeholder="Thank them, add context or say what you'll do differently. Your reply is public and shows your name."
            className="min-h-[80px] w-full rounded-xl border border-border bg-white px-4 py-3 text-sm text-text-main focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-subtle">{text.length}/{MAX_REPLY_LENGTH}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setReplying(false); setText(review.response_body ?? ''); setError(null) }} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted hover:bg-surface">Cancel</button>
              <button type="button" onClick={save} disabled={saving || !text.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Post reply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ReportForm({ reviewId, onDone }: { reviewId: string; onDone: (reported: boolean) => void }) {
  const [reason, setReason] = useState<ReportReason | ''>('')
  const [details, setDetails] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!reason) { setError('Choose a reason.'); return }
    setSaving(true)
    setError(null)
    const res = await reportReview(reviewId, reason, details)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onDone(true)
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border bg-surface p-4">
      <div className="text-xs font-bold text-text-main">Report this review to CareLocal</div>
      <div className="grid gap-1.5">
        {REPORT_REASONS.map(r => (
          <label key={r.value} className="flex items-center gap-2 text-sm text-text-main">
            <input type="radio" name={`report-${reviewId}`} value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-brand-600" />
            {r.label}
          </label>
        ))}
      </div>
      <textarea value={details} onChange={e => setDetails(e.target.value)} maxLength={1000}
        placeholder={reason === 'other' ? 'Tell us what is wrong (required)' : 'Anything we should know? (optional)'}
        className="min-h-[60px] w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-main focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30" />
      {reason === 'child_info' && <p className="text-xs text-muted">We take the review down right away while we check it.</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => onDone(false)} className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-bold text-muted hover:bg-surface">Cancel</button>
        <button type="button" onClick={submit} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-heading px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send report
        </button>
      </div>
    </div>
  )
}

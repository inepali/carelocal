'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageSquareReply, Star } from 'lucide-react'
import { getCareReviews, getCareScores, respondToReview } from '@/app/actions/reviews.actions'
import {
  MAX_REPLY_LENGTH, MIN_REVIEWS_FOR_SCORE, attributionLine, formatScore, hasEnoughReviews, histogramRows,
  type CareReview, type CareScoreRow, type CareSubjectType,
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

  const load = useCallback(async () => {
    setLoading(true)
    const [s, r] = await Promise.all([
      getCareScores(subjectType, [subjectId]),
      getCareReviews(subjectType, subjectId, PAGE_SIZE, 0),
    ])
    setScore(s.scores[subjectId] ?? null)
    setReviews(r.reviews)
    setHasMore(r.reviews.length === PAGE_SIZE)
    setError(r.error ?? s.error ?? null)
    setLoading(false)
  }, [subjectType, subjectId])

  useEffect(() => { load() }, [load])

  async function loadMore() {
    setLoadingMore(true)
    const r = await getCareReviews(subjectType, subjectId, PAGE_SIZE, reviews.length)
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

  return (
    <div className="rounded-[1.5rem] border border-border bg-white p-6 transition-shadow hover:shadow-md">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-bold text-text-main">{attributionLine(review) || 'CareLocal member'}</div>
          <div className="text-xs text-muted">{date}{review.punctual === false && ' · Arrived late'}</div>
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

      {review.public_comment && (
        <p className="mt-3 rounded-xl border border-border bg-surface p-4 text-sm italic text-text-muted">&ldquo;{review.public_comment}&rdquo;</p>
      )}

      {review.response_body && !replying && (
        <div className="ml-4 mt-4 border-l-2 border-brand-200 pl-4">
          <div className="text-xs font-bold text-brand-700">Reply from {review.response_author_name ?? 'the reviewed party'}</div>
          <p className="mt-1 text-sm text-text-main">{review.response_body}</p>
        </div>
      )}

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

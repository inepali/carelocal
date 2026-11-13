'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, Star } from 'lucide-react'
import { parentSubmitReview } from '@/app/actions/parent-portal.actions'
import { EDIT_WINDOW_HOURS, MAX_COMMENT_LENGTH, SUB_RATING_TOPICS, personalInfoMessage, personalInfoWarnings } from '@/lib/care-score'

/** Stars, optional topic ratings and a comment. Editing is possible for 48 hours after sending. */
export function ParentReviewForm({ centerName, editing, initial }: {
  centerName: string
  editing: boolean
  initial: { rating: number; comment: string; subRatings: Record<string, number> } | null
}) {
  const router = useRouter()
  const [rating, setRating] = useState(initial?.rating ?? 0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState(initial?.comment ?? '')
  const [subRatings, setSubRatings] = useState<Record<string, number>>(initial?.subRatings ?? {})
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ held: boolean } | null>(null)
  const [pending, startTransition] = useTransition()
  const warnings = personalInfoWarnings(comment)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (rating < 1) { setError('Tap a star to rate.'); return }
    setError(null)
    startTransition(async () => {
      const res = await parentSubmitReview({ rating, comment, subRatings })
      if (!res.ok) { setError(res.error); return }
      setDone({ held: res.held })
      router.refresh()
    })
  }

  if (done) {
    return (
      <div className="mt-5 rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-800">
        <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" /> Thank you for rating {centerName}!</div>
        <p className="mt-1">
          {done.held
            ? 'Your comment seems to include personal details, so CareLocal will check it before it appears.'
            : `You can change it for the next ${EDIT_WINDOW_HOURS} hours.`}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-5">
      <div className="flex justify-center gap-1" role="radiogroup" aria-label="Overall rating">
        {[1, 2, 3, 4, 5].map(star => (
          <button key={star} type="button" role="radio" aria-checked={rating === star} aria-label={`${star} star${star === 1 ? '' : 's'}`}
            onClick={() => setRating(star)} onMouseEnter={() => setHover(star)} onMouseLeave={() => setHover(0)} className="p-1">
            <Star className={`h-10 w-10 ${(hover || rating) >= star ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-border'}`} />
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1 text-sm font-semibold text-text-main">The details <span className="font-normal text-muted">(optional)</span></div>
        <div className="divide-y divide-border rounded-xl border border-border">
          {SUB_RATING_TOPICS.parent.map(topic => (
            <div key={topic.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm text-text-main">{topic.label}</span>
              <div className="flex" role="radiogroup" aria-label={topic.label}>
                {[1, 2, 3, 4, 5].map(star => (
                  <button key={star} type="button" role="radio" aria-checked={subRatings[topic.key] === star} aria-label={`${star} star${star === 1 ? '' : 's'}`}
                    onClick={() => setSubRatings(prev => {
                      const next = { ...prev }
                      if (next[topic.key] === star) delete next[topic.key]; else next[topic.key] = star
                      return next
                    })} className="p-0.5">
                    <Star className={`h-5 w-5 ${(subRatings[topic.key] ?? 0) >= star ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-border'}`} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="parent-review-comment" className="mb-1 block text-sm font-semibold text-text-main">Comment <span className="font-normal text-muted">(optional)</span></label>
        <textarea id="parent-review-comment" value={comment} onChange={e => setComment(e.target.value)} maxLength={MAX_COMMENT_LENGTH}
          placeholder="What do you like? What could be better?"
          className="min-h-[100px] w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-text-main focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30" />
        {warnings.length > 0 && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {personalInfoMessage(warnings)}</p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 font-semibold text-white disabled:opacity-50">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? 'Update my rating' : 'Send my rating'}
      </button>
    </form>
  )
}

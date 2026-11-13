'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, Star } from 'lucide-react'
import { submitLinkReview } from '@/app/actions/review-links.actions'
import {
  EDIT_WINDOW_HOURS, MAX_COMMENT_LENGTH, SUB_RATING_TOPICS, canWriteOption, personalInfoMessage, personalInfoWarnings,
  type ReviewLinkOption,
} from '@/lib/care-score'

/** Pick how you're reviewing (as a center, as staff, as a coworker), then stars, topics and comments */
export function LinkReviewForm({ code, subjectName, options }: { code: string; subjectName: string; options: ReviewLinkOption[] }) {
  const router = useRouter()
  const [index, setIndex] = useState(() => Math.max(0, options.findIndex(o => canWriteOption(o))))
  const option = options[index]
  const existing = option.existing?.editable ? option.existing : null
  const [rating, setRating] = useState(existing?.rating ?? 0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState(existing?.public_comment ?? '')
  const [privateFeedback, setPrivateFeedback] = useState(existing?.private_feedback ?? '')
  const [subRatings, setSubRatings] = useState<Record<string, number>>(existing?.sub_ratings ?? {})
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ held: boolean } | null>(null)
  const [pending, startTransition] = useTransition()
  const warnings = personalInfoWarnings(comment)
  const writable = canWriteOption(option)

  function pick(i: number) {
    setIndex(i)
    const e = options[i].existing?.editable ? options[i].existing : null
    setRating(e?.rating ?? 0); setComment(e?.public_comment ?? ''); setPrivateFeedback(e?.private_feedback ?? '')
    setSubRatings(e?.sub_ratings ?? {}); setError(null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (rating < 1) { setError('Tap a star to rate.'); return }
    setError(null)
    startTransition(async () => {
      const res = await submitLinkReview(code, { as: option.as, orgId: option.org_id, rating, comment, privateFeedback, subRatings })
      if (!res.ok) { setError(res.error); return }
      setDone({ held: res.held })
      router.refresh()
    })
  }

  if (done) {
    return (
      <div className="text-sm text-brand-800">
        <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5 text-brand-600" /> Thank you for reviewing {subjectName}!</div>
        <p className="mt-1 text-text-muted">
          {done.held
            ? 'Your comment seems to include personal details (like a phone number or a child’s name), so CareLocal will check it before it appears.'
            : `It shows on their Care Score now. You can change it for the next ${EDIT_WINDOW_HOURS} hours.`}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {options.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-text-main">How are you reviewing?</legend>
          <div className="grid gap-2">
            {options.map((o, i) => (
              <label key={`${o.as}:${o.org_id}`} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${i === index ? 'border-brand-600 bg-brand-50' : 'border-border'}`}>
                <input type="radio" name="review-as" checked={i === index} onChange={() => pick(i)} className="accent-brand-600" />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {!writable ? (
        <p className="rounded-xl bg-surface p-4 text-sm text-text-muted">
          You reviewed {subjectName} this way recently. You can review again on{' '}
          {new Date(option.existing!.next_review_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
        </p>
      ) : (
        <>
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
              {SUB_RATING_TOPICS[option.as].map(topic => (
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
            <label htmlFor="link-review-comment" className="mb-1 block text-sm font-semibold text-text-main">Public comment <span className="font-normal text-muted">(optional)</span></label>
            <textarea id="link-review-comment" value={comment} onChange={e => setComment(e.target.value)} maxLength={MAX_COMMENT_LENGTH}
              placeholder="What is it like working with them? Please don't name children."
              className="min-h-[90px] w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-text-main focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30" />
            {warnings.length > 0 && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {personalInfoMessage(warnings)}</p>
            )}
          </div>

          <div>
            <label htmlFor="link-review-private" className="mb-1 block text-sm font-semibold text-text-main">Private feedback <span className="font-normal text-muted">(optional)</span></label>
            <textarea id="link-review-private" value={privateFeedback} onChange={e => setPrivateFeedback(e.target.value)} maxLength={MAX_COMMENT_LENGTH}
              placeholder={`Never shown to ${subjectName}. Only you and CareLocal admins can see this.`}
              className="min-h-[70px] w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-main focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30" />
          </div>

          <p className="text-xs text-muted">Your name and role are shown with your review. You can edit it for {EDIT_WINDOW_HOURS} hours, then once every 90 days you can leave a new one.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={pending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 font-semibold text-white disabled:opacity-50">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} {existing ? 'Update my review' : 'Send my review'}
          </button>
        </>
      )}
    </form>
  )
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { loadParentReviewStatus, parentTokenHash, rememberedCenterKey } from '@/lib/server/parent-portal'
import { NoCenterLink } from '../_components/SignInForm'
import { ParentReviewForm } from '../_components/ParentReviewForm'

/**
 * /parent/review: a signed-in parent rates their center (Care Score). Reached from the portal, or from the
 * center's lobby QR code (/parent/<key>?to=review), which signs the parent in first.
 */
export default async function ParentReviewPage() {
  const tokenHash = await parentTokenHash()
  const status = tokenHash ? await loadParentReviewStatus(tokenHash) : null
  if (!tokenHash || !status) {
    const key = await rememberedCenterKey()
    if (key) redirect(`/parent/${key}?to=review${tokenHash ? '&expired=1' : ''}`)
    return <NoCenterLink />
  }

  const r = status.review
  const nextAt = status.next_review_at ? new Date(status.next_review_at) : null
  const canWrite = !r || r.editable || (nextAt !== null && nextAt <= new Date())

  return (
    <div className="py-4">
      <Link href="/parent" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-text-muted">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>
      <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-heading">How is {status.center.name} doing?</h1>
        <p className="mt-1 text-sm text-text-muted">
          Your rating helps {status.center.name} improve and helps other families. It is shown as
          <span className="font-semibold text-text-main"> {status.author_name} · Parent</span>. Please don&apos;t name children or share contact details.
        </p>

        {canWrite ? (
          <ParentReviewForm
            centerName={status.center.name}
            editing={!!r?.editable}
            initial={r?.editable ? { rating: r.rating, comment: r.public_comment ?? '', subRatings: r.sub_ratings ?? {} } : null}
          />
        ) : (
          <div className="mt-5 space-y-3">
            <div className="rounded-xl bg-surface p-4 text-sm text-text-main">
              <div className="font-semibold">Your rating: {'★'.repeat(r!.rating)}{'☆'.repeat(5 - r!.rating)}</div>
              {r!.public_comment && <p className="mt-1 text-text-muted">&ldquo;{r!.public_comment}&rdquo;</p>}
              {r!.held && <p className="mt-2 text-xs text-amber-700">CareLocal is checking your comment before it appears.</p>}
              {r!.response && <p className="mt-2 border-l-2 border-brand-200 pl-3 text-xs text-text-main"><span className="font-semibold">{status.center.name}:</span> {r!.response}</p>}
            </div>
            {nextAt && (
              <p className="text-xs text-muted">
                Thank you! You can rate again on {nextAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

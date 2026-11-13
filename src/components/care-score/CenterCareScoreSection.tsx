'use client'

import { CareScorePanel } from '@/components/care-score/CareScorePanel'
import { ParentReviewQrCard } from '@/components/care-score/ParentReviewQrCard'
import { RequestReviewLinkCard } from '@/components/care-score/RequestReviewLinkCard'
import { useCenterContext } from '@/app/center/(dashboard)/context'

/** Center admin: the center's own Care Score, review links and reviews, with optional (recommended) replies. About → Care Score. */
export function CenterCareScoreSection() {
  const ctx = useCenterContext()
  const canRespond = ctx.role === 'owner' || ctx.role === 'admin'

  return (
    <div className="max-w-4xl space-y-6">
      <p className="text-sm text-muted">
        What {ctx.staffTerm.toLowerCase()} say after working shifts at your center, and what parents say. Every center on
        CareLocal can see this score. Shift reviews appear once both sides have reviewed, or 7 days after the shift.
      </p>

      {ctx.centerId && canRespond && <RequestReviewLinkCard subjectType="center" subjectId={ctx.centerId} />}
      {ctx.centerId && canRespond && <ParentReviewQrCard centerId={ctx.centerId} centerName="your center" />}

      {ctx.centerId ? (
        <CareScorePanel
          subjectType="center"
          subjectId={ctx.centerId}
          canRespond={canRespond}
          emptyTitle="No reviews yet."
          emptyHint="Reviews from staff appear here after their shifts, and from parents once they rate you."
        />
      ) : (
        <div className="h-48 animate-pulse rounded-[1.5rem] border border-border bg-white" />
      )}
    </div>
  )
}

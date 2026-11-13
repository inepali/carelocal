'use client'

import { Star } from 'lucide-react'
import { CareScorePanel } from '@/components/care-score/CareScorePanel'
import { ParentReviewQrCard } from '@/components/care-score/ParentReviewQrCard'
import { useCenterContext } from '../context'

/** Center admin: the center's own Care Score and staff reviews, with optional (recommended) replies */
export default function CenterCareScorePage() {
  const ctx = useCenterContext()
  const canRespond = ctx.role === 'owner' || ctx.role === 'admin'

  return (
    <div className="max-w-4xl space-y-6 pb-24">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black text-heading">
          <Star className="h-6 w-6 fill-amber-400 text-amber-400" /> Care Score
        </h1>
        <p className="mt-1 text-sm text-muted">
          What {ctx.staffTerm.toLowerCase()} say after working shifts at your center, and what parents say. Every center on
          CareLocal can see this score. Shift reviews appear once both sides have reviewed, or 7 days after the shift.
        </p>
      </div>

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

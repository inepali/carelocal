'use client'

import { Star } from 'lucide-react'
import { CareScorePanel } from '@/components/care-score/CareScorePanel'
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
          What {ctx.staffTerm.toLowerCase()} say after working shifts at your center. Every center on CareLocal can see this
          score. Reviews appear once both sides have reviewed the shift, or 7 days after it ends.
        </p>
      </div>

      {ctx.centerId ? (
        <CareScorePanel
          subjectType="center"
          subjectId={ctx.centerId}
          canRespond={canRespond}
          emptyTitle="No reviews yet."
          emptyHint="Reviews from staff appear here after their shifts."
        />
      ) : (
        <div className="h-48 animate-pulse rounded-[1.5rem] border border-border bg-white" />
      )}
    </div>
  )
}

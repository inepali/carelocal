'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CalendarDays, Target } from 'lucide-react'
import { useCenterContext } from '../../context'
import WeeklyLessonPlan from '@/components/lesson-plans/WeeklyLessonPlan'

/** Center admins: weekly lesson plans per class, and approving what teachers submit */
export default function CenterWeeklyLessonPlansPage() {
  const { centerId } = useCenterContext()
  // The dashboard layout renders children only after its client-side load, so reading the URL here is hydration-safe.
  const [{ programId, classId }] = useState(() => {
    const q = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
    return { programId: q?.get('program') || null, classId: q?.get('class') || null }
  })

  return (
    <div className="max-w-7xl pb-24">
      <Link href="/center/about#programs" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-brand-600 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Programs
      </Link>
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-heading mb-2 flex items-center gap-3">
            <CalendarDays className="w-8 h-8 text-brand-600" /> Weekly Lesson Plan
          </h1>
          <p className="text-muted">Teachers build each class&apos;s week from your learning areas, subjects and goals. A plan applies once you approve it.</p>
        </div>
        <Link href="/center/lesson-plans" className="inline-flex items-center gap-2 text-sm font-bold text-brand-600 hover:underline shrink-0">
          <Target className="w-4 h-4" /> Manage Subjects &amp; Goals
        </Link>
      </div>
      {centerId && <WeeklyLessonPlan centerId={centerId} mode="admin" programId={programId} defaultClassId={classId} />}
    </div>
  )
}

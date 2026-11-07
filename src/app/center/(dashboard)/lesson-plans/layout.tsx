'use client'

import { useCenterContext } from '../context'

/** Every Lesson Plans page closes when a super admin switches the module off for this center */
export default function LessonPlansLayout({ children }: { children: React.ReactNode }) {
  const { domainKey, lessonPlansEnabled } = useCenterContext()
  if (domainKey !== 'childcare' || !lessonPlansEnabled) {
    return (
      <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">
        Lesson plans aren&apos;t turned on for this center. Contact CareLocal support to turn them on.
      </div>
    )
  }
  return <>{children}</>
}

'use client'

import { CalendarClock } from 'lucide-react'
import { canManageSchedule, useCenterContext } from '../context'
import ScheduleAdmin from '@/components/schedule/ScheduleAdmin'

/** Center owners and administrators: each regular teacher's fixed weekly schedule (the daily board builds on it) */
export default function CenterSchedulePage() {
  const ctx = useCenterContext()

  return (
    <div className="max-w-7xl pb-24">
      <div className="mb-6">
        <h1 className="mb-2 flex items-center gap-3 text-3xl font-extrabold text-heading">
          <CalendarClock className="h-8 w-8 text-brand-600" /> Staff Schedule
        </h1>
        <p className="text-muted">Set each regular teacher&apos;s usual week: hours and room for every day. Anyone without fixed hours on a day comes in as a floater.</p>
      </div>
      {!canManageSchedule(ctx) ? (
        <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">
          {ctx.scheduleEnabled
            ? 'Only the center owner and administrators can plan the schedule.'
            : 'The staff schedule isn’t turned on for this center. Contact CareLocal support to try it.'}
        </div>
      ) : ctx.centerId && <ScheduleAdmin centerId={ctx.centerId} />}
    </div>
  )
}

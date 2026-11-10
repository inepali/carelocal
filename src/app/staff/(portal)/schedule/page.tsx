'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
import StaffSchedule from '@/components/schedule/StaffSchedule'
import { staffScheduleCenter, type StaffScheduleCenter } from '@/components/schedule/staffSchedule'

/** Regular employees: their week and the center's published daily schedule, read-only */
export default function StaffSchedulePage() {
  const [state, setState] = useState<StaffScheduleCenter | null>(null)
  const [date, setDate] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    // A notice links to ?date=YYYY-MM-DD
    const d = new URLSearchParams(window.location.search).get('date')
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDate(d)
    staffScheduleCenter().then(s => { if (!cancelled) setState(s) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-7xl pb-24">
      <div className="mb-6">
        <h1 className="mb-2 flex items-center gap-3 text-3xl font-extrabold text-heading">
          <CalendarClock className="h-8 w-8 text-brand-600" /> My Schedule
        </h1>
        <p className="text-muted">Your rooms and hours for the week, and who is where each day.</p>
      </div>
      {!state && <div className="flex items-center gap-2 p-10 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>}
      {state?.kind === 'blocked' && <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">{state.message}</div>}
      {state?.kind === 'ready' && <StaffSchedule key={date ?? 'today'} centerId={state.centerId} initialDate={date} />}
    </div>
  )
}

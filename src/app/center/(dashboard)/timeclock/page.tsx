'use client'

import { useCallback, useEffect, useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { TimeClockOverview } from '@/lib/timeclock'
import { canManageTimeClock, useCenterContext } from '../context'
import { Timesheet } from './_components/Timesheet'
import { TimeOffAdmin } from './_components/TimeOffAdmin'
import { StaffPins } from './_components/StaffPins'
import { Setup } from './_components/Setup'

type Tab = 'timesheet' | 'timeoff' | 'staff' | 'setup'
const TABS: [Tab, string][] = [['timesheet', 'Timesheet'], ['timeoff', 'Time off'], ['staff', 'Staff & PINs'], ['setup', 'Tablets & settings']]

/**
 * Owners and admins: the Time Clock. Pay hours come only from punches on the center's Time Clock tablet
 * (never from Live Roster check-ins). Time Card PINs are set here; staff cannot change their own.
 */
export default function TimeClockAdminPage() {
  const ctx = useCenterContext()
  const [tab, setTab] = useState<Tab>('timesheet')
  const [overview, setOverview] = useState<TimeClockOverview | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!ctx.centerId) return
    const { data, error } = await createClient().rpc('timeclock_overview', { p_center_id: ctx.centerId })
    if (error) { setError(error.message); return }
    setError('')
    setOverview(data as TimeClockOverview)
  }, [ctx.centerId])

  const allowed = canManageTimeClock(ctx)
  useEffect(() => { if (allowed) reload() }, [allowed, reload])

  // ?tab=timeoff (from a link) opens that tab
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t && TABS.some(([id]) => id === t)) setTab(t as Tab)
  }, [])

  return (
    <div className="max-w-7xl pb-24">
      <div className="mb-6">
        <h1 className="mb-2 flex items-center gap-3 text-3xl font-extrabold text-heading">
          <Clock className="h-8 w-8 text-brand-600" /> Time Clock
        </h1>
        <p className="text-muted">
          Staff clock in and out on the center&apos;s Time Clock tablet with their 4-digit Time Card PIN and ask for time off there.
          Timesheets come only from these punches; Live Roster check-ins show where teachers are and are not used for pay.
        </p>
      </div>
      {!canManageTimeClock(ctx) || !ctx.centerId ? (
        <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">
          {ctx.timeclockEnabled ? 'Only the center owner and administrators can manage the Time Clock.' : 'The Time Clock isn’t turned on for this center. Contact CareLocal support to try it.'}
        </div>
      ) : error ? (
        <div className="max-w-2xl rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
      ) : !overview ? (
        <div className="flex items-center gap-2 p-10 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
      ) : (
        <>
          <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-bold ${tab === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-text-main'}`}>
                {label}
                {id === 'staff' && overview.staff.some(s => !s.has_pin) && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{overview.staff.filter(s => !s.has_pin).length}</span>}
              </button>
            ))}
          </div>
          {tab === 'timesheet' && <Timesheet centerId={ctx.centerId} overview={overview} />}
          {tab === 'timeoff' && <TimeOffAdmin centerId={ctx.centerId} overview={overview} onChanged={reload} />}
          {tab === 'staff' && <StaffPins centerId={ctx.centerId} overview={overview} onChanged={reload} />}
          {tab === 'setup' && <Setup centerId={ctx.centerId} overview={overview} onChanged={reload} />}
        </>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CalendarDays, Loader2 } from 'lucide-react'
import WeeklyLessonPlan from '@/components/lesson-plans/WeeklyLessonPlan'
import { lessonPlansOn } from '@/lib/staff-lesson-plans'

type State =
  | { kind: 'loading' }
  | { kind: 'blocked'; message: string }
  | { kind: 'ready'; centerId: string; homeRoomId: string | null }

/** Regular teachers: build their class's weekly lesson plan and submit it for approval */
export default function StaffLessonPlansPage() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { if (!cancelled) setState({ kind: 'blocked', message: 'Please sign in again.' }); return }
      const { data: profile } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
      if (!profile) { if (!cancelled) setState({ kind: 'blocked', message: 'Your staff profile is not set up yet.' }); return }
      const { data: membership } = await supabase
        .from('center_staff')
        .select('center_id, home_work_area_id')
        .eq('staff_id', profile.id).eq('employment_class', 'regular').eq('status', 'active')
        .maybeSingle()
      const enabled = membership ? await lessonPlansOn(membership.center_id as string) : true
      if (cancelled) return
      if (!membership) {
        setState({ kind: 'blocked', message: 'Lesson plans are for regular teachers of a center. Ask your director to add you as a regular employee.' })
      } else if (!enabled) {
        setState({ kind: 'blocked', message: 'Lesson plans aren’t turned on for your center.' })
      } else {
        setState({
          kind: 'ready',
          centerId: membership.center_id as string,
          homeRoomId: (membership as { home_work_area_id?: string | null }).home_work_area_id ?? null,
        })
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-7xl pb-24">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-heading mb-2 flex items-center gap-3">
          <CalendarDays className="w-8 h-8 text-brand-600" /> Weekly Lesson Plan
        </h1>
        <p className="text-muted">Plan each day&apos;s activities, link them to your center&apos;s goals, and submit the week for your director to approve.</p>
      </div>
      {state.kind === 'loading' && <div className="flex items-center gap-2 p-10 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>}
      {state.kind === 'blocked' && <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">{state.message}</div>}
      {state.kind === 'ready' && <WeeklyLessonPlan centerId={state.centerId} mode="teacher" defaultClassId={state.homeRoomId} />}
    </div>
  )
}

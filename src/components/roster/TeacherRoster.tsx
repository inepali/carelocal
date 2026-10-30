'use client'

import { useEffect, useState } from 'react'
import { LayoutGrid, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { RosterBoard } from '@/app/center/(dashboard)/roster/_components/RosterBoard'

type State =
  | { kind: 'loading' }
  | { kind: 'blocked'; message: string }
  | { kind: 'ready'; centerId: string; homeRoomId: string | null; name: string }

/**
 * The Live Roster for a regular teacher: the staff portal (/staff/roster) and the phone app (/mobile/roster).
 * Opens on and stays with their home room; a floater (no home room) picks a room. The database decides what
 * they may see and do (can_use_roster: an active regular teacher of the center, with the roster on).
 */
export function TeacherRoster() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { if (!cancelled) setState({ kind: 'blocked', message: 'Please sign in again.' }); return }

      const { data: profile } = await supabase.from('staff_profiles').select('id, first_name, last_name').eq('user_id', user.id).maybeSingle()
      if (!profile) { if (!cancelled) setState({ kind: 'blocked', message: 'Your staff profile is not set up yet.' }); return }

      const { data: membership } = await supabase
        .from('center_staff')
        .select('center_id, status, home_work_area_id, center:centers(roster_enabled, child_files_enabled)')
        .eq('staff_id', profile.id).eq('employment_class', 'regular').eq('status', 'active')
        .maybeSingle()
      if (cancelled) return
      const center = (membership as { center?: { roster_enabled?: boolean; child_files_enabled?: boolean } | null } | null)?.center
      if (!membership) {
        setState({ kind: 'blocked', message: 'The live roster is for regular teachers of a center. Ask your director to add you as a regular employee.' })
      } else if (!center?.roster_enabled || !center?.child_files_enabled) {
        setState({ kind: 'blocked', message: 'The live roster is not turned on for your center yet.' })
      } else {
        setState({
          kind: 'ready',
          centerId: membership.center_id as string,
          homeRoomId: (membership as { home_work_area_id?: string | null }).home_work_area_id ?? null,
          name: `${profile.first_name} ${profile.last_name}`.trim(),
        })
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (state.kind === 'loading') {
    return <div className="flex items-center gap-2 p-10 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading your room…</div>
  }
  if (state.kind === 'blocked') {
    return (
      <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center shadow-sm">
        <LayoutGrid className="mx-auto mb-3 h-10 w-10 text-brand-200" />
        <h1 className="mb-2 text-xl font-bold text-heading">My room</h1>
        <p className="text-muted">{state.message}</p>
      </div>
    )
  }
  return <RosterBoard centerId={state.centerId} mode="teacher" homeRoomId={state.homeRoomId} viewerName={state.name} />
}

/** Whether the signed-in regular teacher's center has the roster on (for showing the menu item) */
export async function teacherRosterEnabled(): Promise<boolean> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: profile } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
  if (!profile) return false
  const { data } = await supabase
    .from('center_staff')
    .select('center:centers(roster_enabled, child_files_enabled)')
    .eq('staff_id', profile.id).eq('employment_class', 'regular').eq('status', 'active')
    .maybeSingle()
  const center = (data as { center?: { roster_enabled?: boolean; child_files_enabled?: boolean } | null } | null)?.center
  return !!center?.roster_enabled && !!center?.child_files_enabled
}

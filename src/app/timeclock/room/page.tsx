import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { deviceTokenHash, loadDevice } from '@/lib/server/timeclock'
import { clockRoomOpen } from '@/app/actions/time-clock-kiosk.actions'
import { RoomKiosk } from '../_components/RoomKiosk'

export const dynamic = 'force-dynamic'

/** My Room opened with a PIN on the Time Clock: the teacher's Live Roster until Done, idle, or 15 minutes */
export default async function TimeClockRoomPage() {
  const device = await loadDevice(await deviceTokenHash())
  if (!device || !(await clockRoomOpen())) redirect('/timeclock')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/timeclock')
  const { data: profile } = await supabase.from('staff_profiles').select('first_name, last_name').eq('user_id', user.id).maybeSingle()
  const name = profile ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() : ''
  return <RoomKiosk userName={name || 'Teacher'} />
}

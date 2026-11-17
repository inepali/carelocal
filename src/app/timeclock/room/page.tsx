import { redirect } from 'next/navigation'
import { deviceTokenHash, loadDevice } from '@/lib/server/timeclock'
import { clockRoomOpen } from '@/app/actions/time-clock-kiosk.actions'
import { RoomKiosk } from '../_components/RoomKiosk'

export const dynamic = 'force-dynamic'

/** My Room opened with a PIN on the Time Clock: the teacher's Live Roster until Done, idle, or 15 minutes */
export default async function TimeClockRoomPage() {
  const device = await loadDevice(await deviceTokenHash())
  if (!device || !(await clockRoomOpen())) redirect('/timeclock')
  return <RoomKiosk centerName={device.center.name} />
}

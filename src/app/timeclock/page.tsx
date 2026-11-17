import { Clock } from 'lucide-react'
import { deviceTokenHash, loadDevice } from '@/lib/server/timeclock'
import { TimeClock } from './_components/TimeClock'

export const dynamic = 'force-dynamic'

/**
 * /timeclock: the center's Time Clock. Works only in a browser an owner or admin set up from the dashboard
 * (Time Clock → Use this tablet); everyone else sees how to set it up.
 */
export default async function TimeClockPage() {
  const device = await loadDevice(await deviceTokenHash())
  if (!device) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
        <div className="rounded-3xl border border-border bg-white p-8 shadow-sm">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <Clock className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">This tablet is not a Time Clock</h1>
          <p className="mt-2 text-sm text-text-muted">
            An owner or administrator can set it up: on this tablet, sign in to CareLocal, open <strong>Time Clock</strong> in
            the dashboard and tap <strong>Use this tablet as the Time Clock</strong>. You are signed out right after, and
            staff then clock in and out with their 4-digit Time Card PIN.
          </p>
        </div>
      </div>
    )
  }
  return <TimeClock centerName={device.center.name} timeZone={device.center.timezone} today={device.center.today} deviceName={device.device_name} />
}

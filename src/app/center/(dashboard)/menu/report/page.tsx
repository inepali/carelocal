'use client'

import { useCenterContext } from '../../context'
import CacfpReport from '@/components/menu/CacfpReport'

/** Center owners and administrators: the monthly CACFP menu compliance report */
export default function CenterMenuReportPage() {
  const { centerId, menuPlanningEnabled } = useCenterContext()
  if (!menuPlanningEnabled) {
    return <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">Menu planning isn&apos;t turned on for this center.</div>
  }
  return <div className="max-w-7xl">{centerId && <CacfpReport centerId={centerId} backHref="/center/menu" />}</div>
}

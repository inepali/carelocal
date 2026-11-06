'use client'

import { Utensils } from 'lucide-react'
import { useCenterContext } from '../context'
import MenuPlanner from '@/components/menu/MenuPlanner'

/** Center owners and administrators: plan and publish the monthly menu */
export default function CenterMenuPage() {
  const { centerId, domainKey, menuPlanningEnabled } = useCenterContext()

  return (
    <div className="max-w-7xl pb-24">
      <div className="mb-8 print:hidden">
        <h1 className="text-3xl font-extrabold text-heading mb-2 flex items-center gap-3">
          <Utensils className="w-8 h-8 text-brand-600" /> Monthly Menu
        </h1>
        <p className="text-muted">Drag meal presets onto each day, then publish the month so your whole team can see it. Mark staff as menu editors on their team page.</p>
      </div>
      {domainKey !== 'childcare' || !menuPlanningEnabled ? (
        <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">
          Menu planning isn&apos;t turned on for this center. Contact CareLocal support to try it.
        </div>
      ) : centerId && <MenuPlanner centerId={centerId} reportHref="/center/menu/report" />}
    </div>
  )
}

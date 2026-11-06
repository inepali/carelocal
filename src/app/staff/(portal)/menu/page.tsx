'use client'

import { useEffect, useState } from 'react'
import { Loader2, Utensils } from 'lucide-react'
import MenuPlanner from '@/components/menu/MenuPlanner'
import { staffMenuCenter, type StaffMenuCenter } from '@/components/menu/staffMenuCenter'

/** Regular employees: see the center's published monthly menu; menu editors (the cook) plan it too */
export default function StaffMenuPage() {
  const [state, setState] = useState<StaffMenuCenter | null>(null)
  useEffect(() => {
    let cancelled = false
    staffMenuCenter().then(s => { if (!cancelled) setState(s) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-7xl pb-24">
      <div className="mb-8 print:hidden">
        <h1 className="text-3xl font-extrabold text-heading mb-2 flex items-center gap-3">
          <Utensils className="w-8 h-8 text-brand-600" /> Monthly Menu
        </h1>
        <p className="text-muted">What&apos;s being served each day this month.</p>
      </div>
      {!state && <div className="flex items-center gap-2 p-10 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>}
      {state?.kind === 'blocked' && <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">{state.message}</div>}
      {state?.kind === 'ready' && <MenuPlanner centerId={state.centerId} reportHref="/staff/menu/report" />}
    </div>
  )
}

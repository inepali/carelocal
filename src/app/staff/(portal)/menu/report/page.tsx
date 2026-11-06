'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import CacfpReport from '@/components/menu/CacfpReport'
import { staffMenuCenter, type StaffMenuCenter } from '@/components/menu/staffMenuCenter'

/** Regular employees (mainly the cook): the monthly CACFP menu compliance report */
export default function StaffMenuReportPage() {
  const [state, setState] = useState<StaffMenuCenter | null>(null)
  useEffect(() => {
    let cancelled = false
    staffMenuCenter().then(s => { if (!cancelled) setState(s) })
    return () => { cancelled = true }
  }, [])

  if (!state) return <div className="flex items-center gap-2 p-10 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
  if (state.kind === 'blocked') return <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">{state.message}</div>
  return <div className="max-w-7xl"><CacfpReport centerId={state.centerId} backHref="/staff/menu" /></div>
}

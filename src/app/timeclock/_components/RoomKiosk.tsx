'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LogOut } from 'lucide-react'
import { TeacherRoster } from '@/components/roster/TeacherRoster'
import { clockCloseRoom, clockRoomOpen } from '@/app/actions/time-clock-kiosk.actions'

const IDLE_MS = 3 * 60_000

/**
 * My Room on the Time Clock tablet. The teacher is signed in here only for this: Done, 3 minutes without a touch,
 * or the 15-minute limit signs them out of the tablet and goes back to the PIN pad.
 */
export function RoomKiosk({ centerName }: { centerName: string }) {
  const router = useRouter()
  const [closing, setClosing] = useState(false)
  const [left, setLeft] = useState(IDLE_MS / 1000)
  const lastTouch = useRef(Date.now())
  const closed = useRef(false)

  const close = useCallback(async () => {
    if (closed.current) return
    closed.current = true
    setClosing(true)
    try { await clockCloseRoom() } finally { router.replace('/timeclock') }
  }, [router])

  useEffect(() => {
    const touch = () => { lastTouch.current = Date.now() }
    window.addEventListener('pointerdown', touch, true)
    window.addEventListener('keydown', touch, true)
    const tick = setInterval(() => {
      const rest = Math.max(0, Math.ceil((IDLE_MS - (Date.now() - lastTouch.current)) / 1000))
      setLeft(rest)
      if (rest === 0) close()
    }, 1000)
    const limit = setInterval(async () => { if (!(await clockRoomOpen())) close() }, 60_000)
    return () => {
      window.removeEventListener('pointerdown', touch, true)
      window.removeEventListener('keydown', touch, true)
      clearInterval(tick)
      clearInterval(limit)
    }
  }, [close])

  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-border bg-white/95 px-4 py-2 backdrop-blur">
        <p className="text-sm text-text-muted">
          <span className="font-semibold text-text-main">{centerName}</span> · My Room on the Time Clock
          {left <= 60 && <span className="ml-2 font-semibold text-amber-700">Closing in {left}s</span>}
        </p>
        <button type="button" onClick={close} disabled={closing}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />} Done
        </button>
      </div>
      <div className="p-3 sm:p-5">
        <TeacherRoster />
      </div>
    </div>
  )
}

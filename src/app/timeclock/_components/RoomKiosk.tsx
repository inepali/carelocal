'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LogOut } from 'lucide-react'
import { TeacherRoster } from '@/components/roster/TeacherRoster'
import { clockCloseRoom, clockRoomOpen } from '@/app/actions/time-clock-kiosk.actions'

const IDLE_MS = 3 * 60_000

/**
 * My Room on the Time Clock tablet, laid out like My Room in the staff portal (same header and page, scrolls the
 * same way) but without the portal menu. The teacher is signed in here only for this: Done, 3 minutes without a
 * touch, or the 15-minute limit signs them out of the tablet and goes back to the PIN pad.
 */
export function RoomKiosk({ userName }: { userName: string }) {
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
    // Scrolling counts as using the page too
    const events = ['pointerdown', 'keydown', 'wheel', 'touchmove', 'scroll'] as const
    events.forEach(e => window.addEventListener(e, touch, { capture: true, passive: true }))
    const tick = setInterval(() => {
      const rest = Math.max(0, Math.ceil((IDLE_MS - (Date.now() - lastTouch.current)) / 1000))
      setLeft(rest)
      if (rest === 0) close()
    }, 1000)
    const limit = setInterval(async () => { if (!(await clockRoomOpen())) close() }, 60_000)
    return () => {
      events.forEach(e => window.removeEventListener(e, touch, { capture: true }))
      clearInterval(tick)
      clearInterval(limit)
    }
  }, [close])

  return (
    <div className="staff-shell flex min-h-screen bg-surface font-sans">
      <main className="flex min-h-screen flex-1 flex-col overflow-x-hidden">
        <header className="glass sticky top-0 z-10 flex h-20 items-center justify-between gap-4 border-b border-border px-4 md:px-8">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">My Room</div>
            <div className="truncate text-lg font-bold text-heading">{userName}</div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {left <= 60 && <span className="text-sm font-semibold text-amber-700">Closing in {left}s</span>}
            <button type="button" onClick={close} disabled={closing}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-muted transition-colors hover:border-brand-600 hover:text-brand-600 disabled:opacity-60">
              {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Done
            </button>
          </div>
        </header>
        <div className="flex-1 p-4 md:p-8">
          <TeacherRoster />
        </div>
      </main>
    </div>
  )
}

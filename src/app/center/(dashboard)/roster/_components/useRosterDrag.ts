'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { RosterPerson, RosterZone } from '@/lib/roster-ratio'

/**
 * Drag a child or teacher onto a room or zone, with mouse, finger or pen.
 *
 * Built on pointer events instead of HTML5 drag-and-drop, which never fires on iPad or inside the Capacitor
 * apps. A press only becomes a drag after the pointer moves a few pixels, so a tap still selects. While
 * dragging, a ghost headshot follows the pointer and the drop target is whatever element under it carries
 * data-drop="<roomId>|<zone>". Escape cancels.
 *
 * Tap-to-select plus the "Move to" list in the selected panel is the keyboard and screen-reader path.
 */

export interface DropTarget { work_area_id: string; zone: RosterZone }

export const dropKey = (areaId: string, zone: RosterZone) => `${areaId}|${zone}`

export function parseDropKey(key: string | null): DropTarget | null {
  if (!key) return null
  const [areaId, zone] = key.split('|')
  if (!areaId || !['home', 'classroom', 'playground', 'lobby'].includes(zone)) return null
  return { work_area_id: areaId, zone: zone as RosterZone }
}

/** What every draggable needs: pointer binding, tap-to-select and the drag state to draw itself */
export interface RosterInteract {
  bind: (p: RosterPerson) => { onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void }
  select: (p: RosterPerson) => void
  selectedId: string | null
  draggingId: string | null
  /** The drop key under the pointer, or null */
  over: string | null
  isDragging: boolean
}

const THRESHOLD_PX = 6

export function useRosterDrag(onDrop: (person: RosterPerson, target: DropTarget) => void) {
  const [dragging, setDragging] = useState<{ person: RosterPerson; x: number; y: number } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const pending = useRef<{ person: RosterPerson; x: number; y: number; id: number } | null>(null)
  const active = useRef<RosterPerson | null>(null)
  const overRef = useRef<string | null>(null)
  const suppressClick = useRef(false)
  const onDropRef = useRef(onDrop)
  useEffect(() => { onDropRef.current = onDrop }, [onDrop])

  useEffect(() => {
    const place = (x: number, y: number) => {
      const g = ghostRef.current
      if (g) g.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
    }
    const hit = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      const key = (el?.closest('[data-drop]') as HTMLElement | null)?.dataset.drop ?? null
      if (key !== overRef.current) { overRef.current = key; setOver(key) }
    }
    const finish = (drop: boolean) => {
      const person = active.current
      const key = overRef.current
      pending.current = null
      active.current = null
      overRef.current = null
      document.body.style.removeProperty('user-select')
      if (!person) return
      suppressClick.current = true                                // the click that follows a drag is not a tap
      window.setTimeout(() => { suppressClick.current = false }, 0)
      setDragging(null)
      setOver(null)
      const target = drop ? parseDropKey(key) : null
      if (target) onDropRef.current(person, target)
    }
    const onMove = (e: PointerEvent) => {
      const p = pending.current
      if (!p || e.pointerId !== p.id) return
      if (!active.current) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD_PX) return
        active.current = p.person
        document.body.style.userSelect = 'none'
        setDragging({ person: p.person, x: e.clientX, y: e.clientY })
      }
      e.preventDefault()
      place(e.clientX, e.clientY)
      hit(e.clientX, e.clientY)
    }
    const onUp = (e: PointerEvent) => { if (pending.current && e.pointerId === pending.current.id) finish(true) }
    const onCancel = (e: PointerEvent) => { if (pending.current && e.pointerId === pending.current.id) finish(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && active.current) finish(false) }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const bind = useCallback((person: RosterPerson) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      pending.current = { person, x: e.clientX, y: e.clientY, id: e.pointerId }
      if (e.pointerType === 'mouse') e.preventDefault()          // no text selection while dragging with a mouse
    },
  }), [])

  /** False for the click that ends a drag */
  const clickAllowed = useCallback(() => !suppressClick.current, [])

  return { dragging, over, ghostRef, bind, clickAllowed }
}

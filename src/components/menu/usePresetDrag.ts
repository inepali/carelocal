'use client'

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Drag a meal preset onto a day's meal slot with mouse, finger or pen.
 *
 * Pointer events, not HTML5 drag-and-drop (which never fires on iPad or inside the Capacitor apps), the same
 * approach as the Live Roster. A press becomes a drag only after the pointer moves a few pixels, so a tap still
 * selects. The drop target is the element under the pointer carrying data-menu-drop="<date>|<slot>".
 * Chips keep vertical touch scrolling (touch-action: pan-y), so on touch a drag starts sideways toward the
 * calendar. Tap a preset, then tap a slot, works everywhere and is the keyboard and screen-reader path.
 */

export interface DragState<T> { item: T; label: string }

const THRESHOLD_PX = 6

export function usePresetDrag<T>(onDrop: (item: T, dropKey: string) => void) {
  const [dragging, setDragging] = useState<DragState<T> | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const pending = useRef<{ item: T; label: string; x: number; y: number; id: number } | null>(null)
  const active = useRef<DragState<T> | null>(null)
  const overRef = useRef<string | null>(null)
  const suppressClick = useRef(false)
  const onDropRef = useRef(onDrop)
  useEffect(() => { onDropRef.current = onDrop }, [onDrop])

  useEffect(() => {
    const place = (x: number, y: number) => {
      const g = ghostRef.current
      if (g) g.style.transform = `translate(${x}px, ${y}px) translate(-50%, -120%)`
    }
    const hit = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      const key = (el?.closest('[data-menu-drop]') as HTMLElement | null)?.dataset.menuDrop ?? null
      if (key !== overRef.current) { overRef.current = key; setOver(key) }
    }
    const finish = (drop: boolean) => {
      const state = active.current
      const key = overRef.current
      pending.current = null
      active.current = null
      overRef.current = null
      document.body.style.removeProperty('user-select')
      if (!state) return
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
      setDragging(null)
      setOver(null)
      if (drop && key) onDropRef.current(state.item, key)
    }
    const onMove = (e: PointerEvent) => {
      const p = pending.current
      if (!p || e.pointerId !== p.id) return
      if (!active.current) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD_PX) return
        active.current = { item: p.item, label: p.label }
        document.body.style.userSelect = 'none'
        setDragging(active.current)
      }
      e.preventDefault()
      place(e.clientX, e.clientY)
      hit(e.clientX, e.clientY)
    }
    const onUp = (e: PointerEvent) => { if (pending.current?.id === e.pointerId) finish(true) }
    const onCancel = (e: PointerEvent) => { if (pending.current?.id === e.pointerId) finish(false) }
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

  // Place the ghost at the pointer as soon as it mounts
  useEffect(() => {
    if (dragging && pending.current) {
      const g = ghostRef.current
      if (g) g.style.transform = `translate(${pending.current.x}px, ${pending.current.y}px) translate(-50%, -120%)`
    }
  }, [dragging])

  const bind = (item: T, label: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      pending.current = { item, label, x: e.clientX, y: e.clientY, id: e.pointerId }
    },
    style: { touchAction: 'pan-y' as const },
  })

  /** Wrap a tap handler so the click that ends a drag is ignored */
  const tap = (fn: () => void) => () => { if (!suppressClick.current) fn() }

  return { bind, tap, dragging, over, ghostRef }
}

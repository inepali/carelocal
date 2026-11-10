'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AbsenceKind, DayPayload } from '@/lib/schedule'

export type DayOp =
  | { op: 'add'; center_staff_id: string; room_id: string | null; start: string; end: string; note?: string | null }
  | { op: 'update'; id: string; room_id?: string | null; start?: string; end?: string; note?: string | null }
  | { op: 'remove'; id: string }
  | { op: 'split'; id: string; at: string; room_id: string | null }
  /** a break cut out of a working box; cover (default true) also adds an empty break cover in that room */
  | { op: 'break'; id: string; start: string; end: string; cover?: boolean }
  /** a break cover in a room, empty or with someone on it */
  | { op: 'cover'; room_id: string; start: string; end: string; staff_id?: string | null }
  /** put someone on a break cover, or take them off (null) */
  | { op: 'assign'; id: string; staff_id: string | null }

/**
 * One day of the board. Opening builds the day the first time (from fixed schedules) and picks up substitute
 * shifts. Every change sends the version it saw; if someone else changed the day first, the board reloads and says so.
 * Each action resolves to an error message, or null when it worked.
 */
export function useScheduleDay(centerId: string, date: string | null) {
  const supabase = useMemo(() => createClient(), [])
  const [data, setData] = useState<DayPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dataRef = useRef<DayPayload | null>(null)
  dataRef.current = data

  const load = useCallback(async () => {
    const today = dataRef.current?.settings.today
    const { data: row, error: err } = await supabase.rpc('schedule_day_open', { p_center_id: centerId, p_date: date ?? today ?? null })
    if (err) { setError(err.message); setLoading(false); return null }
    setData(row as DayPayload)
    setError('')
    setLoading(false)
    return row as DayPayload
  }, [centerId, date, supabase])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      // The first open needs a date: ask the database for the center's today
      let day = date
      if (!day) {
        const { data: s } = await supabase.rpc('schedule_settings', { p_center_id: centerId })
        day = (s as { today?: string } | null)?.today ?? null
      }
      if (cancelled || !day) { if (!day) setLoading(false); return }
      const { data: row, error: err } = await supabase.rpc('schedule_day_open', { p_center_id: centerId, p_date: day })
      if (cancelled) return
      if (err) setError(err.message)
      else { setData(row as DayPayload); setError('') }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [centerId, date, supabase])

  /** Runs one write; the answer is the whole day, so the board redraws from it */
  const run = useCallback(async (fn: string, args: Record<string, unknown>): Promise<string | null> => {
    const current = dataRef.current
    if (!current) return 'The day is still loading.'
    setBusy(true)
    const { data: row, error: err } = await supabase.rpc(fn, { p_center_id: centerId, p_date: current.day.date, p_version: current.day.version, ...args })
    setBusy(false)
    if (err) {
      // Someone else changed it, or a box is gone: show the latest so the next try works
      if (err.code === '40001' || err.code === 'P0002') {
        const { data: fresh } = await supabase.rpc('schedule_day_open', { p_center_id: centerId, p_date: current.day.date })
        if (fresh) setData(fresh as DayPayload)
      }
      return err.message
    }
    setData(row as DayPayload)
    return null
  }, [centerId, supabase])

  const apply = useCallback((ops: DayOp[]) => run('schedule_apply', { p_ops: ops }), [run])
  const callOut = useCallback((centerStaffId: string, kind: AbsenceKind, start: string | null, end: string | null, note: string | null) =>
    run('schedule_call_out', { p_center_staff_id: centerStaffId, p_kind: kind, p_start: start, p_end: end, p_note: note }), [run])
  const undoCallOut = useCallback((centerStaffId: string) => run('schedule_call_out_undo', { p_center_staff_id: centerStaffId }), [run])
  const resetPerson = useCallback((centerStaffId: string) => run('schedule_reset_person', { p_center_staff_id: centerStaffId }), [run])
  const publish = useCallback(() => run('schedule_publish', {}), [run])

  return { data, loading, error, busy, reload: load, apply, callOut, undoCallOut, resetPerson, publish }
}

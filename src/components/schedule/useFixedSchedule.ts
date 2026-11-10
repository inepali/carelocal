'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sortBlocks, type FixedBlock, type FixedList } from '@/lib/schedule'

/** Every regular teacher's fixed weekly schedule as it stands on a day (default: the center's today) */
export function useFixedSchedule(centerId: string, on: string | null) {
  const supabase = useMemo(() => createClient(), [])
  const [data, setData] = useState<FixedList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const { data: row, error: err } = await supabase.rpc('schedule_fixed_list', { p_center_id: centerId, p_on: on })
    if (err) { setError(err.message); setLoading(false); return }
    const list = row as FixedList
    setData({ ...list, staff: list.staff.map(s => ({ ...s, blocks: sortBlocks(s.blocks) })) })
    setError('')
    setLoading(false)
  }, [centerId, on, supabase])

  useEffect(() => { reload() }, [reload])

  /** Replace one teacher's pattern from a date on; resolves to an error message, or null when saved */
  const save = useCallback(async (centerStaffId: string, effectiveFrom: string, blocks: FixedBlock[]): Promise<string | null> => {
    const { error: err } = await supabase.rpc('schedule_fixed_save', {
      p_center_staff_id: centerStaffId,
      p_effective_from: effectiveFrom,
      p_blocks: blocks.map(b => ({ weekday: b.weekday, start: b.start, end: b.end, room_id: b.room_id, notes: b.notes?.trim() || null })),
    })
    if (err) return err.message
    await reload()
    return null
  }, [reload, supabase])

  /** The board's hours and weekends; resolves to an error message, or null when saved */
  const saveSettings = useCallback(async (dayStart: string, dayEnd: string, weekends: boolean): Promise<string | null> => {
    const { error: err } = await supabase.rpc('schedule_settings_save', {
      p_center_id: centerId, p_day_start: dayStart, p_day_end: dayEnd, p_weekends: weekends,
    })
    if (err) return err.message
    await reload()
    return null
  }, [centerId, reload, supabase])

  return { data, loading, error, reload, save, saveSettings }
}

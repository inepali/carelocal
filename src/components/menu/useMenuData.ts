'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  ALL_SLOTS, type ClosedDay, type FoodItem, type MealPreset, type MealSlot, type MenuEntry, type MenuMonth,
  monthEnd,
} from '@/lib/menu'

export interface MenuSettings {
  slots: MealSlot[]
  cacfpEnabled: boolean
  centerName: string
}

/** The center's food library and presets (shared across months) */
export function useMenuLibrary(centerId: string) {
  const supabase = useMemo(() => createClient(), [])
  const [foods, setFoods] = useState<FoodItem[]>([])
  const [presets, setPresets] = useState<MealPreset[]>([])
  const [settings, setSettings] = useState<MenuSettings>({ slots: ['breakfast', 'lunch', 'pm_snack'], cacfpEnabled: false, centerName: '' })
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const [f, p, c, e] = await Promise.all([
      supabase.from('menu_food_items').select('id, center_id, name, component, whole_grain_rich, grain_dessert, allergens, is_active, sort_order')
        .eq('center_id', centerId).order('component').order('sort_order').order('name'),
      supabase.from('menu_presets').select('id, center_id, name, meal_types, notes, is_active, sort_order, items:menu_preset_items(food_item_id, serving_note, sort_order)')
        .eq('center_id', centerId).order('sort_order').order('name'),
      supabase.from('centers').select('name, menu_slots, cacfp_enabled').eq('id', centerId).maybeSingle(),
      supabase.rpc('can_edit_menu', { p_center_id: centerId }),
    ])
    const err = f.error ?? p.error ?? c.error
    if (err) setError(err.message)
    setFoods((f.data ?? []) as FoodItem[])
    setPresets((p.data ?? []) as unknown as MealPreset[])
    if (c.data) {
      const served = ((c.data.menu_slots as string[] | null) ?? []).filter((s): s is MealSlot => (ALL_SLOTS as string[]).includes(s))
      setSettings({
        slots: ALL_SLOTS.filter(s => served.includes(s)),
        cacfpEnabled: !!c.data.cacfp_enabled,
        centerName: (c.data.name as string) ?? '',
      })
    }
    setCanEdit(e.data === true)
    setLoading(false)
  }, [centerId, supabase])

  useEffect(() => { reload() }, [reload])

  const foodMap = useMemo(() => new Map(foods.map(f => [f.id, f])), [foods])
  return { supabase, foods, foodMap, presets, settings, canEdit, loading, error, setError, reload }
}

/** One month's entries, closed days and publish status */
export function useMenuMonth(centerId: string, month: string) {
  const supabase = useMemo(() => createClient(), [])
  const [entries, setEntries] = useState<MenuEntry[]>([])
  const [closed, setClosed] = useState<ClosedDay[]>([])
  const [monthRow, setMonthRow] = useState<MenuMonth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const end = monthEnd(month)
    const [e, c, m] = await Promise.all([
      supabase.from('menu_entries').select('id, center_id, service_date, slot, preset_id, preset_name, items, note')
        .eq('center_id', centerId).gte('service_date', month).lte('service_date', end),
      supabase.from('menu_closed_days').select('center_id, service_date, reason')
        .eq('center_id', centerId).gte('service_date', month).lte('service_date', end),
      supabase.from('menu_months').select('center_id, month, status, published_at, published_by_name')
        .eq('center_id', centerId).eq('month', month).maybeSingle(),
    ])
    const err = e.error ?? c.error ?? m.error
    setError(err ? err.message : '')
    setEntries((e.data ?? []) as MenuEntry[])
    setClosed((c.data ?? []) as ClosedDay[])
    setMonthRow((m.data ?? null) as MenuMonth | null)
    setLoading(false)
  }, [centerId, month, supabase])

  useEffect(() => { setLoading(true); reload() }, [reload])

  return { entries, setEntries, closed, setClosed, monthRow, setMonthRow, loading, error, setError, reload }
}

// Self-contained on purpose (type-only imports, no path aliases), like src/lib/children.ts.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RosterPerson, RosterRoom } from './roster-ratio'

/**
 * Every read the Live Roster board makes. Each function takes the CALLER's Supabase client, so the database
 * decides access (owner, admin or regular teacher of the center, with the roster and Child Files on).
 * Writes go through roster_apply() only (phase 3).
 */

type Failure = { success: false; error: string }

export function friendlyRosterError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return 'Something went wrong.'
  if (error.code === '42501') return 'The live roster is not turned on for your center, or you do not have access to it.'
  return error.message?.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong.'
}

const ROOM_COLUMNS = 'id, name, capacity, ratio_children, min_age_months, max_age_months'

export interface RosterData {
  success: true
  day: string
  rooms: RosterRoom[]
  people: RosterPerson[]
}

/** Rooms on the roster (in the center's own order), everyone the board shows, and the center's "today" */
export async function loadRoster(supabase: SupabaseClient, centerId: string): Promise<RosterData | Failure> {
  const [rooms, snapshot, today] = await Promise.all([
    supabase.from('work_areas').select(ROOM_COLUMNS)
      .eq('center_id', centerId).eq('is_active', true).eq('on_roster', true)
      .order('sort_order').order('name'),
    supabase.rpc('roster_snapshot', { p_center_id: centerId }),
    supabase.rpc('roster_today', { p_center_id: centerId }),
  ])
  if (snapshot.error) return { success: false, error: friendlyRosterError(snapshot.error) }
  if (rooms.error) return { success: false, error: friendlyRosterError(rooms.error) }
  if (today.error) return { success: false, error: friendlyRosterError(today.error) }
  return {
    success: true,
    day: today.data as string,
    rooms: (rooms.data ?? []) as RosterRoom[],
    people: (snapshot.data ?? []) as RosterPerson[],
  }
}

/** One roster_presence row as Realtime delivers it */
export interface PresenceRow {
  center_id: string
  service_date: string
  child_id: string | null
  staff_id: string | null
  work_area_id: string | null
  zone: RosterPerson['zone']
  updated_at: string
}

/**
 * Apply one Realtime change to the board's people. Returns null when the change is for someone the board
 * does not know yet (a new enrollment, a sub's first check-in) or for another day: the board reloads then.
 */
export function applyPresence(people: RosterPerson[], row: PresenceRow, day: string): RosterPerson[] | null {
  if (row.service_date !== day) return null
  const id = row.child_id ?? row.staff_id
  const i = people.findIndex(p => p.person_id === id)
  if (i < 0) return null
  const next = people.slice()
  next[i] = { ...people[i], work_area_id: row.work_area_id, zone: row.zone, updated_at: row.updated_at }
  return next
}

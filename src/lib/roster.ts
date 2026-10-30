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

// ─── Writing ─────────────────────────────────────────────────────────────────

export interface RosterMove { work_area_id: string | null; zone: RosterPerson['zone'] }

/**
 * Put one child or teacher in a room and zone, or send them home (check out), through roster_apply().
 * `clientKey` is a fresh id per tap: if the request is retried, the database applies it once.
 */
export async function moveOnRoster(
  supabase: SupabaseClient,
  centerId: string,
  person: Pick<RosterPerson, 'kind' | 'person_id'>,
  to: RosterMove,
  clientKey: string,
): Promise<{ success: true; row: PresenceRow | null } | Failure> {
  const { data, error } = await supabase.rpc('roster_apply', {
    p_center_id: centerId,
    p_child_id: person.kind === 'child' ? person.person_id : null,
    p_staff_id: person.kind === 'staff' ? person.person_id : null,
    p_area_id: to.work_area_id,
    p_zone: to.zone,
    p_client_key: clientKey,
  })
  if (error) return { success: false, error: friendlyRosterError(error) }
  const row = data as PresenceRow | null
  return { success: true, row: row && row.service_date ? row : null }
}

// ─── The day's log ───────────────────────────────────────────────────────────

export interface RosterEvent {
  id: number
  at: string
  action: 'check_in' | 'check_out' | 'move_room' | 'move_zone'
  child_id: string | null
  staff_id: string | null
  from_area_id: string | null
  to_area_id: string | null
  from_zone: RosterPerson['zone']
  to_zone: RosterPerson['zone']
}

/** Every check-in, check-out and move on one day, newest first */
export async function loadRosterEvents(supabase: SupabaseClient, centerId: string, day: string, limit = 500): Promise<{ success: true; events: RosterEvent[] } | Failure> {
  const { data, error } = await supabase.from('roster_events')
    .select('id, at, action, child_id, staff_id, from_area_id, to_area_id, from_zone, to_zone')
    .eq('center_id', centerId).eq('service_date', day)
    .order('at', { ascending: false }).order('id', { ascending: false })
    .limit(limit)
  if (error) return { success: false, error: friendlyRosterError(error) }
  return { success: true, events: (data ?? []) as RosterEvent[] }
}

// ─── Child card ──────────────────────────────────────────────────────────────

/** The room teacher (or a director) marks a child toilet trained (true), in diapers (false) or by age (null) */
export async function setToiletTrained(supabase: SupabaseClient, centerId: string, childId: string, value: boolean | null): Promise<{ success: true; mode: 'diaper' | 'bathroom' } | Failure> {
  const { data, error } = await supabase.rpc('daily_set_toilet_trained', { p_center_id: centerId, p_child_id: childId, p_value: value })
  if (error) return { success: false, error: friendlyRosterError(error) }
  return { success: true, mode: data as 'diaper' | 'bathroom' }
}

/** One child's check-ins and check-outs for a day, oldest first, for "Today at a glance" */
export async function loadChildDayEvents(supabase: SupabaseClient, centerId: string, childId: string, day: string): Promise<{ success: true; events: Pick<RosterEvent, 'action' | 'at'>[] } | Failure> {
  const { data, error } = await supabase.from('roster_events').select('action, at')
    .eq('center_id', centerId).eq('service_date', day).eq('child_id', childId)
    .in('action', ['check_in', 'check_out']).order('at')
  if (error) return { success: false, error: friendlyRosterError(error) }
  return { success: true, events: (data ?? []) as Pick<RosterEvent, 'action' | 'at'>[] }
}

// Self-contained on purpose (type-only imports, no path aliases) so the tests can load it with plain node.
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Attendance exports for the Live Roster: the database builds the rows (roster_attendance and
 * roster_moves_export, owner and admins only, times in the center's time zone); this file turns them into a
 * CSV that opens cleanly in Excel and Google Sheets.
 */

export interface AttendanceRow {
  service_date: string
  kind: 'child' | 'staff'
  person_id: string
  first_name: string | null
  last_name: string | null
  role: string
  home_room: string | null
  status: 'Present' | 'Not checked out' | 'Absent'
  first_in: string | null
  last_out: string | null
  minutes_on_site: number | null
  rooms: string | null
  moves: number
}

export interface MoveRow {
  service_date: string
  local_time: string
  kind: 'child' | 'staff'
  first_name: string | null
  last_name: string | null
  action: string
  from_room: string | null
  from_zone: string | null
  to_room: string | null
  to_zone: string | null
  at: string
}

type Failure = { success: false; error: string }

const friendly = (e: { code?: string; message?: string }) =>
  e.code === '42501' ? 'Only the owner and administrators can export attendance.' : (e.message?.replace(/^.*?ERROR:\s*/, '') || 'Could not build the export.')

export async function loadAttendance(supabase: SupabaseClient, centerId: string, from: string, to: string, includeStaff: boolean): Promise<{ success: true; rows: AttendanceRow[] } | Failure> {
  const { data, error } = await supabase.rpc('roster_attendance', { p_center_id: centerId, p_from: from, p_to: to, p_include_staff: includeStaff })
  if (error) return { success: false, error: friendly(error) }
  return { success: true, rows: (data ?? []) as AttendanceRow[] }
}

export async function loadMoves(supabase: SupabaseClient, centerId: string, from: string, to: string): Promise<{ success: true; rows: MoveRow[] } | Failure> {
  const { data, error } = await supabase.rpc('roster_moves_export', { p_center_id: centerId, p_from: from, p_to: to })
  if (error) return { success: false, error: friendly(error) }
  return { success: true, rows: (data ?? []) as MoveRow[] }
}

/** "8:05" from 485 minutes; blank when unknown */
export function hoursMinutes(minutes: number | null | undefined) {
  if (minutes == null) return ''
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * One CSV cell. Quotes when needed, doubles quotes, and puts a ' in front of anything a spreadsheet would run
 * as a formula (=, +, -, @), so a name can never execute in Excel.
 */
export function csvCell(value: unknown) {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** A whole CSV: a byte-order mark so Excel reads accents, then the header and rows, Windows line endings */
export function toCsv(header: string[], rows: unknown[][]) {
  return '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function attendanceCsv(rows: AttendanceRow[]) {
  return toCsv(
    ['Date', 'First name', 'Last name', 'Role', 'Home room', 'Status', 'Checked in', 'Checked out', 'Hours on site', 'Rooms', 'Moves'],
    rows.map(r => [r.service_date, r.first_name, r.last_name, r.role, r.home_room, r.status, r.first_in, r.last_out, hoursMinutes(r.minutes_on_site), r.rooms, r.moves]),
  )
}

export function movesCsv(rows: MoveRow[]) {
  return toCsv(
    ['Date', 'Time', 'First name', 'Last name', 'Child or staff', 'What happened', 'From room', 'From', 'To room', 'To'],
    rows.map(r => [r.service_date, r.local_time, r.first_name, r.last_name, r.kind === 'child' ? 'Child' : 'Staff', r.action, r.from_room, r.from_zone, r.to_room, r.to_zone]),
  )
}

/** attendance_2026-10-30.csv, or attendance_2026-10-01_to_2026-10-30.csv for a range */
export function exportFileName(kind: 'attendance' | 'moves', from: string, to: string) {
  return `${kind}_${from === to ? from : `${from}_to_${to}`}.csv`
}

/** Saves a CSV in the browser */
export function downloadCsv(fileName: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

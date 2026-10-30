'use client'

import { useState } from 'react'
import { Download, FileSpreadsheet, Loader2, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { attendanceCsv, downloadCsv, exportFileName, loadAttendance, loadMoves, movesCsv } from '@/lib/roster-export'

const shift = (day: string, days: number) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Download attendance for a day or a range (up to 62 days), as a spreadsheet:
 *  - Attendance: one row per child per open day, Present / Not checked out / Absent, in and out times, hours,
 *    rooms. Staff optional.
 *  - All moves: every check-in, check-out and move with its time.
 */
export function ExportDialog({ supabase, centerId, today, onClose }: {
  supabase: SupabaseClient
  centerId: string
  today: string
  onClose: () => void
}) {
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [staff, setStaff] = useState(false)
  const [busy, setBusy] = useState<'attendance' | 'moves' | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const presets = [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: shift(today, -1), to: shift(today, -1) },
    { label: 'Last 7 days', from: shift(today, -6), to: today },
    { label: 'This month', from: `${today.slice(0, 8)}01`, to: today },
  ]

  async function run(kind: 'attendance' | 'moves') {
    setBusy(kind)
    setMessage(null)
    let csv: string | null = null
    let count = 0
    let error: string | null = null
    if (kind === 'attendance') {
      const res = await loadAttendance(supabase, centerId, from, to, staff)
      if (res.success) { csv = attendanceCsv(res.rows); count = res.rows.length } else error = res.error
    } else {
      const res = await loadMoves(supabase, centerId, from, to)
      if (res.success) { csv = movesCsv(res.rows); count = res.rows.length } else error = res.error
    }
    setBusy(null)
    if (error || csv == null) { setMessage({ tone: 'error', text: error ?? 'Could not build the export.' }); return }
    if (count === 0) { setMessage({ tone: 'error', text: 'Nothing was recorded on the roster for those days.' }); return }
    downloadCsv(exportFileName(kind, from, to), csv)
    setMessage({ tone: 'ok', text: `Downloaded ${count} ${count === 1 ? 'row' : 'rows'}.` })
  }

  const FIELD = 'min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-text-main'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="export-h"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="w-full max-w-md rounded-3xl border border-border bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id="export-h" className="flex items-center gap-2 text-xl font-black text-heading"><FileSpreadsheet className="h-5 w-5 text-brand-600" /> Export attendance</h2>
            <p className="mt-1 text-[13px] text-muted">A spreadsheet file for your records. Times are in your center&apos;s time zone.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-surface"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="flex flex-wrap gap-2">
            {presets.map(p => {
              const on = p.from === from && p.to === to
              return (
                <button key={p.label} type="button" onClick={() => { setFrom(p.from); setTo(p.to) }} aria-pressed={on}
                  className={`min-h-9 rounded-full border px-3 text-[13px] font-semibold ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-text-main hover:bg-surface'}`}>
                  {p.label}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[13px] font-semibold text-text-main">From
              <input type="date" value={from} max={today} onChange={e => setFrom(e.target.value)} className={`${FIELD} mt-1`} />
            </label>
            <label className="text-[13px] font-semibold text-text-main">To
              <input type="date" value={to} max={today} onChange={e => setTo(e.target.value)} className={`${FIELD} mt-1`} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-main">
            <input type="checkbox" checked={staff} onChange={e => setStaff(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Include teachers and substitutes in the attendance sheet
          </label>

          {message && <p role="status" className={`rounded-lg px-3 py-2 text-sm font-semibold ${message.tone === 'ok' ? 'bg-[#e2f2ea] text-[#17603f]' : 'bg-[#fce4e2] text-[#a3221b]'}`}>{message.text}</p>}
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">
          <button type="button" disabled={!!busy} onClick={() => run('moves')}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-bold text-text-main hover:bg-surface disabled:opacity-50">
            {busy === 'moves' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} All moves
          </button>
          <button type="button" disabled={!!busy} onClick={() => run('attendance')}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy === 'attendance' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Attendance sheet
          </button>
        </div>
      </div>
    </div>
  )
}

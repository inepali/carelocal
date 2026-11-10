'use client'

import { useState } from 'react'
import { Loader2, Settings2, X } from 'lucide-react'
import { formatTime, fromMinutes, toMinutes, type ScheduleSettings } from '@/lib/schedule'

const FIELD = 'min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-text-main'
const QUARTERS = Array.from({ length: 24 * 4 }, (_, i) => fromMinutes(i * 15))

/** Owner/admin: the hours the board covers and whether the center works weekends. The snap is set by CareLocal. */
export function ScheduleSettingsDialog({ settings, onSave, onClose }: {
  settings: ScheduleSettings
  onSave: (dayStart: string, dayEnd: string, weekends: boolean) => Promise<string | null>
  onClose: () => void
}) {
  const [start, setStart] = useState(settings.day_start)
  const [end, setEnd] = useState(settings.day_end)
  const [weekends, setWeekends] = useState(settings.weekends)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const invalid = toMinutes(end) <= toMinutes(start)

  async function save() {
    setBusy(true)
    setError('')
    const err = await onSave(start, end, weekends)
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="sched-settings-h"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="w-full max-w-md rounded-3xl border border-border bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id="sched-settings-h" className="flex items-center gap-2 text-xl font-black text-heading"><Settings2 className="h-5 w-5 text-brand-600" /> Schedule settings</h2>
            <p className="mt-1 text-[13px] text-muted">The hours your schedule board covers, left to right.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-surface"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[13px] font-semibold text-text-main">Day starts
              <select value={start} onChange={e => setStart(e.target.value)} className={`${FIELD} mt-1`}>
                {QUARTERS.map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
              </select>
            </label>
            <label className="text-[13px] font-semibold text-text-main">Day ends
              <select value={end} onChange={e => setEnd(e.target.value)} className={`${FIELD} mt-1`}>
                {QUARTERS.map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-main">
            <input type="checkbox" checked={weekends} onChange={e => setWeekends(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            We&apos;re open Saturday and Sunday (show weekends)
          </label>
          <p className="text-[13px] text-muted">Times snap to {settings.slot_minutes} minutes. Ask CareLocal support to change that.</p>
          {(invalid || error) && <p role="alert" className="rounded-lg bg-[#fce4e2] px-3 py-2 text-sm font-semibold text-[#a3221b]">{invalid ? 'The day has to end after it starts.' : error}</p>}
        </div>
        <div className="flex flex-col gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-bold text-text-main hover:bg-surface">Cancel</button>
          <button type="button" disabled={busy || invalid} onClick={save}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}

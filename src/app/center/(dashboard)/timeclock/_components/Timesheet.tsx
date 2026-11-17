'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'
import {
  addDays, buildTimesheet, dayInZone, entriesCsv, fmtHours, formatMinutes, hhmmInZone, minutesToHours, periodFor, shiftPeriod,
  timeInZone, timesheetCsv, zonedToIso, type PayPeriod, type TimeClockOverview, type TimeEntry, type TimeOff,
} from '@/lib/timeclock'
import { BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD, LBL, Modal } from '../../children/_components/ui'

const fmtDay = (day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${day}T00:00:00Z`))

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

type Editing = { entry: TimeEntry | null; staffId: string }

/** Hours per person for a pay period, with every punch, fixes for missed clock-outs, and CSV for payroll */
export function Timesheet({ centerId, overview }: { centerId: string; overview: TimeClockOverview }) {
  const { settings, timezone, today } = overview
  const [period, setPeriod] = useState<PayPeriod>(() => periodFor(today, settings.period_anchor, settings.pay_period))
  const [entries, setEntries] = useState<TimeEntry[] | null>(null)
  const [timeOff, setTimeOff] = useState<TimeOff[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<Editing | null>(null)

  useEffect(() => { setPeriod(periodFor(today, settings.period_anchor, settings.pay_period)) }, [today, settings.period_anchor, settings.pay_period])

  const load = useCallback(async () => {
    const supabase = createClient()
    const [e, t] = await Promise.all([
      supabase.rpc('timeclock_entries', { p_center_id: centerId, p_from: period.start, p_to: period.end }),
      supabase.rpc('timeclock_off_list', { p_center_id: centerId, p_from: period.start, p_to: period.end }),
    ])
    if (e.error || t.error) { setError((e.error ?? t.error)!.message); return }
    setError('')
    setEntries(e.data as TimeEntry[])
    setTimeOff(t.data as TimeOff[])
  }, [centerId, period.start, period.end])
  useEffect(() => { setEntries(null); load() }, [load])

  const rows = useMemo(() => buildTimesheet(entries ?? [], timeOff, period), [entries, timeOff, period])
  const missed = (entries ?? []).filter(e => e.missed_out)
  const clockedIn = (entries ?? []).filter(e => !e.clock_out && !e.missed_out)
  const isCurrent = period.start <= today && today <= period.end

  async function remove(e: TimeEntry) {
    if (!await showConfirm(`Delete ${e.name}'s period on ${fmtDay(e.day)} (${timeInZone(e.clock_in, timezone)}${e.clock_out ? ` – ${timeInZone(e.clock_out, timezone)}` : ''})?`, { title: 'Delete time entry', confirmLabel: 'Delete', tone: 'danger' })) return
    const reason = await showPrompt('Why? (kept in the history)', '', { title: 'Delete time entry' })
    if (!reason) return
    const { error } = await createClient().rpc('timeclock_entry_delete', { p_center_id: centerId, p_entry_id: e.id, p_reason: reason })
    if (error) { showAlert(error.message); return }
    load()
  }

  const byPerson = (id: string) => (entries ?? []).filter(e => e.center_staff_id === id && !e.missed_out && e.day >= period.start && e.day <= period.end)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className={BTN_QUIET_SM} onClick={() => setPeriod(p => shiftPeriod(p, settings.pay_period, -1))} aria-label="Previous period"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-56 text-center">
            <p className="font-bold text-heading">{fmtDay(period.start, { month: 'short', day: 'numeric' })} – {fmtDay(period.end, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
            <p className="text-xs text-muted">{settings.pay_period === 'biweekly' ? 'Every 2 weeks' : 'Weekly'} pay period{isCurrent ? ' · current' : ''}</p>
          </div>
          <button className={BTN_QUIET_SM} onClick={() => setPeriod(p => shiftPeriod(p, settings.pay_period, 1))} disabled={isCurrent} aria-label="Next period"><ChevronRight className="h-4 w-4" /></button>
          {!isCurrent && <button className={BTN_QUIET_SM} onClick={() => setPeriod(periodFor(today, settings.period_anchor, settings.pay_period))}>Current</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={BTN_QUIET} onClick={() => setEditing({ entry: null, staffId: '' })}><Plus className="h-4 w-4" /> Add time</button>
          <button className={BTN_QUIET} disabled={!entries} onClick={() => download(`timesheet-${period.start}.csv`, timesheetCsv(rows, period))}><Download className="h-4 w-4" /> Hours CSV</button>
          <button className={BTN_QUIET} disabled={!entries} onClick={() => download(`punches-${period.start}.csv`, entriesCsv(entries ?? [], period, timezone))}><Download className="h-4 w-4" /> Punches CSV</button>
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {missed.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 font-bold text-amber-900"><TriangleAlert className="h-4 w-4" /> Missed clock-outs</p>
          <p className="mt-1 text-sm text-amber-800">These were left open for more than 16 hours. Set the time they left so the hours count.</p>
          <ul className="mt-3 space-y-2">
            {missed.map(e => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm">
                <span><strong>{e.name}</strong> · {fmtDay(e.day)} · in at {timeInZone(e.clock_in, timezone)}</span>
                <button className={BTN_QUIET_SM} onClick={() => setEditing({ entry: e, staffId: e.center_staff_id })}><Pencil className="h-3.5 w-3.5" /> Set clock-out</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isCurrent && clockedIn.length > 0 && (
        <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-heading">Clocked in now ({clockedIn.length})</p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {clockedIn.map(e => <span key={e.id}><span className="font-semibold text-text-main">{e.name}</span> since {timeInZone(e.clock_in, timezone)}{e.day !== today ? ` (${fmtDay(e.day)})` : ''}</span>)}
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
        {!entries ? (
          <div className="flex items-center gap-2 p-8 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-muted">No time in this pay period yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                {rows[0].weeks.map((w, i) => <th key={w.start} className="px-3 py-3 text-right">Week {i + 1}</th>)}
                <th className="px-3 py-3 text-right">Regular</th>
                <th className="px-3 py-3 text-right">Overtime</th>
                <th className="px-3 py-3 text-right">PTO</th>
                <th className="px-3 py-3 text-right">Sick</th>
                <th className="px-3 py-3 text-right">Unpaid</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <Fragment key={r.center_staff_id}>
                  <tr className="cursor-pointer hover:bg-surface/60" onClick={() => setOpen(o => ({ ...o, [r.center_staff_id]: !o[r.center_staff_id] }))}>
                    <td className="px-4 py-3 font-semibold text-text-main">
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronDown className={`h-4 w-4 text-muted transition ${open[r.center_staff_id] ? '' : '-rotate-90'}`} />{r.name}
                      </span>
                      {(r.missed > 0 || r.open > 0) && (
                        <span className="ml-2 text-xs font-normal text-amber-700">{[r.missed && `${r.missed} missed`, r.open && 'clocked in'].filter(Boolean).join(' · ')}</span>
                      )}
                    </td>
                    {r.weeks.map(w => <td key={w.start} className={`px-3 py-3 text-right tabular-nums ${w.overtime ? 'font-bold text-amber-700' : ''}`}>{fmtHours(minutesToHours(w.minutes))}</td>)}
                    <td className="px-3 py-3 text-right tabular-nums">{fmtHours(minutesToHours(r.regular))}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${r.overtime ? 'font-bold text-amber-700' : 'text-muted'}`}>{fmtHours(minutesToHours(r.overtime))}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{r.pto ? fmtHours(r.pto) : '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{r.sick ? fmtHours(r.sick) : '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{r.unpaid ? fmtHours(r.unpaid) : '—'}</td>
                    <td className="px-3 py-3 text-right">
                      <button className={BTN_QUIET_SM} onClick={ev => { ev.stopPropagation(); setEditing({ entry: null, staffId: r.center_staff_id }) }}><Plus className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                  {open[r.center_staff_id] && (
                    <tr className="bg-surface/40">
                      <td colSpan={7 + r.weeks.length} className="px-4 py-3">
                        {byPerson(r.center_staff_id).length === 0 ? <p className="text-muted">No punches in this period.</p> : (
                          <ul className="divide-y divide-border rounded-xl border border-border bg-white">
                            {byPerson(r.center_staff_id).map(e => (
                              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                                <span>
                                  <span className="inline-block w-28 font-medium">{fmtDay(e.day)}</span>
                                  {timeInZone(e.clock_in, timezone)} – {e.clock_out ? timeInZone(e.clock_out, timezone) : <em className="text-amber-700">still clocked in</em>}
                                  {e.clock_out && <span className="ml-3 text-muted">{formatMinutes((Date.parse(e.clock_out) - Date.parse(e.clock_in)) / 60000)} h</span>}
                                  {e.clock_out && dayInZone(e.clock_out, timezone) !== e.day && <span className="ml-2 text-xs text-muted">(next day)</span>}
                                  {(e.source === 'admin' || e.edited) && <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-xs text-muted">{e.source === 'admin' ? 'added by admin' : 'edited'}</span>}
                                </span>
                                <span className="flex gap-1.5">
                                  <button className={BTN_QUIET_SM} onClick={() => setEditing({ entry: e, staffId: e.center_staff_id })}><Pencil className="h-3.5 w-3.5" /> Edit</button>
                                  <button className={BTN_QUIET_SM} onClick={() => remove(e)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5 text-red-600" /></button>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-muted">
        Hours count by the day someone clocked in. Overtime is time over 40 hours in a 7-day week of the pay period. PTO, Sick and
        Unpaid are approved time off, Monday to Friday. Every fix is kept in the entry&apos;s history with your name and reason.
      </p>

      {editing && (
        <EntryDialog centerId={centerId} overview={overview} editing={editing} defaultDay={isCurrent ? today : period.start}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
    </div>
  )
}

function EntryDialog({ centerId, overview, editing, defaultDay, onClose, onSaved }: {
  centerId: string; overview: TimeClockOverview; editing: Editing; defaultDay: string; onClose: () => void; onSaved: () => void
}) {
  const tz = overview.timezone
  const e = editing.entry
  const [staffId, setStaffId] = useState(editing.staffId)
  const [day, setDay] = useState(e?.day ?? defaultDay)
  const [inTime, setInTime] = useState(e ? hhmmInZone(e.clock_in, tz) : '08:00')
  const [outTime, setOutTime] = useState(e?.clock_out ? hhmmInZone(e.clock_out, tz) : e ? '' : '17:00')
  const [reason, setReason] = useState(e?.missed_out ? 'Forgot to clock out' : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!staffId) { setError('Pick who this is for.'); return }
    if (!inTime) { setError('Give the clock-in time.'); return }
    const clockIn = zonedToIso(day, inTime, tz)
    // A clock-out earlier than the clock-in is the next morning (an overnight period)
    let clockOut: string | null = null
    if (outTime) {
      clockOut = zonedToIso(outTime <= inTime ? addDays(day, 1) : day, outTime, tz)
    }
    setSaving(true)
    const { error } = await createClient().rpc('timeclock_entry_save', {
      p_center_id: centerId, p_entry_id: e?.id ?? null, p_center_staff_id: e ? null : staffId,
      p_clock_in: clockIn, p_clock_out: clockOut, p_reason: reason,
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved()
  }

  return (
    <Modal title={e ? `Edit ${e.name}'s time` : 'Add time'} onClose={onClose}
      footer={<>
        <button className={BTN_QUIET} onClick={onClose}>Cancel</button>
        <button className={BTN_PRIMARY} onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
      </>}>
      <div className="space-y-4">
        {!e && (
          <div>
            <label className={LBL}>Employee</label>
            <select className={FLD} value={staffId} onChange={ev => setStaffId(ev.target.value)}>
              <option value="">Pick someone…</option>
              {overview.staff.map(s => <option key={s.center_staff_id} value={s.center_staff_id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={LBL}>Day</label>
            <input type="date" className={FLD} value={day} max={overview.today} onChange={ev => setDay(ev.target.value)} />
          </div>
          <div>
            <label className={LBL}>Clock in</label>
            <input type="time" className={FLD} value={inTime} onChange={ev => setInTime(ev.target.value)} />
          </div>
          <div>
            <label className={LBL}>Clock out</label>
            <input type="time" className={FLD} value={outTime} onChange={ev => setOutTime(ev.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted">Times are in the center&apos;s time zone. Leave clock out empty if they are still working. A clock-out before the clock-in is the next morning.</p>
        <div>
          <label className={LBL}>Reason (kept in the history)</label>
          <input className={FLD} value={reason} maxLength={300} onChange={ev => setReason(ev.target.value)} placeholder="e.g. Forgot to clock out, paper timesheet" />
        </div>
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Plus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { showAlert, showPrompt } from '@/lib/dialog'
import { TIME_OFF_LABEL, addDays, fmtHours, type TimeClockOverview, type TimeOff, type TimeOffKind } from '@/lib/timeclock'
import { BTN, BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD, LBL, Modal, Pill } from '../../children/_components/ui'

const fmtDay = (day: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T00:00:00Z`))
const range = (r: Pick<TimeOff, 'start_date' | 'end_date'>) => r.start_date === r.end_date ? fmtDay(r.start_date) : `${fmtDay(r.start_date)} – ${fmtDay(r.end_date)}`
const STATUS: Record<string, [string, string]> = {
  pending: ['Waiting', 'border-amber-200 bg-amber-50 text-amber-800'],
  approved: ['Approved', 'border-emerald-200 bg-emerald-50 text-emerald-800'],
  denied: ['Denied', 'border-red-200 bg-red-50 text-red-700'],
  cancelled: ['Cancelled', 'border-border bg-surface text-muted'],
}
const VIA: Record<string, string> = { clock: 'Time Clock', portal: 'Staff portal', admin: 'Entered by admin' }

/** Waiting requests to answer, and time off from a month ago to two months ahead */
export function TimeOffAdmin({ centerId, overview, onChanged }: { centerId: string; overview: TimeClockOverview; onChanged: () => void }) {
  const [list, setList] = useState<TimeOff[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('timeclock_off_list', {
      p_center_id: centerId, p_from: addDays(overview.today, -31), p_to: addDays(overview.today, 62),
    })
    if (error) { setError(error.message); return }
    setError('')
    setList(data as TimeOff[])
  }, [centerId, overview.today])
  useEffect(() => { load() }, [load])

  async function decide(r: TimeOff, decision: 'approved' | 'denied' | 'cancelled') {
    let hours: number | null = null
    let note: string | null = null
    if (decision === 'approved') {
      const v = await showPrompt(`Approve ${r.name}'s ${TIME_OFF_LABEL[r.kind]} for ${range(r)}. Hours to count:`, String(r.hours), { title: 'Approve time off' })
      if (v == null) return
      hours = Number(v)
      if (!Number.isFinite(hours) || hours < 0 || hours > 500) { showAlert('Hours have to be a number from 0 to 500.'); return }
    } else {
      note = await showPrompt(decision === 'denied' ? `Deny ${r.name}'s request? A note for them (optional):` : `Cancel ${r.name}'s approved time off? Their schedule comes back for those days. Note (optional):`, '',
        { title: decision === 'denied' ? 'Deny time off' : 'Cancel time off', tone: 'danger' })
      if (note == null) return
    }
    setBusy(r.id)
    const { error } = await createClient().rpc('timeclock_off_decide', { p_center_id: centerId, p_request_id: r.id, p_decision: decision, p_hours: hours, p_note: note || null })
    setBusy(null)
    if (error) { showAlert(error.message); return }
    load()
    onChanged()
  }

  const waiting = (list ?? []).filter(r => r.status === 'pending')
  const others = (list ?? []).filter(r => r.status !== 'pending')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Staff ask on the Time Clock or in their CareLocal account. Approved full days mark the teacher off on the Daily Schedule.</p>
        <button className={BTN_QUIET} onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Record time off</button>
      </div>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!list ? (
        <div className="flex items-center gap-2 p-8 text-muted"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Waiting for an answer ({waiting.length})</h2>
            {waiting.length === 0 ? <p className="rounded-2xl border border-border bg-white p-6 text-center text-muted">Nothing waiting.</p> : (
              <ul className="space-y-2">
                {waiting.map(r => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm">
                    <div>
                      <p className="font-bold text-heading">{r.name} · {TIME_OFF_LABEL[r.kind]} · {range(r)}</p>
                      <p className="text-sm text-muted">
                        {fmtHours(r.hours)} h{!r.full_day ? ' (half day)' : ''} · {VIA[r.via]}{r.reason ? ` · “${r.reason}”` : ''}
                      </p>
                      {r.kind === 'pto' && r.pto && (
                        <p className={`text-xs ${r.pto.remaining < 0 ? 'font-semibold text-red-600' : 'text-muted'}`}>
                          PTO this year: {fmtHours(r.pto.yearly + r.pto.carry_over)} h · used {fmtHours(r.pto.used)} · waiting {fmtHours(r.pto.pending)} · left after waiting ones {fmtHours(r.pto.remaining)}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button className={BTN} disabled={busy === r.id} onClick={() => decide(r, 'approved')}><Check className="h-3.5 w-3.5" /> Approve</button>
                      <button className={BTN_QUIET_SM} disabled={busy === r.id} onClick={() => decide(r, 'denied')}><X className="h-3.5 w-3.5" /> Deny</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Last month to two months ahead</h2>
            {others.length === 0 ? <p className="rounded-2xl border border-border bg-white p-6 text-center text-muted">No time off.</p> : (
              <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted">
                    <tr><th className="px-4 py-3">Name</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Days</th><th className="px-3 py-3 text-right">Hours</th><th className="px-3 py-3">Status</th><th className="px-3 py-3"></th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {others.map(r => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-semibold">{r.name}</td>
                        <td className="px-3 py-3">{TIME_OFF_LABEL[r.kind]}</td>
                        <td className="px-3 py-3">{range(r)}{!r.full_day ? ' (half)' : ''}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmtHours(r.hours)}</td>
                        <td className="px-3 py-3"><Pill className={STATUS[r.status][1]}>{STATUS[r.status][0]}</Pill>{r.decision_note && <span className="ml-2 text-xs text-muted">{r.decision_note}</span>}</td>
                        <td className="px-3 py-3 text-right">
                          {r.status === 'approved' && <button className={BTN_QUIET_SM} disabled={busy === r.id} onClick={() => decide(r, 'cancelled')}>Cancel</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {adding && <AddTimeOff centerId={centerId} overview={overview} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); onChanged() }} />}
    </div>
  )
}

/** An admin records time off (a call-in sick day, PTO agreed in person): approved right away, no balance check */
function AddTimeOff({ centerId, overview, onClose, onSaved }: { centerId: string; overview: TimeClockOverview; onClose: () => void; onSaved: () => void }) {
  const [staffId, setStaffId] = useState('')
  const [kind, setKind] = useState<TimeOffKind>('sick')
  const [start, setStart] = useState(overview.today)
  const [end, setEnd] = useState(overview.today)
  const [halfDay, setHalfDay] = useState(false)
  const [hours, setHours] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!staffId) { setError('Pick who this is for.'); return }
    const h = hours.trim() === '' ? null : Number(hours)
    if (h != null && (!Number.isFinite(h) || h < 0 || h > 500)) { setError('Hours have to be a number from 0 to 500.'); return }
    setSaving(true)
    const { error } = await createClient().rpc('timeclock_off_add', {
      p_center_id: centerId, p_center_staff_id: staffId, p_kind: kind, p_start: start, p_end: end < start ? start : end,
      p_full_day: !(halfDay && start === end), p_hours: h, p_reason: reason || null,
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved()
  }

  return (
    <Modal title="Record time off" onClose={onClose}
      footer={<>
        <button className={BTN_QUIET} onClick={onClose}>Cancel</button>
        <button className={BTN_PRIMARY} onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save as approved</button>
      </>}>
      <div className="space-y-4">
        <div>
          <label className={LBL}>Employee</label>
          <select className={FLD} value={staffId} onChange={e => setStaffId(e.target.value)}>
            <option value="">Pick someone…</option>
            {overview.staff.map(s => <option key={s.center_staff_id} value={s.center_staff_id}>{s.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['sick', 'pto', 'unpaid'] as TimeOffKind[]).map(k => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`rounded-xl border px-3 py-2 text-sm font-bold ${kind === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-border bg-white text-muted'}`}>{TIME_OFF_LABEL[k]}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={LBL}>First day</label><input type="date" className={FLD} value={start} onChange={e => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value) }} /></div>
          <div><label className={LBL}>Last day</label><input type="date" className={FLD} value={end} min={start} onChange={e => setEnd(e.target.value)} /></div>
        </div>
        {start === end && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={halfDay} onChange={e => setHalfDay(e.target.checked)} /> Half day</label>
        )}
        <div>
          <label className={LBL}>Hours (leave empty: {fmtHours(overview.settings.full_day_hours)} h per weekday{halfDay ? ', halved' : ''})</label>
          <input className={FLD} inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} placeholder="Automatic" />
        </div>
        <div><label className={LBL}>Note (optional)</label><input className={FLD} value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /></div>
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}

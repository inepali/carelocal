'use client'

import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { showAlert, showConfirm } from '@/lib/dialog'
import { setTimeCardPin } from '@/app/actions/time-clock-admin.actions'
import { fmtHours, staffTypeLabel, type TimeClockOverview, type TimeClockStaff } from '@/lib/timeclock'
import { BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD, LBL, Modal, Pill } from '../../children/_components/ui'

const fmtDate = (iso: string | null) => iso ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso)) : '—'
const fmtDay = (day: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${day}T00:00:00Z`))

/** Everyone working at the center (full-time, part-time and substitutes): Time Card PIN and yearly PTO hours */
export function StaffPins({ centerId, overview, onChanged }: { centerId: string; overview: TimeClockOverview; onChanged: () => void }) {
  const [pinFor, setPinFor] = useState<TimeClockStaff | null>(null)
  const [hours, setHours] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  async function clearPin(s: TimeClockStaff) {
    if (!await showConfirm(`Turn off ${s.name}'s Time Card PIN? They cannot clock in until you set a new one.`, { title: 'Turn off PIN', confirmLabel: 'Turn off', tone: 'danger' })) return
    const { error } = await createClient().rpc('timeclock_pin_clear', { p_center_id: centerId, p_center_staff_id: s.center_staff_id })
    if (error) { showAlert(error.message); return }
    onChanged()
  }

  async function saveHours(s: TimeClockStaff) {
    const raw = hours[s.center_staff_id]
    if (raw == null) return
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(n) || n < 0 || n > 2000) { showAlert('Yearly PTO is a number of hours from 0 to 2000.'); return }
    setSaving(s.center_staff_id)
    const { error } = await createClient().rpc('timeclock_allowance_set', { p_center_id: centerId, p_center_staff_id: s.center_staff_id, p_hours: n })
    setSaving(null)
    if (error) { showAlert(error.message); return }
    setHours(h => { const { [s.center_staff_id]: _gone, ...rest } = h; return rest })
    onChanged()
  }

  const missing = overview.staff.filter(s => !s.has_pin).length
  const ptoYear = overview.settings.pto_year === 'anniversary' ? 'each person’s work anniversary' : 'the calendar year'

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Each person needs their own 4-digit PIN to use the Time Clock. Only you set it; staff cannot change it. A PIN is shown once
        when you set it, so tell them right away. {missing > 0 && <strong className="text-amber-700">{missing} without a PIN.</strong>}
      </p>
      <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-3 py-3">Time Card PIN</th>
              <th className="px-3 py-3">Yearly PTO (h)</th>
              <th className="px-3 py-3">PTO this year</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {overview.staff.map(s => {
              const edited = hours[s.center_staff_id]
              return (
                <tr key={s.center_staff_id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-text-main">{s.name}</p>
                    <p className="text-xs text-muted">{staffTypeLabel(s)}{s.start_date ? ` · since ${fmtDay(s.start_date)}` : ''}</p>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {s.has_pin
                        ? <Pill className="border-emerald-200 bg-emerald-50 text-emerald-800">Set {fmtDate(s.pin_set_at)}</Pill>
                        : <Pill className="border-amber-200 bg-amber-50 text-amber-800">No PIN</Pill>}
                      <button className={BTN_QUIET_SM} onClick={() => setPinFor(s)}><KeyRound className="h-3.5 w-3.5" /> {s.has_pin ? 'New PIN' : 'Set PIN'}</button>
                      {s.has_pin && <button className="text-xs font-semibold text-red-600 hover:underline" onClick={() => clearPin(s)}>Turn off</button>}
                    </div>
                    {s.has_pin && <p className="mt-1 text-xs text-muted">Last used {s.pin_last_used_at ? fmtDate(s.pin_last_used_at) : 'never'}</p>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <input className={`${FLD} w-24`} inputMode="decimal" value={edited ?? String(s.pto?.yearly ?? 0)}
                        onChange={e => setHours(h => ({ ...h, [s.center_staff_id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') saveHours(s) }} aria-label={`Yearly PTO hours for ${s.name}`} />
                      {edited != null && (
                        <button className={BTN_QUIET_SM} disabled={saving === s.center_staff_id} onClick={() => saveHours(s)}>
                          {saving === s.center_staff_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-muted">
                    {s.pto ? (
                      <>
                        <p><strong className="text-text-main">{fmtHours(s.pto.remaining)} h left</strong>{s.pto.pending > 0 && ` · ${fmtHours(s.pto.pending)} waiting`}</p>
                        <p className="text-xs">Used {fmtHours(s.pto.used)}{s.pto.carry_over > 0 && ` · ${fmtHours(s.pto.carry_over)} carried over`} · {fmtDay(s.pto.year_start)} – {fmtDay(s.pto.year_end)}</p>
                      </>
                    ) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">The PTO year is {ptoYear} (change it in Tablets &amp; settings). A person who leaves the center loses PIN access right away; their hours are kept.</p>
      {pinFor && <PinDialog centerId={centerId} staff={pinFor} onClose={() => setPinFor(null)} onSaved={onChanged} />}
    </div>
  )
}

function PinDialog({ centerId, staff, onClose, onSaved }: { centerId: string; staff: TimeClockStaff; onClose: () => void; onSaved: () => void }) {
  const [typed, setTyped] = useState('')
  const [pin, setPin] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save(useTyped: boolean) {
    setError('')
    setSaving(true)
    const res = await setTimeCardPin(centerId, staff.center_staff_id, useTyped ? typed : null)
    setSaving(false)
    if (!res.success) { setError(res.error); return }
    setPin(res.pin)
    onSaved()
  }

  return (
    <Modal title={`Time Card PIN for ${staff.name}`} onClose={onClose}
      footer={pin
        ? <button className={BTN_PRIMARY} onClick={onClose}>Done</button>
        : <>
            <button className={BTN_QUIET} onClick={() => save(false)} disabled={saving}>Pick one for me</button>
            <button className={BTN_PRIMARY} onClick={() => save(true)} disabled={saving || typed.length !== 4}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save this PIN</button>
          </>}>
      {pin ? (
        <div className="text-center">
          <p className="text-sm text-muted">Tell {staff.name.split(' ')[0]} this PIN now. It is not shown again.</p>
          <p className="my-4 font-mono text-5xl font-black tracking-[0.3em] text-heading">{pin}</p>
          <p className="text-xs text-muted">{staff.has_pin ? 'The old PIN no longer works.' : 'They can use the Time Clock right away.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {staff.has_pin && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Their current PIN stops working as soon as you save a new one.</p>}
          <div>
            <label className={LBL}>Type 4 digits, or let CareLocal pick</label>
            <input className={`${FLD} text-center font-mono text-2xl tracking-[0.4em]`} inputMode="numeric" maxLength={4} value={typed}
              onChange={e => setTyped(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" autoComplete="off" />
          </div>
          <p className="text-xs text-muted">Easy PINs like 1111 or 1234 are not allowed, and each person here has a different PIN.</p>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        </div>
      )}
    </Modal>
  )
}

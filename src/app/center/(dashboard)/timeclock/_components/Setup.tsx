'use client'

import { useState } from 'react'
import { Loader2, Tablet } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { showAlert, showConfirm } from '@/lib/dialog'
import { registerTimeClockDevice } from '@/app/actions/time-clock-admin.actions'
import { periodFor, type PayPeriodKind, type TimeClockOverview } from '@/lib/timeclock'
import { BTN_PRIMARY, BTN_QUIET_SM, FLD, LBL } from '../../children/_components/ui'

const fmtWhen = (iso: string | null) => iso
  ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
  : 'not yet'
const fmtDay = (day: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${day}T00:00:00Z`))

/** Time Clock tablets, and the center's pay period and PTO rules */
export function Setup({ centerId, overview, onChanged }: { centerId: string; overview: TimeClockOverview; onChanged: () => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Tablets centerId={centerId} overview={overview} onChanged={onChanged} />
      <Settings centerId={centerId} overview={overview} onChanged={onChanged} />
    </div>
  )
}

function Tablets({ centerId, overview, onChanged }: { centerId: string; overview: TimeClockOverview; onChanged: () => void }) {
  const [name, setName] = useState('Front desk')
  const [busy, setBusy] = useState(false)

  async function useThis() {
    if (!await showConfirm(
      'Make this browser the Time Clock? You will be signed out here right away so the tablet never stays signed in to your account. Staff then clock in with their PIN.',
      { title: 'Use this tablet', confirmLabel: 'Make it the Time Clock', tone: 'default' },
    )) return
    setBusy(true)
    const res = await registerTimeClockDevice(centerId, name)
    if (!res.success) { setBusy(false); showAlert(res.error); return }
    window.location.assign('/timeclock')
  }

  async function remove(id: string, label: string) {
    if (!await showConfirm(`Remove "${label}"? It stops working as the Time Clock right away.`, { title: 'Remove tablet', confirmLabel: 'Remove', tone: 'danger' })) return
    const { error } = await createClient().rpc('timeclock_device_revoke', { p_center_id: centerId, p_device_id: id })
    if (error) { showAlert(error.message); return }
    onChanged()
  }

  return (
    <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-lg font-bold text-heading"><Tablet className="h-5 w-5 text-brand-600" /> Time Clock tablets</h2>
      <p className="mt-1 text-sm text-muted">
        PINs work only on tablets set up here. On the tablet at the entrance, sign in to CareLocal, open this page and tap the
        button below. The tablet then opens <strong>/timeclock</strong>; keep that page open (add it to the home screen).
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label className={LBL}>Name for this tablet</label>
          <input className={FLD} value={name} maxLength={60} onChange={e => setName(e.target.value)} />
        </div>
        <button className={BTN_PRIMARY} onClick={useThis} disabled={busy || !name.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Use this tablet as the Time Clock
        </button>
      </div>
      <ul className="mt-5 divide-y divide-border rounded-xl border border-border">
        {overview.devices.length === 0 && <li className="p-4 text-sm text-muted">No tablets yet.</li>}
        {overview.devices.map(d => (
          <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
            <span><strong>{d.name}</strong><span className="ml-2 text-muted">set up {fmtWhen(d.created_at)} · last used {fmtWhen(d.last_seen_at)}</span></span>
            <button className={BTN_QUIET_SM} onClick={() => remove(d.id, d.name)}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Settings({ centerId, overview, onChanged }: { centerId: string; overview: TimeClockOverview; onChanged: () => void }) {
  const s = overview.settings
  const [payPeriod, setPayPeriod] = useState<PayPeriodKind>(s.pay_period)
  const [anchor, setAnchor] = useState(s.period_anchor)
  const [ptoYear, setPtoYear] = useState(s.pto_year)
  const [carry, setCarry] = useState(String(s.carryover_max_hours))
  const [dayHours, setDayHours] = useState(String(s.full_day_hours))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function save() {
    setMsg('')
    const c = Number(carry), d = Number(dayHours)
    if (!Number.isFinite(c) || c < 0 || c > 2000) { setMsg('Carry-over is 0 to 2000 hours.'); return }
    if (!Number.isFinite(d) || d <= 0 || d > 12) { setMsg('A full day is up to 12 hours.'); return }
    setSaving(true)
    const { error } = await createClient().rpc('timeclock_settings_save', {
      p_center_id: centerId, p_pay_period: payPeriod, p_period_anchor: anchor, p_pto_year: ptoYear, p_carryover_max: c, p_full_day_hours: d,
    })
    setSaving(false)
    if (error) { setMsg(error.message); return }
    setMsg('Saved.')
    onChanged()
  }

  const current = anchor ? periodFor(overview.today, anchor, payPeriod) : null
  const radio = (on: boolean) => `flex-1 rounded-xl border px-3 py-2 text-sm font-bold ${on ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-border bg-white text-muted'}`

  return (
    <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-heading">Pay period and PTO</h2>
      <div className="mt-4 space-y-4">
        <div>
          <label className={LBL}>Pay period</label>
          <div className="flex gap-2">
            <button type="button" className={radio(payPeriod === 'weekly')} onClick={() => setPayPeriod('weekly')}>Weekly</button>
            <button type="button" className={radio(payPeriod === 'biweekly')} onClick={() => setPayPeriod('biweekly')}>Every 2 weeks</button>
          </div>
        </div>
        <div>
          <label className={LBL}>A pay period starts on</label>
          <input type="date" className={FLD} value={anchor} onChange={e => setAnchor(e.target.value)} />
          {current && <p className="mt-1 text-xs text-muted">Current period: {fmtDay(current.start)} – {fmtDay(current.end)}</p>}
        </div>
        <div>
          <label className={LBL}>PTO year</label>
          <div className="flex gap-2">
            <button type="button" className={radio(ptoYear === 'calendar')} onClick={() => setPtoYear('calendar')}>Calendar year</button>
            <button type="button" className={radio(ptoYear === 'anniversary')} onClick={() => setPtoYear('anniversary')}>Work anniversary</button>
          </div>
          <p className="mt-1 text-xs text-muted">Work anniversary uses each person&apos;s employment start date (or the day they joined the center on CareLocal).</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LBL}>Carry over up to (h)</label>
            <input className={FLD} inputMode="decimal" value={carry} onChange={e => setCarry(e.target.value)} />
            <p className="mt-1 text-xs text-muted">Unused PTO into the next year. 0 = none.</p>
          </div>
          <div>
            <label className={LBL}>A full day off is (h)</label>
            <input className={FLD} inputMode="decimal" value={dayHours} onChange={e => setDayHours(e.target.value)} />
            <p className="mt-1 text-xs text-muted">A half day is half of this.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className={BTN_PRIMARY} onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save settings</button>
          {msg && <span className={`text-sm ${msg === 'Saved.' ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</span>}
        </div>
      </div>
    </section>
  )
}

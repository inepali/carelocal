'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronLeft, ChevronRight, ChevronDown, Landmark, Loader2, Receipt, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/compliance'
import { money } from '@/lib/tuition'
import { showAlert, showConfirm } from '@/lib/dialog'
import {
  BATCH_STATUS, addDays, addMonths, billingWindow, chargeMethodLabel, defaultWindowDay, loadPreview, loadRuns, submitRun,
  type BillingPreview, type PreviewChild, type RunFrequency, type RunSummary,
} from '@/lib/billing'
import { canManageTuition, useCenterContext } from '../context'
import { BTN_PRIMARY, BTN_QUIET_SM, FLD, LBL, Pill, todayISO } from '../children/_components/ui'
import { VoidBadge } from './_components/charges'

type Tab = 'run' | 'history'

/** Center owners and admins: bill the week or month, queue ACH drafts, and see past runs */
export default function BillingPage() {
  const ctx = useCenterContext()
  const [tab, setTab] = useState<Tab>('run')

  return (
    <div className="max-w-7xl pb-24">
      <div className="mb-6">
        <h1 className="mb-2 flex items-center gap-3 text-3xl font-extrabold text-heading">
          <Receipt className="h-8 w-8 text-brand-600" /> Billing
        </h1>
        <p className="text-muted">
          Bill every enrolled child for the week or month from their fees, split by who pays. Families set up for ACH are
          queued as bank drafts; everyone else pays by card, check or cash and you record it here or on the child&apos;s file.
        </p>
      </div>
      {!canManageTuition(ctx) || !ctx.centerId ? (
        <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">
          {ctx.tuitionEnabled ? 'Only the center owner and administrators can run billing.' : 'Tuition isn’t turned on for this center. Contact CareLocal support to try it.'}
        </div>
      ) : (
        <>
          <div className="mb-5 flex gap-1 border-b border-border">
            {([['run', 'Run billing'], ['history', 'Past runs']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-bold ${tab === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-text-main'}`}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'run' ? <RunBilling centerId={ctx.centerId} /> : <PastRuns centerId={ctx.centerId} />}
        </>
      )}
    </div>
  )
}

function RunBilling({ centerId }: { centerId: string }) {
  const router = useRouter()
  const [frequency, setFrequency] = useState<RunFrequency>('weekly')
  const [day, setDay] = useState(() => defaultWindowDay('weekly', todayISO()))
  const [data, setData] = useState<BillingPreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [draftDate, setDraftDate] = useState('')
  const [note, setNote] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await loadPreview(createClient(), centerId, frequency, day)
    setLoading(false)
    if (!res.success) { setError(res.error); setData(null); return }
    setError('')
    setData(res.data)
    setDraftDate(res.data.default_draft_date)
  }, [centerId, frequency, day])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  function pickFrequency(f: RunFrequency) {
    if (f === frequency) return
    setFrequency(f)
    setDay(defaultWindowDay(f, data?.today ?? todayISO()))
  }
  const pickDay = (d: string) => setDay(d)
  const step = (n: number) => pickDay(frequency === 'weekly' ? addDays(billingWindow('weekly', day).start, 7 * n) : addMonths(day, n))


  const rows = useMemo(() => (data?.children ?? []).filter(c => showAll || c.billable), [data, showAll])
  const hidden = (data?.children.length ?? 0) - (data?.children.filter(c => c.billable).length ?? 0)
  const warnings = useMemo(() => (data?.children ?? []).filter(c => c.billable && c.warnings.length), [data])
  const t = data?.totals
  // Credit payers already paid in advance: the run uses it as each charge is created
  const creditUse = useMemo(() => {
    const left = { ...(data?.credits ?? {}) }
    let total = 0
    for (const c of data?.children ?? []) for (const ch of c.charges) {
      if (!c.billable || !ch.payer_id || !left[ch.payer_id]) continue
      const use = Math.min(Number(left[ch.payer_id]), Number(ch.amount))
      left[ch.payer_id] = Number(left[ch.payer_id]) - use
      total += use
    }
    return Math.round(total * 100) / 100
  }, [data])

  async function submit() {
    if (!data || !t) return
    if (t.ach_count > 0 && (!draftDate || draftDate < data.today)) { showAlert('Pick an ACH draft date from today on.'); return }
    const lines = [
      `Bill ${t.billable} ${t.billable === 1 ? 'child' : 'children'} for the ${data.label}: ${money(t.total)}.`,
      t.ach_count > 0 ? `${t.ach_count} ACH ${t.ach_count === 1 ? 'draft' : 'drafts'} (${money(t.ach_total)}) will be queued for ${formatDate(draftDate)}.` : 'No ACH drafts.',
      t.manual_total > 0 ? `${money(t.manual_total)} is to be paid by card, check, cash or other.` : '',
      warnings.length ? `${warnings.length} ${warnings.length === 1 ? 'child has' : 'children have'} warnings.` : '',
      'Each bill is posted to the child’s billing history.',
    ].filter(Boolean)
    if (!await showConfirm(lines.join('\n'), { title: 'Submit billing run', confirmLabel: 'Submit' })) return
    setSubmitting(true)
    const res = await submitRun(createClient(), centerId, frequency, data.period_start, t.total, t.ach_count > 0 ? draftDate : null, note)
    setSubmitting(false)
    if (!res.success) { showAlert(res.error); load(); return }
    router.push(`/center/billing/runs/${res.data}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div>
          <span className={LBL}>Billing</span>
          <div className="inline-flex rounded-xl border border-border p-0.5">
            {(['weekly', 'monthly'] as const).map(f => (
              <button key={f} onClick={() => pickFrequency(f)}
                className={`rounded-lg px-4 py-2 text-sm font-bold ${frequency === f ? 'bg-brand-600 text-white' : 'text-muted hover:bg-surface'}`}>
                {f === 'weekly' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={LBL}>{frequency === 'weekly' ? 'Week' : 'Month'}</span>
          <div className="flex items-center gap-1.5">
            <button className={BTN_QUIET_SM} onClick={() => step(-1)} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></button>
            {frequency === 'weekly'
              ? <input type="date" className={`${FLD} w-44`} value={billingWindow('weekly', day).start} onChange={e => e.target.value && pickDay(e.target.value)} aria-label="Any day in the week" />
              : <input type="month" className={`${FLD} w-44`} value={day.slice(0, 7)} onChange={e => e.target.value && pickDay(`${e.target.value}-01`)} aria-label="Month" />}
            <button className={BTN_QUIET_SM} onClick={() => step(1)} aria-label="Next"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex gap-1.5 pb-0.5">
          {([0, 1] as const).map(n => {
            const today = data?.today ?? todayISO()
            const target = frequency === 'weekly' ? addDays(billingWindow('weekly', today).start, 7 * n) : addMonths(today, n)
            const on = billingWindow(frequency, day).start === billingWindow(frequency, target).start
            return (
              <button key={n} onClick={() => pickDay(target)}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold ${on ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-border text-muted hover:bg-surface'}`}>
                {n === 0 ? (frequency === 'weekly' ? 'This week' : 'This month') : (frequency === 'weekly' ? 'Next week' : 'Next month')}
              </button>
            )
          })}
        </div>
        {data && (
          <div className="pb-2 text-sm text-muted">
            {data.period_start > data.today ? <b className="text-text-main">Prepay · </b> : null}
            {formatDate(data.period_start)} – {formatDate(data.period_end)}
            {frequency === 'weekly' ? ' · weekly fees, plus every-2-weeks fees that start this week' : ' · monthly fees'} · one-time fees dated in the window ·
            children starting any day in it are included
          </div>
        )}
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{error}</div>}
      {loading && !data && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>}

      {data && t && (
        <>
          {data.runs.some(r => r.status === 'submitted') && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-3 text-sm text-sky-900">
              The {data.label} was already billed{' '}
              {data.runs.filter(r => r.status === 'submitted').map((r, i) => (
                <span key={r.id}>{i > 0 && ', '}<Link className="font-bold underline" href={`/center/billing/runs/${r.id}`}>{money(r.total)} for {r.child_count} {r.child_count === 1 ? 'child' : 'children'}</Link></span>
              ))}. Running it again bills only what is still unbilled (children or one-time fees added since).
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
              <h2 className="font-bold text-heading">{t.billable} {t.billable === 1 ? 'child' : 'children'} to bill · {data.label}</h2>
              {hidden > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
                  Show {hidden} enrolled {hidden === 1 ? 'child' : 'children'} with nothing to bill
                </label>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="p-10 text-center text-sm text-muted">Nothing to bill for the {data.label}. Fees are set on each child&apos;s Fee &amp; Payment tab.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-5 py-2.5">Child</th>
                      <th className="px-3 py-2.5">Who pays</th>
                      <th className="px-3 py-2.5 text-right">Billing amount</th>
                      <th className="px-3 py-2.5 text-right">Discount</th>
                      <th className="px-5 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map(c => <ChildRow key={c.child_id} c={c} periodStart={data.period_start} credits={data.credits ?? {}} open={!!open[c.child_id]} toggle={() => setOpen(o => ({ ...o, [c.child_id]: !o[c.child_id] }))} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
            <div className="space-y-4">
              {warnings.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                  <div className="mb-2 flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> Check before submitting</div>
                  <ul className="space-y-1">
                    {warnings.map(c => c.warnings.map((w, i) => <li key={`${c.child_id}-${i}`}><b>{c.name}:</b> {w}</li>))}
                  </ul>
                </div>
              )}
              {t.ach_count > 0 && (
                <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
                  <div className="mb-3 flex items-center gap-2 font-bold text-heading"><Landmark className="h-4 w-4 text-brand-600" /> ACH drafts</div>
                  <p className="mb-3 text-sm text-muted">
                    {t.ach_count} {t.ach_count === 1 ? 'family is' : 'families are'} set up for ACH (bank details and a signed authorization on file).
                    Submitting queues {t.ach_count === 1 ? 'its draft' : 'their drafts'}; the owner then downloads the bank file from the run.
                    {!data.center_bank && ' Add the center’s bank account first (About → Center Profile).'}
                  </p>
                  <label className={LBL}>Draft date</label>
                  <input type="date" className={`${FLD} w-48`} min={data.today} value={draftDate} onChange={e => setDraftDate(e.target.value)} />
                  <p className="mt-1.5 text-xs text-muted">Drafts take 2–3 banking days to reach the center&apos;s account.</p>
                </div>
              )}
              <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
                <label className={LBL}>Note on this run <span className="font-normal text-muted">(optional)</span></label>
                <input className={FLD} maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Thanksgiving week" />
              </div>
            </div>

            <div className="h-fit rounded-2xl border border-border bg-white p-5 shadow-sm">
              <h3 className="mb-3 font-bold text-heading">Totals</h3>
              <dl className="space-y-2 text-sm">
                <Row label="Billing amount" value={money(t.list)} />
                <Row label="Discount" value={t.discount > 0 ? `−${money(t.discount)}` : money(0)} />
                <Row label="Total" value={money(t.total)} strong />
                {t.by_frequency.biweekly > 0 && <Row label="… every-2-weeks fees" value={money(t.by_frequency.biweekly)} muted />}
                {t.by_frequency.one_time > 0 && <Row label="… one-time fees" value={money(t.by_frequency.one_time)} muted />}
                {Number(t.adjustments) > 0 && <Row label="… one-time discounts (in Discount)" value={`−${money(t.adjustments)}`} muted />}
                <div className="my-3 border-t border-border" />
                <Row label={`ACH drafts (${t.ach_count})`} value={money(t.ach_total)} />
                <Row label="Card / check / cash / other" value={money(t.manual_total)} />
                {t.unassigned_total > 0 && <Row label="… no payer set" value={money(t.unassigned_total)} muted />}
                {creditUse > 0 && <Row label="Paid from credit on file" value={`−${money(creditUse)}`} />}
                <div className="my-3 border-t border-border" />
                <div className="flex items-baseline justify-between">
                  <dt className="font-bold text-heading">Grand Total {frequency === 'weekly' ? 'Weekly' : 'Monthly'}</dt>
                  <dd className="text-2xl font-black text-heading">{money(t.total)}</dd>
                </div>
              </dl>
              <button className={`${BTN_PRIMARY} mt-5 w-full`} disabled={submitting || loading || t.billable === 0} onClick={submit}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit billing run
              </button>
              <p className="mt-2 text-xs text-muted">Amounts are worked out again when you submit. If anything changed since this preview, you&apos;ll be asked to review it again.</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? 'pl-3 text-xs text-muted' : ''}`}>
      <dt className={strong ? 'font-bold text-heading' : muted ? '' : 'text-muted'}>{label}</dt>
      <dd className={strong ? 'font-bold text-heading' : ''}>{value}</dd>
    </div>
  )
}

function ChildRow({ c, periodStart, credits, open, toggle }: { c: PreviewChild; periodStart: string; credits: Record<string, number>; open: boolean; toggle: () => void }) {
  return (
    <>
      <tr className={`align-top ${c.billable ? '' : 'text-muted'}`}>
        <td className="px-5 py-3">
          <button onClick={toggle} className="flex items-start gap-1.5 text-left" aria-expanded={open}>
            {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>
              <Link href={`/center/children/${c.child_id}`} className="font-semibold text-text-main hover:underline" onClick={e => e.stopPropagation()}>{c.name}</Link>
              <span className="block text-xs text-muted">
                {c.classroom ?? 'No home room'}
                {c.withdrawn_on ? ` · withdrawn ${formatDate(c.withdrawn_on)}` : ''}
                {c.enrolled_on >= periodStart ? <span className="ml-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px font-semibold text-emerald-800">New · starts {formatDate(c.enrolled_on)}</span> : null}
                {c.skipped.length > 0 ? ' · already billed' : ''}
              </span>
            </span>
          </button>
          {c.warnings.length > 0 && c.billable && <AlertTriangle className="ml-6 mt-1 h-3.5 w-3.5 text-amber-600" aria-label="Has warnings" />}
        </td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap gap-1">
            {c.charges.map((ch, i) => (
              <Pill key={i} className={ch.method === 'unassigned' ? 'border-red-200 bg-red-50 text-red-700'
                : ch.ach_ready ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-border bg-surface text-text-main'}>
                {ch.payer_name} · {chargeMethodLabel(ch.method)}{ch.method === 'ach' && !ch.ach_ready ? ' (by hand)' : ''} · {money(ch.amount)}
                {ch.payer_id && Number(credits[ch.payer_id]) > 0 ? ` · ${money(Math.min(Number(credits[ch.payer_id]), ch.amount))} from credit` : ''}
              </Pill>
            ))}
            {!c.billable && <span className="text-xs">{c.warnings[0] ?? 'Nothing to bill'}</span>}
          </div>
        </td>
        <td className="px-3 py-3 text-right">{money(c.list)}</td>
        <td className="px-3 py-3 text-right">{c.discount > 0 ? `−${money(c.discount)}` : '—'}</td>
        <td className="px-5 py-3 text-right font-semibold">{money(c.total)}</td>
      </tr>
      {open && (
        <tr className="bg-surface/60">
          <td colSpan={5} className="px-5 pb-4 pt-1">
            {c.lines.length === 0 ? <p className="pl-6 text-xs text-muted">No fees in this window.</p> : (
              <table className="ml-6 w-[calc(100%-1.5rem)] text-xs">
                <tbody>
                  {c.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="py-1">{l.fee_name}{l.discount_label ? <span className="text-muted"> · {l.discount_label}</span> : null}</td>
                      <td className="py-1 text-muted">{l.frequency === 'one_time' ? formatDate(l.period_start) : l.frequency === 'adjustment' ? 'One-time' : `${formatDate(l.period_start)} – ${formatDate(l.period_end)}`}</td>
                      <td className="py-1 text-right">{l.frequency === 'adjustment' ? '' : money(l.list)}</td>
                      <td className="py-1 text-right">{l.discount > 0 ? `−${money(l.discount)}` : ''}</td>
                      <td className="py-1 text-right font-semibold">{money(l.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {c.charges.filter(ch => ch.problem).map((ch, i) => <p key={i} className="ml-6 mt-1 text-xs text-amber-700">{ch.payer_name}: {ch.problem}</p>)}
          </td>
        </tr>
      )}
    </>
  )
}

function PastRuns({ centerId }: { centerId: string }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    loadRuns(createClient(), centerId).then(res => {
      if (!live) return
      if (res.success) setRuns(res.data); else setError(res.error)
    })
    return () => { live = false }
  }, [centerId])

  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{error}</div>
  if (!runs) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
  if (!runs.length) return <div className="rounded-2xl border border-border bg-white p-10 text-center text-sm text-muted shadow-sm">No billing runs yet.</div>

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-5 py-2.5">Period</th>
            <th className="px-3 py-2.5">Children</th>
            <th className="px-3 py-2.5 text-right">Total</th>
            <th className="px-3 py-2.5 text-right">Paid</th>
            <th className="px-3 py-2.5 text-right">Due</th>
            <th className="px-3 py-2.5">ACH</th>
            <th className="px-5 py-2.5">Submitted</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {runs.map(r => (
            <tr key={r.id} className={r.status === 'void' ? 'text-muted' : ''}>
              <td className="px-5 py-3">
                <Link href={`/center/billing/runs/${r.id}`} className="font-semibold text-brand-700 hover:underline">{r.label[0].toUpperCase() + r.label.slice(1)}</Link>
                <span className="ml-2 text-xs text-muted">{r.frequency === 'weekly' ? 'Weekly' : 'Monthly'}</span>
                {r.status === 'void' && <span className="ml-2"><VoidBadge /></span>}
              </td>
              <td className="px-3 py-3">{r.child_count}</td>
              <td className="px-3 py-3 text-right">{money(r.total)}</td>
              <td className="px-3 py-3 text-right">{money(r.paid)}</td>
              <td className="px-3 py-3 text-right font-semibold">{r.status === 'void' ? '—' : money(r.balance)}</td>
              <td className="px-3 py-3 text-xs">{r.ach ? `${BATCH_STATUS[r.ach.status]} · ${money(r.ach_total)}` : '—'}</td>
              <td className="px-5 py-3 text-xs text-muted">{formatDate(r.submitted_at)} · {r.submitted_by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

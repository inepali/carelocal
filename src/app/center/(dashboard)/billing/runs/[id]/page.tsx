'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Ban, Check, CheckCircle2, ChevronDown, ChevronRight, CreditCard, Download, Landmark, Loader2, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/compliance'
import { money } from '@/lib/tuition'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'
import { BATCH_STATUS, loadRun, markBatch, sumMoney, voidRun, type AchBatch, type Charge, type RunBill, type RunDetail } from '@/lib/billing'
import { exportAchBatch, sendAchBatchBySftp } from '@/app/actions/billing-ach.actions'
import { BANK_PRESETS, type AchSettingsData } from '@/lib/ach-banks'
import { canManageTuition, useCenterContext } from '../../../context'
import { BTN, BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD, LBL, Modal } from '../../../children/_components/ui'
import { ChargeList, ChargeStatusPill, RecordPaymentDialog, VoidBadge } from '../../_components/charges'

/** One billing run: totals, the three collection steps (Submit Billing → Run ACH → Run Credit Card), and every child's bill */
export default function BillingRunPage() {
  const { id } = useParams<{ id: string }>()
  const ctx = useCenterContext()
  const [data, setData] = useState<RunDetail | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<'all' | 'due' | 'ach' | 'card'>('all')
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    const res = await loadRun(createClient(), id)
    if (!res.success) { setError(res.error); return }
    setError('')
    setData(res.data)
  }, [id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  if (!canManageTuition(ctx)) return <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">Only the center owner and administrators can see billing.</div>
  if (error) return <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-sm text-muted">{error}</div>
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>

  const { run } = data
  const voided = run.status === 'void'
  const title = run.label[0].toUpperCase() + run.label.slice(1)
  const bills = data.bills.filter(b => filter === 'all' ? true
    : filter === 'due' ? b.balance > 0
    : filter === 'ach' ? b.charges.some(c => c.method === 'ach')
    : b.charges.some(c => c.method === 'credit_card'))
  const cardCharges = data.bills.filter(b => !b.voided).flatMap(b => b.charges.filter(c => c.method === 'credit_card' && c.status !== 'void').map(c => ({ bill: b, charge: c })))
  const cardTotal = sumMoney(cardCharges.map(x => x.charge.amount))

  async function doVoid() {
    const reason = await showPrompt(`Void the billing run for the ${run.label}? Every bill in it is marked void (kept in the history) and the fees can be billed again. Give a reason.`, '', { title: 'Void billing run', tone: 'danger', confirmLabel: 'Void run' })
    if (reason == null) return
    if (!reason.trim()) { showAlert('Give a reason for voiding the run.'); return }
    const res = await voidRun(createClient(), run.id, reason)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  return (
    <div className="max-w-7xl space-y-4 pb-24">
      <Link href="/center/billing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-text-main"><ArrowLeft className="h-4 w-4" /> Billing</Link>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-extrabold text-heading">
            {run.frequency === 'weekly' ? 'Weekly' : 'Monthly'} billing · {title} {voided && <VoidBadge />}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {formatDate(run.period_start)} – {formatDate(run.period_end)} · {run.child_count} {run.child_count === 1 ? 'child' : 'children'} ·
            submitted {formatDate(run.submitted_at)} by {run.submitted_by}{run.note ? ` · ${run.note}` : ''}
          </p>
          {voided && <p className="mt-1 text-sm text-red-700">Voided {formatDate(run.voided_at)} by {run.voided_by}: {run.void_reason}</p>}
        </div>
        {data.is_owner && !voided && <button className={BTN_QUIET} onClick={doVoid}><Ban className="h-4 w-4" /> Void run</button>}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <Stat label="Billing amount" value={money(run.list_total)} />
        <Stat label="Discount" value={run.discount_total > 0 ? `−${money(run.discount_total)}` : money(0)} />
        <Stat label={`Grand Total ${run.frequency === 'weekly' ? 'Weekly' : 'Monthly'}`} value={money(run.total)} strong />
        <Stat label={run.credit_total ? `By ACH · ${money(run.credit_total)} from credit` : 'By ACH'} value={money(run.ach_total)} />
        <Stat label="By card on file" value={money(cardTotal)} />
        <Stat label="Paid" value={money(run.paid)} />
        <Stat label="Still due" value={voided ? '—' : money(run.balance)} strong />
      </div>

      {!voided && (
        <div className="space-y-3">
          <Step n={1} title="Submit Billing" done>
            <p className="text-sm text-muted">
              Billed {formatDate(run.submitted_at)} by {run.submitted_by}: {money(run.total)} for {run.child_count} {run.child_count === 1 ? 'child' : 'children'} ·
              {' '}ACH {money(run.ach_total)} · card on file {money(cardTotal)} · the rest by check, cash or other
            </p>
          </Step>
          <Step n={2} title="Run ACH" done={!run.ach || run.ach.status === 'settled' || run.ach.status === 'void'}>
            {run.ach
              ? <AchCard batch={run.ach} centerId={ctx.centerId} isOwner={data.is_owner} busy={exporting} setBusy={setExporting} onChanged={load} />
              : <p className="text-sm text-muted">No ACH drafts in this run.</p>}
          </Step>
          <Step n={3} title="Run Credit Card" done={cardCharges.every(x => x.charge.balance <= 0)}>
            {cardCharges.length
              ? <CardRun items={cardCharges} today={data.today} onChanged={load} />
              : <p className="text-sm text-muted">No card-on-file charges in this run.</p>}
          </Step>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="font-bold text-heading">Bills</h2>
          <div className="inline-flex rounded-xl border border-border p-0.5 text-xs">
            {([['all', 'All'], ['due', 'Still due'], ['ach', 'ACH'], ['card', 'Card']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`rounded-lg px-3 py-1.5 font-bold ${filter === k ? 'bg-brand-600 text-white' : 'text-muted hover:bg-surface'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-border">
          {bills.length === 0 && <p className="p-8 text-center text-sm text-muted">No bills here.</p>}
          {bills.map(b => (
            <div key={b.id}>
              <button className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-left hover:bg-surface/60" onClick={() => setOpen(o => ({ ...o, [b.id]: !o[b.id] }))} aria-expanded={!!open[b.id]}>
                {open[b.id] ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
                <span className="min-w-48 flex-1">
                  <span className="font-semibold text-text-main">{b.child_name}</span>
                  <span className="block text-xs text-muted">{b.classroom_name ?? 'No home room'} · {b.charges.map(c => c.payer_name).join(', ') || 'no charges'}</span>
                </span>
                <span className="w-28 text-right text-sm"><span className="block text-xs text-muted">Billing amount</span>{money(b.list)}</span>
                <span className="w-24 text-right text-sm"><span className="block text-xs text-muted">Discount</span>{b.discount > 0 ? `−${money(b.discount)}` : '—'}</span>
                <span className="w-24 text-right text-sm font-semibold"><span className="block text-xs font-normal text-muted">Total</span>{money(b.total)}</span>
                <span className="w-24 text-right text-sm"><span className="block text-xs text-muted">Due</span>{voided ? '—' : money(b.balance)}</span>
              </button>
              {open[b.id] && (
                <div className="space-y-3 bg-surface/40 px-5 pb-5 pl-14 pt-1">
                  <table className="w-full text-xs">
                    <tbody>
                      {b.lines.map((l, i) => (
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
                  <ChargeList charges={b.charges} today={data.today} onChanged={load} readOnly={voided} />
                  <Link href={`/center/children/${b.child_id}`} className="inline-block text-xs font-semibold text-brand-700 hover:underline">Open {b.child_name}&apos;s file →</Link>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 ${strong ? 'text-xl font-black text-heading' : 'text-lg font-bold text-text-main'}`}>{value}</div>
    </div>
  )
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${done ? 'bg-emerald-600 text-white' : 'border-2 border-brand-600 text-brand-700'}`}>
        {done ? <Check className="h-4 w-4" /> : n}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="mb-1.5 font-bold text-heading">{title}</h2>
        {children}
      </div>
    </div>
  )
}

/**
 * Run Credit Card: every card-on-file charge in the run. No card processor is connected yet (Stripe is planned), so the
 * center runs each card on its own terminal and records the approval here; that pays the charge like any payment.
 */
function CardRun({ items, today, onChanged }: { items: { bill: RunBill; charge: Charge }[]; today: string; onChanged: () => void }) {
  const [paying, setPaying] = useState<Charge | null>(null)
  const due = items.filter(x => x.charge.balance > 0)
  const done = items.length - due.length
  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        {items.length} {items.length === 1 ? 'card charge' : 'card charges'} · {done} charged · <b className="text-text-main">{money(sumMoney(due.map(x => x.charge.balance)))} to charge</b>.
        {' '}The card processor isn&apos;t connected yet: run each card on your terminal, then record the approval number. Once
        Stripe is connected, this becomes one <b>Run Credit Card</b> button that charges every saved card.
      </p>
      <div className="divide-y divide-border rounded-xl border border-border">
        {items.map(({ bill, charge: c }) => (
          <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
            <div className="min-w-48 flex-1">
              <div className="text-sm font-semibold text-text-main">{c.payer_name}</div>
              <div className="text-xs text-muted">{bill.child_name} · Card{c.last4 ? ` ····${c.last4}` : ''}</div>
            </div>
            <div className="w-24 text-right text-sm"><div className="text-xs text-muted">Billed</div>{money(c.amount)}</div>
            <div className="w-24 text-right text-sm font-semibold"><div className="text-xs font-normal text-muted">To charge</div>{money(c.balance)}</div>
            <div className="w-28"><ChargeStatusPill status={c.status} /></div>
            <div className="w-36 text-right">
              {c.balance > 0
                ? <button className={BTN_QUIET_SM} onClick={() => setPaying(c)}><CreditCard className="h-3.5 w-3.5" /> Record charge</button>
                : <span className="text-xs text-emerald-700">Charged</span>}
            </div>
          </div>
        ))}
      </div>
      {paying && <RecordPaymentDialog card charge={paying} today={today} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); onChanged() }} />}
    </div>
  )
}

const LS_KEY = 'carelocal.billing.ach-export'

function AchCard({ batch, centerId, isOwner, busy, setBusy, onChanged }: { batch: AchBatch; centerId: string | null | undefined; isOwner: boolean; busy: boolean; setBusy: (b: boolean) => void; onChanged: () => void }) {
  const [dialog, setDialog] = useState(false)
  const [ach, setAch] = useState<AchSettingsData['settings']>(null)
  useEffect(() => {
    if (!centerId) return
    let live = true
    createClient().rpc('center_ach_settings_get', { p_center_id: centerId }).then(({ data }) => { if (live) setAch((data as AchSettingsData | null)?.settings ?? null) })
    return () => { live = false }
  }, [centerId])
  const savedId = !!ach?.company_id
  const sftpReady = !!(ach && ach.send_method === 'sftp' && ach.sftp_host && ach.sftp_username && ach.has_sftp_secret && ach.sftp_host_fingerprint)
  const uploadHint = ach ? BANK_PRESETS[ach.bank].uploadHint : 'your bank’s ACH file upload page (e.g. Truist One View → ACH → file import).'

  async function send() {
    if (!await showConfirm(`Send the ACH file for ${batch.count} ${batch.count === 1 ? 'draft' : 'drafts'} to ${ach?.sftp_host} now? The bank drafts every family in it, so this can't be undone here. The batch is marked sent when the bank has the file.`,
      { title: 'Send to bank', confirmLabel: 'Send file' })) return
    setBusy(true)
    const res = await sendAchBatchBySftp(batch.id)
    setBusy(false)
    onChanged()
    if (!res.success) { showAlert(res.error, { title: 'Not sent' }); return }
    showAlert(`The bank received ${res.fileName}: ${res.count} ${res.count === 1 ? 'draft' : 'drafts'}, ${money(res.total)}. The batch is marked sent. Press "Mark cleared" when the money reaches the center's account.`, { title: 'File sent' })
  }
  const [form, setForm] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as { companyId?: string; companyName?: string; balanced?: boolean; format?: 'nacha' | 'csv' }
      return { format: saved.format ?? 'nacha', companyId: saved.companyId ?? '', companyName: saved.companyName ?? '', balanced: !!saved.balanced }
    } catch { return { format: 'nacha' as 'nacha' | 'csv', companyId: '', companyName: '', balanced: false } }
  })

  async function download() {
    setBusy(true)
    const res = await exportAchBatch(batch.id, savedId && form.format === 'nacha' ? { format: 'nacha' } : form)
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    try { localStorage.setItem(LS_KEY, JSON.stringify({ format: form.format, companyId: form.companyId, companyName: form.companyName, balanced: form.balanced })) } catch { /* private mode */ }
    const blob = new Blob([res.content], { type: form.format === 'csv' ? 'text/csv' : 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = res.filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setDialog(false)
    showAlert(`NACHA file built: ${res.count} ${res.count === 1 ? 'draft' : 'drafts'} (${money(res.total)}). Upload it: ${uploadHint} Then press "Mark sent". Delete the file from your computer once it's uploaded: it has full account numbers.`, { title: 'ACH file ready' })
    onChanged()
  }
  async function mark(status: 'sent' | 'settled') {
    const msg = status === 'sent'
      ? 'Mark the ACH file as uploaded to the bank? After this the drafts can no longer be paid another way here (mark a draft returned if the bank sends it back).'
      : 'Mark the drafts as cleared? Each draft that wasn’t returned is recorded as paid by ACH today.'
    if (!await showConfirm(msg, { title: status === 'sent' ? 'Sent to bank' : 'Drafts cleared', confirmLabel: status === 'sent' ? 'Mark sent' : 'Mark cleared' })) return
    const res = await markBatch(createClient(), batch.id, status)
    if (!res.success) { showAlert(res.error); return }
    onChanged()
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-text-main"><Landmark className="h-4 w-4 text-brand-600" /> ACH drafts · {BATCH_STATUS[batch.status]}</div>
          <p className="mt-1 text-sm text-muted">
            {batch.count} {batch.count === 1 ? 'draft' : 'drafts'} for {formatDate(batch.draft_date)}
            {batch.pending_total > 0 ? ` · ${money(batch.pending_total)} not cleared yet` : ''}
            {batch.exported_at ? ` · file downloaded ${formatDate(batch.exported_at)}` : ''}
            {batch.sent_at ? ` · sent ${formatDate(batch.sent_at)}` : ''}
            {batch.settled_at ? ` · cleared ${formatDate(batch.settled_at)}` : ''}
          </p>
          {batch.file_stale && <p className="mt-1 text-sm font-semibold text-amber-700">A draft changed after the file was downloaded. Download a new file and upload that one instead.</p>}
          {(batch.status === 'scheduled' || batch.status === 'exported') && !isOwner && <p className="mt-1 text-xs text-muted">The center&apos;s owner downloads the bank file (it carries full account numbers).</p>}
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-muted">
            <li className={batch.status === 'scheduled' ? 'font-semibold text-text-main' : ''}><b>Run ACH</b> builds the NACHA file (owner only, it has full account numbers).</li>
            <li className={batch.status === 'exported' ? 'font-semibold text-text-main' : ''}>{sftpReady
              ? <>Press <b>Send to bank</b> to deliver it by SFTP (it&apos;s marked sent for you), or upload it by hand and press <b>Mark sent</b>.</>
              : <>Upload it: {uploadHint} Then press <b>Mark sent</b>.</>}</li>
            <li className={batch.status === 'sent' ? 'font-semibold text-text-main' : ''}>When the money reaches the center&apos;s account (2–3 banking days), press <b>Mark cleared</b>. Mark any draft the bank returns.</li>
          </ol>
          {!sftpReady && <p className="mt-1 text-xs text-muted">If your bank sets up SFTP file transmission, CareLocal can send the file for you (About → Center Profile → ACH bank settings).</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {(batch.status === 'scheduled' || batch.status === 'exported') && isOwner && (
            <button className={batch.status === 'scheduled' || batch.file_stale ? BTN : BTN_QUIET_SM} onClick={() => setDialog(true)} disabled={busy}>
              {batch.status === 'exported' ? <><Download className="h-3.5 w-3.5" /> Build file again</> : <><Landmark className="h-3.5 w-3.5" /> Run ACH</>}
            </button>
          )}
          {(batch.status === 'scheduled' || batch.status === 'exported') && isOwner && sftpReady && (
            <button className={BTN} onClick={send} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send to bank</button>
          )}
          {batch.status === 'exported' && !batch.file_stale && <button className={sftpReady ? BTN_QUIET_SM : BTN} onClick={() => mark('sent')}><Send className="h-3.5 w-3.5" /> Mark sent</button>}
          {batch.status === 'sent' && <button className={BTN} onClick={() => mark('settled')}><CheckCircle2 className="h-3.5 w-3.5" /> Mark cleared</button>}
        </div>
      </div>

      {dialog && (
        <Modal title="Run ACH · build the NACHA file" onClose={() => setDialog(false)} footer={<>
          <button className={BTN_QUIET} onClick={() => setDialog(false)}>Cancel</button>
          <button className={BTN_PRIMARY} onClick={download} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Build &amp; download</button>
        </>}>
          <div className="space-y-4">
            <div>
              <span className={LBL}>Format</span>
              <div className="space-y-1.5 text-sm">
                <label className="flex items-center gap-2"><input type="radio" checked={form.format === 'nacha'} onChange={() => setForm(f => ({ ...f, format: 'nacha' }))} /> Nacha file (.ach), the standard bank upload</label>
                <label className="flex items-center gap-2"><input type="radio" checked={form.format === 'csv'} onChange={() => setForm(f => ({ ...f, format: 'csv' }))} /> Spreadsheet (.csv), for banks that take a list</label>
              </div>
            </div>
            {form.format === 'nacha' && (
              <>
                {savedId ? (
                  <p className="rounded-xl bg-surface p-3 text-sm text-text-main">Built with the center&apos;s ACH bank settings: Company ID <b className="font-mono">{ach?.company_id}</b>{ach?.balanced ? ', balanced file' : ''}. Change them in About → Center Profile.</p>
                ) : <>
                <div>
                  <label className={LBL}>Company ID</label>
                  <input className={FLD} maxLength={10} value={form.companyId} onChange={e => setForm(f => ({ ...f, companyId: e.target.value.trim() }))} placeholder="e.g. 1123456789" />
                  <p className="mt-1 text-xs text-muted">Your bank gives you this when it sets up ACH origination (often 1 followed by your EIN).</p>
                </div>
                <div>
                  <label className={LBL}>Name on families&apos; statements</label>
                  <input className={FLD} maxLength={16} value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} placeholder="Up to 16 characters" />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={form.balanced} onChange={e => setForm(f => ({ ...f, balanced: e.target.checked }))} />
                  <span>Add an offsetting credit to the center&apos;s account (a &ldquo;balanced&rdquo; file). Only if your bank asks for one.</span>
                </label>
                <p className="text-xs text-muted">Save these once in About → Center Profile → ACH bank settings so you don&apos;t type them each run.</p>
                </>}
              </>
            )}
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">The file has full bank account numbers. Downloading it is logged on each child&apos;s file. Delete it from your computer once it&apos;s uploaded to the bank.</p>
          </div>
        </Modal>
      )}
    </div>
  )
}

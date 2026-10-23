'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarCheck, CalendarClock, Loader2, Mail, Phone, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { updateTourRequest } from '@/app/actions/tour-requests.actions'
import { showAlert, showConfirm } from '@/lib/dialog'
import { canOpenChildFiles, useCenterContext } from '../context'
import { EnrollFromTour } from '../children/_components/EnrollFromTour'
import {
  CONTACT_TIMES, TOUR_STATUS_LABELS, TOUR_STATUS_STYLE, TOUR_TIME_SLOTS, formatSlot, formatTourDate, topicLabel,
  type CenterTourRequest, type TourStatus,
} from '@/lib/tours'

type Filter = 'new' | 'confirmed' | 'past' | 'all'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'past', label: 'Past' },
  { id: 'all', label: 'All' },
]
const inFilter = (r: CenterTourRequest, f: Filter) =>
  f === 'all' || (f === 'past' ? r.status === 'completed' || r.status === 'cancelled' : r.status === f)

const LBL = 'block text-sm font-medium text-text-main mb-1.5'
const FLD = 'w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600'

/** The tour's date and time: the confirmed slot, else the one the visitor asked for */
function whenOf(r: CenterTourRequest) {
  const date = r.status === 'confirmed' || r.status === 'completed' ? r.confirmed_date ?? r.preferred_date : r.preferred_date
  const time = r.status === 'confirmed' || r.status === 'completed' ? r.confirmed_time ?? r.preferred_time : r.preferred_time
  return date ? `${formatTourDate(date)} · ${formatSlot(time)}` : null
}

/** Center admin: tour requests from the public page. Confirm, complete or cancel each one. */
export default function ToursPage() {
  const ctx = useCenterContext()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<CenterTourRequest[]>([])
  const [filter, setFilter] = useState<Filter>('new')
  const [open, setOpen] = useState<CenterTourRequest | null>(null)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await createClient().from('center_tour_requests').select('*').order('created_at', { ascending: false })
    setRows((data ?? []) as CenterTourRequest[])
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f.id, rows.filter(r => inFilter(r, f.id)).length])) as Record<Filter, number>, [rows])
  const visible = rows.filter(r => inFilter(r, filter))

  function openRequest(r: CenterTourRequest) {
    setOpen(r)
    setDate(r.confirmed_date ?? r.preferred_date ?? '')
    setTime(r.confirmed_time ?? r.preferred_time ?? '')
    setNote(r.center_note ?? '')
  }

  async function setStatus(status: TourStatus) {
    if (!open) return
    if (status === 'cancelled' && open.status !== 'cancelled' && !await showConfirm(open.status === 'confirmed' ? 'Cancel this tour? The family is emailed.' : 'Cancel this tour request?', { title: 'Cancel tour', confirmLabel: 'Cancel tour' })) return
    setBusy(true)
    const res = await updateTourRequest(open.id, { status, confirmedDate: date || null, confirmedTime: time || null, note })
    setBusy(false)
    if (!res.success) { showAlert(res.error); return }
    setOpen(null)
    load()
  }

  const childLine = (r: CenterTourRequest) => r.children.map(c => c.name).join(', ')

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-heading mb-1">Tours</h1>
        <p className="text-muted">Tour requests from your public page. Confirm a time and the family is emailed.</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${filter === f.id ? 'bg-brand-600 text-white' : 'bg-white text-muted border border-border hover:bg-brand-50'}`}>
            {f.label}{counts[f.id] > 0 && <span className="ml-1.5 opacity-80">({counts[f.id]})</span>}
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div>
        ) : visible.length === 0 ? (
          <div className="px-6 py-16 text-center text-muted">
            <CalendarCheck className="mx-auto mb-3 h-10 w-10 text-brand-100" />
            {rows.length === 0 ? 'No tour requests yet. Turn on your public page in About → Public Page to start receiving them.' : 'Nothing here.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-border text-[15px] font-bold text-text-main">
                  <th scope="col" className="px-6 py-4">Visitor</th>
                  <th scope="col" className="px-4 py-4">Tour</th>
                  <th scope="col" className="px-4 py-4">For</th>
                  <th scope="col" className="px-4 py-4">Status</th>
                  <th scope="col" className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm text-text-muted">
                {visible.map(r => (
                  <tr key={r.id} className="align-top hover:bg-surface">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-text-main">{r.first_name} {r.last_name}</div>
                      <div className="text-xs text-muted">{r.email}</div>
                      <div className="text-xs text-muted">{r.phone}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-text-main">{whenOf(r) ?? 'Asked us to suggest a time'}</div>
                      <div className="text-xs text-muted">{r.tour_type === 'virtual' ? 'Virtual' : 'In person'} · Requested {new Date(r.created_at).toLocaleDateString()}</div>
                    </td>
                    <td className="px-4 py-4">{childLine(r) || '—'}</td>
                    <td className="px-4 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${TOUR_STATUS_STYLE[r.status]}`}>{TOUR_STATUS_LABELS[r.status]}</span></td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => openRequest(r)} className="inline-flex items-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800">
                        {r.status === 'new' ? 'Review' : 'Open'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="tour-detail-title">
          <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <h2 id="tour-detail-title" className="text-xl font-black text-heading">{open.first_name} {open.last_name}</h2>
                <span className={`mt-1 inline-flex rounded-full border px-2.5 py-0.5 text-xs ${TOUR_STATUS_STYLE[open.status]}`}>{TOUR_STATUS_LABELS[open.status]}</span>
              </div>
              <button onClick={() => setOpen(null)} className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 text-sm">
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <a href={`mailto:${open.email}`} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline"><Mail className="h-4 w-4" />{open.email}</a>
                <a href={`tel:${open.phone}`} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline"><Phone className="h-4 w-4" />{open.phone}</a>
              </div>

              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted">Tour</dt><dd className="text-text-main">{open.tour_type === 'virtual' ? 'Virtual' : 'In person'}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted">Requested time</dt><dd className="text-text-main">{open.preferred_date ? `${formatTourDate(open.preferred_date)} · ${formatSlot(open.preferred_time)}` : 'None. They shared their availability.'}</dd></div>
                {open.contact_time && <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted">Best time to contact</dt><dd className="text-text-main">{CONTACT_TIMES.find(c => c.key === open.contact_time)?.label}</dd></div>}
                {open.start_date && <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted">Preferred start date</dt><dd className="text-text-main">{formatTourDate(open.start_date)}</dd></div>}
                {open.first_group_care != null && <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted">First time in group care</dt><dd className="text-text-main">{open.first_group_care ? 'Yes' : 'No'}</dd></div>}
              </dl>

              {open.children.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Children</div>
                  <ul className="space-y-0.5 text-text-main">
                    {open.children.map((c, i) => <li key={i}>{c.name}{c.dob ? <span className="text-muted"> · {formatTourDate(c.dob)}</span> : ''}</li>)}
                  </ul>
                </div>
              )}
              {canOpenChildFiles(ctx) && <EnrollFromTour request={open} />}
              {open.alternate_times && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">When they are free</div><p className="whitespace-pre-line text-text-main">{open.alternate_times}</p></div>}
              {open.topics.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Wants to learn about</div>
                  <div className="flex flex-wrap gap-1.5">{open.topics.map(t => <span key={t} className="rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-xs text-brand-600">{topicLabel(t)}</span>)}</div>
                </div>
              )}
              {open.message && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Message</div><p className="whitespace-pre-line text-text-main">{open.message}</p></div>}

              {(open.status === 'new' || open.status === 'confirmed') && (
                <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2 font-bold text-text-main"><CalendarClock className="h-4 w-4 text-brand-600" /> {open.status === 'confirmed' ? 'Tour time' : 'Confirm a tour time'}</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className={LBL} htmlFor="confirm-date">Date</label><input id="confirm-date" type="date" value={date} onChange={e => setDate(e.target.value)} className={FLD} /></div>
                    <div>
                      <label className={LBL} htmlFor="confirm-time">Time</label>
                      <select id="confirm-time" value={time} onChange={e => setTime(e.target.value)} className={FLD}>
                        <option value="">Select a time</option>
                        {TOUR_TIME_SLOTS.map(t => <option key={t} value={t}>{formatSlot(t)}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}
              <div>
                <label className={LBL} htmlFor="tour-note">Note {open.status === 'new' || open.status === 'confirmed' ? '(included in the email to the family)' : ''}</label>
                <textarea id="tour-note" rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} className={`${FLD} resize-none`} placeholder="Where to park, who to ask for, the video link for a virtual tour…" />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">
              {(open.status === 'new' || open.status === 'confirmed') && (
                <button disabled={busy} onClick={() => setStatus('cancelled')} className="rounded-xl border border-red-100 px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">Cancel tour</button>
              )}
              {open.status === 'confirmed' && (
                <button disabled={busy} onClick={() => setStatus('completed')} className="rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-brand-600 hover:bg-brand-50 disabled:opacity-50">Mark completed</button>
              )}
              {(open.status === 'new' || open.status === 'confirmed') && (
                <button disabled={busy} onClick={() => setStatus('confirmed')} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} {open.status === 'confirmed' ? 'Update tour' : 'Confirm tour'}
                </button>
              )}
              {(open.status === 'completed' || open.status === 'cancelled') && (
                <>
                  <button disabled={busy} onClick={() => setStatus(open.status)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-brand-600 hover:bg-brand-50 disabled:opacity-50">Save note</button>
                  <button disabled={busy} onClick={() => setStatus('new')} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">Reopen</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

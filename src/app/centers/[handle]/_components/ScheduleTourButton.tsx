'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, CheckCircle2, Loader2, Plus, X } from 'lucide-react'
import { submitTourRequest } from '@/app/actions/tour-requests.actions'
import {
  CONTACT_TIMES, TOUR_TIME_SLOTS, TOUR_TOPICS, TOUR_TYPES, formatSlot, formatTourDate, upcomingWeekdays,
  type ContactTime, type TourType,
} from '@/lib/tours'
import type { DomainKey } from '@/lib/domain-config'

const LBL = 'mb-1.5 block text-sm font-medium text-text-main'
const FLD = 'w-full rounded-xl border border-border bg-white px-3.5 py-2.5 text-sm text-text-main focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30'

interface Form {
  firstName: string; lastName: string; email: string; phone: string
  contactTime: ContactTime | ''
  children: { name: string; dob: string }[]
  tourType: TourType
  date: string; time: string; alternateTimes: string
  startDate: string; firstGroupCare: boolean | null; topics: string[]; message: string
  website: string
}

const EMPTY: Form = {
  firstName: '', lastName: '', email: '', phone: '', contactTime: '', children: [{ name: '', dob: '' }],
  tourType: 'in_person', date: '', time: '', alternateTimes: '',
  startDate: '', firstGroupCare: null, topics: [], message: '', website: '',
}

const STEPS = ['About you', 'Date and time', 'A few questions']

/** "Schedule a Tour" button and its three-step request form (you, date and time, questions). */
export function ScheduleTourButton({ handle, centerName, domain }: { handle: string; centerName: string; domain: DomainKey }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<Form>(EMPTY)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)

  const childcare = domain === 'childcare'
  const subjectLabel = childcare ? 'Your children' : 'Who is the tour for?'
  const dates = useMemo(() => (open ? upcomingWeekdays(30) : []), [open])

  function close() { setOpen(false) }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previous }
  }, [open])

  function openModal() {
    setForm(EMPTY); setStep(0); setError(''); setDone(false); setOpen(true)
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(f => ({ ...f, [key]: value }))
  const setChild = (i: number, patch: Partial<Form['children'][number]>) =>
    setForm(f => ({ ...f, children: f.children.map((c, idx) => idx === i ? { ...c, ...patch } : c) }))

  /** What is missing on the current step, or '' */
  function problem(s: number): string {
    if (s === 0) {
      if (!form.firstName.trim() || !form.lastName.trim()) return 'Enter your first and last name.'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) return 'Enter a valid email address.'
      if (form.phone.replace(/\D/g, '').length < 10) return 'Enter a valid phone number.'
      if (childcare && !form.children.some(c => c.name.trim())) return 'Add your child’s name.'
    }
    if (s === 1) {
      const hasSlot = !!form.date && !!form.time
      if (!hasSlot && !form.alternateTimes.trim()) return 'Choose a date and time, or tell us when you are free.'
      if (form.date && !form.time) return 'Choose a time for your tour.'
    }
    return ''
  }

  function next() {
    const issue = problem(step)
    if (issue) { setError(issue); return }
    setError('')
    setStep(s => s + 1)
  }

  async function submit() {
    const issue = problem(0) || problem(1)
    if (issue) { setError(issue); return }
    setSending(true)
    setError('')
    const res = await submitTourRequest(handle, {
      ...form,
      // a time only counts together with a date
      time: form.date ? form.time : '',
    })
    setSending(false)
    if (!res.success) { setError(res.error); return }
    setDone(true)
  }

  return (
    <>
      <button type="button" onClick={openModal} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-brand-600/20 hover:bg-brand-800">
        <CalendarCheck className="h-4 w-4" /> Schedule a Tour
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="tour-title" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
          <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <h2 id="tour-title" className="text-xl font-black text-heading">{done ? 'Request sent' : 'Schedule a tour'}</h2>
                <p className="text-xs text-muted">{done ? centerName : `${centerName} · Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}</p>
              </div>
              <button type="button" onClick={close} className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>

            {!done && (
              <div className="flex gap-1.5 px-6 pt-4" aria-hidden>
                {STEPS.map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-600' : 'bg-border'}`} />)}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {done ? (
                <div className="py-6 text-center">
                  <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-brand-600" />
                  <h3 className="text-lg font-bold text-heading">Thanks, {form.firstName.trim()}!</h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                    {centerName} will contact you to confirm your tour
                    {form.date ? <> for <strong className="text-text-main">{formatTourDate(form.date, false)} at {formatSlot(form.time)}</strong></> : ''}.
                    We also emailed you a copy of your request.
                  </p>
                  <button type="button" onClick={close} className="mt-6 rounded-xl bg-brand-600 px-8 py-3 text-sm font-black text-white hover:bg-brand-800">Close</button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Spam trap: hidden from people, filled in by bots */}
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden value={form.website} onChange={e => set('website', e.target.value)} className="absolute left-[-9999px] h-0 w-0 opacity-0" />

                  {step === 0 && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div><label className={LBL} htmlFor="tour-first">First name *</label><input id="tour-first" autoFocus value={form.firstName} onChange={e => set('firstName', e.target.value)} className={FLD} maxLength={60} autoComplete="given-name" /></div>
                        <div><label className={LBL} htmlFor="tour-last">Last name *</label><input id="tour-last" value={form.lastName} onChange={e => set('lastName', e.target.value)} className={FLD} maxLength={60} autoComplete="family-name" /></div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div><label className={LBL} htmlFor="tour-email">Email *</label><input id="tour-email" type="email" value={form.email} onChange={e => set('email', e.target.value)} className={FLD} maxLength={254} autoComplete="email" /></div>
                        <div><label className={LBL} htmlFor="tour-phone">Phone *</label><input id="tour-phone" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={FLD} maxLength={30} autoComplete="tel" placeholder="(704) 555-0123" /></div>
                      </div>
                      <div>
                        <div className={LBL}>Best time to contact you</div>
                        <div className="flex flex-wrap gap-2">
                          {CONTACT_TIMES.map(c => (
                            <button key={c.key} type="button" onClick={() => set('contactTime', form.contactTime === c.key ? '' : c.key)} aria-pressed={form.contactTime === c.key}
                              className={`rounded-full border px-4 py-1.5 text-sm font-medium ${form.contactTime === c.key ? 'border-brand-600 bg-brand-50 text-brand-600' : 'border-border text-text-muted hover:bg-surface'}`}>{c.label}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className={LBL}>{subjectLabel}{childcare ? ' *' : ''}</div>
                        <div className="space-y-2">
                          {form.children.map((c, i) => (
                            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_170px_auto]">
                              <input aria-label="Name" placeholder="Name" value={c.name} onChange={e => setChild(i, { name: e.target.value })} className={FLD} maxLength={80} />
                              <input aria-label={childcare ? 'Date of birth or due date' : 'Date of birth'} type="date" value={c.dob} onChange={e => setChild(i, { dob: e.target.value })} className={`${FLD} col-span-2 sm:col-span-1 sm:order-none`} />
                              {form.children.length > 1 ? (
                                <button type="button" onClick={() => setForm(f => ({ ...f, children: f.children.filter((_, idx) => idx !== i) }))} className="row-start-1 rounded-lg p-2 text-subtle hover:bg-red-50 hover:text-red-500 sm:row-start-auto" aria-label="Remove"><X className="h-4 w-4" /></button>
                              ) : <span />}
                            </div>
                          ))}
                        </div>
                        <p className="mt-1 text-[11px] text-subtle">{childcare ? 'Enter a due date if your child is not born yet.' : 'Date of birth is optional.'}</p>
                        {form.children.length < 6 && (
                          <button type="button" onClick={() => setForm(f => ({ ...f, children: [...f.children, { name: '', dob: '' }] }))} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
                            <Plus className="h-4 w-4" /> {childcare ? 'Add another child' : 'Add another person'}
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {step === 1 && (
                    <>
                      <p className="text-sm text-muted">Pick a date and time that suits you. {centerName} will confirm it with you. If you can’t find a time, tell us when you are free and we will call you to find one.</p>
                      <div>
                        <div className={LBL}>Tour type</div>
                        <div className="flex gap-2">
                          {TOUR_TYPES.map(t => (
                            <button key={t.key} type="button" onClick={() => set('tourType', t.key)} aria-pressed={form.tourType === t.key}
                              className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold ${form.tourType === t.key ? 'border-brand-600 bg-brand-50 text-brand-600' : 'border-border text-text-muted hover:bg-surface'}`}>{t.label}</button>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className={LBL} htmlFor="tour-date">Date</label>
                          <select id="tour-date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value, time: e.target.value ? f.time : '' }))} className={FLD}>
                            <option value="">Select a date</option>
                            {dates.map(d => <option key={d} value={d}>{formatTourDate(d, false)}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={LBL} htmlFor="tour-time">Time</label>
                          <select id="tour-time" value={form.time} onChange={e => set('time', e.target.value)} disabled={!form.date} className={`${FLD} disabled:bg-surface disabled:text-subtle`}>
                            <option value="">{form.date ? 'Select a time' : 'Pick a date first'}</option>
                            {TOUR_TIME_SLOTS.map(t => <option key={t} value={t}>{formatSlot(t)}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-subtle"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
                      <div>
                        <label className={LBL} htmlFor="tour-alt">Can’t find a time that works?</label>
                        <textarea id="tour-alt" rows={2} maxLength={500} value={form.alternateTimes} onChange={e => set('alternateTimes', e.target.value)} className={`${FLD} resize-none`} placeholder="Tell us the days and times you are free, e.g. weekdays after 3 PM" />
                      </div>
                    </>
                  )}

                  {step === 2 && (
                    <>
                      <p className="text-sm text-muted">Your tour is almost requested. A few optional questions help {centerName} prepare.</p>
                      <div>
                        <label className={LBL} htmlFor="tour-start">What is your preferred start date?</label>
                        <input id="tour-start" type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} className={FLD} />
                      </div>
                      {childcare && (
                        <div>
                          <div className={LBL}>Is this your first experience in group child care?</div>
                          <div className="flex gap-2">
                            {([true, false] as const).map(v => (
                              <button key={String(v)} type="button" onClick={() => set('firstGroupCare', form.firstGroupCare === v ? null : v)} aria-pressed={form.firstGroupCare === v}
                                className={`rounded-full border px-5 py-1.5 text-sm font-medium ${form.firstGroupCare === v ? 'border-brand-600 bg-brand-50 text-brand-600' : 'border-border text-text-muted hover:bg-surface'}`}>{v ? 'Yes' : 'No'}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className={LBL}>What would you like to learn about on your tour?</div>
                        <div className="grid gap-1.5">
                          {TOUR_TOPICS.map(t => (
                            <label key={t.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-sm text-text-main hover:bg-surface">
                              <input type="checkbox" checked={form.topics.includes(t.key)} onChange={e => set('topics', e.target.checked ? [...form.topics, t.key] : form.topics.filter(k => k !== t.key))} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                              {t.label}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className={LBL} htmlFor="tour-message">Anything else we should know?</label>
                        <textarea id="tour-message" rows={3} maxLength={1000} value={form.message} onChange={e => set('message', e.target.value)} className={`${FLD} resize-none`} placeholder="Questions, accessibility needs, who will join you on the tour…" />
                      </div>
                    </>
                  )}

                  {error && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">{error}</div>}
                </div>
              )}
            </div>

            {!done && (
              <div className="flex gap-3 border-t border-border px-6 py-4">
                {step > 0 && <button type="button" onClick={() => { setError(''); setStep(s => s - 1) }} disabled={sending} className="rounded-xl border-2 border-border bg-surface px-6 py-3 text-sm font-bold text-muted hover:bg-white">Back</button>}
                {step < STEPS.length - 1 ? (
                  <button type="button" onClick={next} className="flex-1 rounded-xl bg-brand-600 px-6 py-3 text-sm font-black text-white hover:bg-brand-800">Next</button>
                ) : (
                  <button type="button" onClick={submit} disabled={sending} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-black text-white hover:bg-brand-800 disabled:opacity-60">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Request my tour
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

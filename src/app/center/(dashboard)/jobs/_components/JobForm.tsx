'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { CenterDocumentRequirement } from '@/lib/types'
import { useStaffRoles } from '@/lib/hooks/useStaffRoles'
import { lookupLabel } from '@/lib/lookups'
import { sectionsFor } from '@/lib/compliance'
import { showAlert } from '@/lib/dialog'
import { createJob, updateJob, type JobInput } from '@/app/actions/jobs.actions'
import {
  BENEFITS, EMPLOYMENT_TYPE_LABELS, NEEDED_AT_LABELS, benefitLabel, formatPay,
  type EmploymentType, type JobPosting, type NeededAt,
} from '@/lib/jobs'

const LBL = 'block text-sm font-medium text-text-main mb-1.5'
const FLD = 'w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600'

type Form = {
  title: string
  role_value: string
  employment_type: EmploymentType
  description: string
  schedule_summary: string
  hours_per_week: string
  pay_mode: 'range' | 'fixed'
  pay_min: string
  pay_max: string
  pay_unit: 'hour' | 'year'
  benefits: string[]
  start_date: string
  openings: string
  closes_at: string
}

const EMPTY: Form = {
  title: '', role_value: '', employment_type: 'full_time', description: '', schedule_summary: '', hours_per_week: '',
  pay_mode: 'range', pay_min: '', pay_max: '', pay_unit: 'hour', benefits: [], start_date: '', openings: '1', closes_at: '',
}

const num = (v: string) => (v.trim() === '' ? null : Number(v))

/** Create / edit a job posting. Required items come from the center's compliance checklist. */
export function JobForm({ job, jobItems }: { job?: JobPosting; jobItems?: { requirement_id: string; needed_at: NeededAt }[] }) {
  const router = useRouter()
  const { roles } = useStaffRoles()
  const [requirements, setRequirements] = useState<CenterDocumentRequirement[]>([])
  const [items, setItems] = useState<Record<string, NeededAt>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<null | 'draft' | 'publish'>(null)
  const [form, setForm] = useState<Form>(() => job ? {
    title: job.title,
    role_value: job.role_value ?? '',
    employment_type: job.employment_type,
    description: job.description,
    schedule_summary: job.schedule_summary ?? '',
    hours_per_week: job.hours_per_week != null ? String(job.hours_per_week) : '',
    pay_mode: job.pay_max != null && job.pay_min != null && Number(job.pay_max) !== Number(job.pay_min) ? 'range' : (job.pay_min != null ? 'fixed' : 'range'),
    pay_min: job.pay_min != null ? String(job.pay_min) : '',
    pay_max: job.pay_max != null ? String(job.pay_max) : '',
    pay_unit: job.pay_unit,
    benefits: job.benefits ?? [],
    start_date: job.start_date ?? '',
    openings: String(job.openings),
    closes_at: job.closes_at ? job.closes_at.slice(0, 10) : '',
  } : EMPTY)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: admin } = await supabase.from('center_admins').select('center_id').eq('user_id', user.id).limit(1).maybeSingle()
      if (!admin) return
      const { data } = await supabase.from('center_document_requirements').select('*').eq('center_id', admin.center_id)
        .order('sort_order', { ascending: true }).order('created_at', { ascending: true })
      const reqs = ((data ?? []) as CenterDocumentRequirement[]).filter(r => !r.is_internal && r.evidence_type !== 'center_record')
      setRequirements(reqs)
      // New jobs start with the mandatory checklist items ticked (those that apply to regular
      // employees); the admin adds any other document this job needs
      const initial = jobItems ?? (job ? [] : reqs
        .filter(r => r.is_required && !r.is_conditional)
        .filter(r => !r.applies_to_class?.length || r.applies_to_class.includes('regular'))
        .map(r => ({ requirement_id: r.id, needed_at: (r.due_within_days === 0 ? 'apply' : 'start') as NeededAt })))
      setItems(Object.fromEntries(initial.map(i => [i.requirement_id, i.needed_at])))
      setLoading(false)
    })()
  }, [job, jobItems])

  const sections = useMemo(() => sectionsFor(requirements), [requirements])

  function toggleItem(id: string, on: boolean, req: CenterDocumentRequirement) {
    setItems(prev => {
      const next = { ...prev }
      if (on) next[id] = req.due_within_days === 0 ? 'apply' : 'start'
      else delete next[id]
      return next
    })
  }

  function toInput(): JobInput {
    const payMin = num(form.pay_min)
    return {
      title: form.title,
      role_value: form.role_value || null,
      employment_type: form.employment_type,
      description: form.description,
      schedule_summary: form.schedule_summary || null,
      hours_per_week: num(form.hours_per_week),
      pay_min: payMin,
      pay_max: form.pay_mode === 'fixed' ? payMin : num(form.pay_max),
      pay_unit: form.pay_unit,
      benefits: form.benefits,
      start_date: form.start_date || null,
      openings: Number(form.openings) || 1,
      closes_at: form.closes_at || null,
      requirements: Object.entries(items).map(([requirement_id, needed_at]) => ({ requirement_id, needed_at })),
    }
  }

  async function save(publish: boolean) {
    if (publish && !form.pay_min.trim()) { showAlert('Add a pay range or a fixed pay before publishing.'); return }
    setSaving(publish ? 'publish' : 'draft')
    const input = toInput()
    if (job) {
      const res = await updateJob(job.id, input)
      setSaving(null)
      if (!res.success) { showAlert(res.error); return }
      router.push(`/center/jobs/${job.id}`)
    } else {
      const res = await createJob(input, publish)
      setSaving(null)
      if (!res.success) { showAlert(res.error); return }
      router.push(`/center/jobs/${res.jobId}`)
    }
  }

  const preview = { pay_min: num(form.pay_min), pay_max: form.pay_mode === 'fixed' ? num(form.pay_min) : num(form.pay_max), pay_unit: form.pay_unit }
  const applyCount = Object.values(items).filter(v => v === 'apply').length

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <section className="rounded-2xl border border-border bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-text-main">The job</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className={LBL}>Job title *</label>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={FLD} placeholder="e.g. Lead Teacher, Toddler Room" />
            </div>
            <div>
              <label className={LBL}>Role</label>
              <select value={form.role_value} onChange={e => setForm({ ...form, role_value: e.target.value })} className={FLD}>
                <option value="">Select…</option>
                {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className={LBL}>Type *</label>
              <select value={form.employment_type} onChange={e => setForm({ ...form, employment_type: e.target.value as EmploymentType })} className={FLD}>
                {(Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map(t => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className={LBL}>Schedule</label>
              <input value={form.schedule_summary} onChange={e => setForm({ ...form, schedule_summary: e.target.value })} className={FLD} placeholder="Mon–Fri 7:00–3:30" />
            </div>
            <div>
              <label className={LBL}>Hours per week</label>
              <input type="number" min={0} step="0.5" value={form.hours_per_week} onChange={e => setForm({ ...form, hours_per_week: e.target.value })} className={FLD} />
            </div>
          </div>
          <div>
            <label className={LBL}>Description *</label>
            <textarea rows={6} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={`${FLD} resize-y`} placeholder="What the role involves, who it works with, what you are looking for…" />
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-text-main">Pay and start</h2>
          <div className="flex flex-wrap gap-2">
            {(['range', 'fixed'] as const).map(m => (
              <button key={m} type="button" onClick={() => setForm({ ...form, pay_mode: m })}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${form.pay_mode === m ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-muted'}`}>
                {m === 'range' ? 'Pay range' : 'Fixed pay'}
              </button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className={LBL}>{form.pay_mode === 'range' ? 'From ($) *' : 'Pay ($) *'}</label>
              <input type="number" min={0} step="0.01" value={form.pay_min} onChange={e => setForm({ ...form, pay_min: e.target.value })} className={FLD} />
            </div>
            {form.pay_mode === 'range' && (
              <div>
                <label className={LBL}>To ($)</label>
                <input type="number" min={0} step="0.01" value={form.pay_max} onChange={e => setForm({ ...form, pay_max: e.target.value })} className={FLD} />
              </div>
            )}
            <div>
              <label className={LBL}>Per</label>
              <select value={form.pay_unit} onChange={e => setForm({ ...form, pay_unit: e.target.value as 'hour' | 'year' })} className={FLD}>
                <option value="hour">Hour</option>
                <option value="year">Year</option>
              </select>
            </div>
            <div>
              <label className={LBL}>Openings</label>
              <input type="number" min={1} value={form.openings} onChange={e => setForm({ ...form, openings: e.target.value })} className={FLD} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={LBL}>Start date</label>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className={FLD} />
              <p className="mt-1 text-[11px] text-subtle">Leave empty for “as soon as possible”. Documents are checked against this date.</p>
            </div>
            <div>
              <label className={LBL}>Close applications on (optional)</label>
              <input type="date" value={form.closes_at} onChange={e => setForm({ ...form, closes_at: e.target.value })} className={FLD} />
            </div>
          </div>
          <div>
            <label className={LBL}>Benefits</label>
            <div className="flex flex-wrap gap-2">
              {BENEFITS.map(b => {
                const on = form.benefits.includes(b.value)
                return (
                  <button key={b.value} type="button"
                    onClick={() => setForm({ ...form, benefits: on ? form.benefits.filter(x => x !== b.value) : [...form.benefits, b.value] })}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-muted hover:bg-gray-50'}`}>
                    {b.label}
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-text-main">Required documents</h2>
          <p className="mb-4 text-sm text-muted">
            Every application includes a resume. Your mandatory checklist items are ticked; tick any other documents this job needs. “To apply” items must be ready before someone can apply ({applyCount} selected); the others are collected after the offer or before the start date.
          </p>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
          ) : requirements.length === 0 ? (
            <p className="text-sm text-muted">Your checklist is empty. Add document requirements in About → Documents first.</p>
          ) : (
            <div className="space-y-5">
              {sections.map(section => {
                const reqs = requirements.filter(r => r.section === section.id)
                if (reqs.length === 0) return null
                return (
                  <div key={section.id}>
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-brand-600">{section.label}</h3>
                    <div className="divide-y divide-border rounded-xl border border-border">
                      {reqs.map(req => {
                        const neededAt = items[req.id]
                        return (
                          <div key={req.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                            <label className="flex flex-1 min-w-[200px] items-center gap-2 text-sm text-text-main">
                              <input type="checkbox" checked={!!neededAt} onChange={e => toggleItem(req.id, e.target.checked, req)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                              {req.document_name}
                              {req.is_confidential && <Lock className="h-3.5 w-3.5 text-amber-600" aria-label="Confidential" />}
                            </label>
                            {neededAt && (
                              <select value={neededAt} onChange={e => setItems(prev => ({ ...prev, [req.id]: e.target.value as NeededAt }))}
                                className="rounded-lg border border-border bg-white px-2 py-1 text-xs font-semibold text-brand-600">
                                {(Object.keys(NEEDED_AT_LABELS) as NeededAt[]).map(n => <option key={n} value={n}>{NEEDED_AT_LABELS[n]}</option>)}
                              </select>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={() => router.back()} className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted hover:bg-surface">Cancel</button>
          {job ? (
            <button type="button" disabled={saving !== null} onClick={() => save(false)} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
            </button>
          ) : (
            <>
              <button type="button" disabled={saving !== null} onClick={() => save(false)} className="inline-flex items-center gap-2 rounded-xl border border-brand-600 px-5 py-2.5 text-sm font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50">
                {saving === 'draft' && <Loader2 className="h-4 w-4 animate-spin" />} Save draft
              </button>
              <button type="button" disabled={saving !== null} onClick={() => save(true)} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
                {saving === 'publish' && <Loader2 className="h-4 w-4 animate-spin" />} Publish
              </button>
            </>
          )}
        </div>
      </div>

      {/* Live preview of what staff will see */}
      <aside className="lg:sticky lg:top-6 h-fit rounded-2xl border border-border bg-white p-6 shadow-sm">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-subtle">Preview</p>
        <h3 className="text-xl font-extrabold text-heading">{form.title || 'Job title'}</h3>
        <p className="mt-1 text-sm text-muted">
          {[form.role_value ? lookupLabel(roles, form.role_value) : null, EMPLOYMENT_TYPE_LABELS[form.employment_type]].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-3 text-lg font-bold text-brand-600">{formatPay(preview)}</p>
        {form.schedule_summary && <p className="mt-1 text-sm text-text-muted">{form.schedule_summary}{form.hours_per_week ? ` · ${form.hours_per_week} hrs/week` : ''}</p>}
        <p className="mt-1 text-sm text-text-muted">Starts {form.start_date ? new Date(`${form.start_date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'as soon as possible'}</p>
        {form.benefits.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {form.benefits.map(b => <span key={b} className="rounded-full border border-brand-100 bg-brand-50 px-2 py-0.5 text-[11px] text-brand-600">{benefitLabel(b)}</span>)}
          </div>
        )}
        {form.description && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-text-muted line-clamp-[10]">{form.description}</p>}
      </aside>
    </div>
  )
}

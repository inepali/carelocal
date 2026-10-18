'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Briefcase, CalendarDays, Clock, Loader2, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useLookups } from '@/hooks/use-lookups'
import { lookupLabel } from '@/lib/lookups'
import { ApplySheet } from '@/components/staff/ApplySheet'
import type { CenterDocumentRequirement, CenterStaffDocumentStatus, CenterProgram, StaffDocument } from '@/lib/types'
import {
  EMPLOYMENT_TYPE_LABELS, ITEM_STATE_STYLE, STAGE_LABELS, benefitLabel, computeReadiness, findResume, formatPay,
  type ApplicationStage, type JobPosting, type NeededAt,
} from '@/lib/jobs'

/** Staff: job detail, the center's programs, a readiness preview and Apply. */
export default function StaffJobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { data: roleLookups } = useLookups('Role')
  const [loading, setLoading] = useState(true)
  const [job, setJob] = useState<JobPosting | null>(null)
  const [center, setCenter] = useState<{ name: string; city: string | null; state: string | null } | null>(null)
  const [programs, setPrograms] = useState<CenterProgram[]>([])
  const [items, setItems] = useState<{ requirement: CenterDocumentRequirement; neededAt: NeededAt }[]>([])
  const [records, setRecords] = useState<CenterStaffDocumentStatus[]>([])
  const [docs, setDocs] = useState<StaffDocument[]>([])
  const [staffId, setStaffId] = useState<string | null>(null)
  const [stage, setStage] = useState<ApplicationStage | null>(null)
  const [applying, setApplying] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle()
    const { data: jobRow } = await supabase.from('job_postings').select('*, center:centers(name, city, state)').eq('id', id).maybeSingle()
    if (!jobRow || !profile) { setLoading(false); return }
    const [{ data: reqRows }, { data: progs }, { data: recs }, { data: vault }, { data: app }] = await Promise.all([
      supabase.from('job_posting_requirements').select('needed_at, requirement:center_document_requirements(*)').eq('job_id', id),
      supabase.from('center_programs').select('*').eq('center_id', jobRow.center_id).eq('is_active', true).order('sort_order'),
      supabase.from('center_staff_document_status').select('*').eq('center_id', jobRow.center_id).eq('staff_id', profile.id),
      supabase.from('staff_documents').select('*').eq('staff_id', profile.id).order('uploaded_at', { ascending: false }),
      supabase.from('job_applications').select('stage').eq('job_id', id).eq('staff_id', profile.id).maybeSingle(),
    ])
    setStaffId(profile.id)
    setJob(jobRow as JobPosting)
    setCenter(Array.isArray(jobRow.center) ? jobRow.center[0] : jobRow.center)
    setPrograms((progs ?? []) as CenterProgram[])
    setItems((reqRows ?? []).flatMap(r => {
      const requirement = (Array.isArray(r.requirement) ? r.requirement[0] : r.requirement) as CenterDocumentRequirement | null
      return requirement ? [{ requirement, neededAt: r.needed_at as NeededAt }] : []
    }))
    setRecords((recs ?? []) as CenterStaffDocumentStatus[])
    setDocs((vault ?? []) as StaffDocument[])
    setStage((app?.stage as ApplicationStage | undefined) ?? null)
    setLoading(false)
  }, [id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const preview = useMemo(() => computeReadiness({ items, records, vaultDocs: docs, startDate: job?.start_date }), [items, records, docs, job])
  const missing = preview.filter(r => r.neededAt === 'apply' && r.state === 'missing').length + (findResume(docs) ? 0 : 1)

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-[#157354]" /></div>
  if (!job) return <p className="text-[#6b7a73]">This job is no longer available, or it is outside your metro area.</p>

  const canApply = job.status === 'published' && (!stage || stage === 'withdrawn')

  return (
    <div className="max-w-5xl pb-32">
      <Link href="/staff/jobs" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#6b7a73] hover:text-[#157354]"><ArrowLeft className="h-4 w-4" /> All jobs</Link>

      <div className="mb-8 rounded-[2rem] border-2 border-[#f0f4f2] bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#157354] text-white shadow-lg shadow-[#157354]/20"><Briefcase className="h-8 w-8" /></span>
          <div className="flex-1">
            <h1 className="text-3xl font-black tracking-tight text-[#0b3828]">{job.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-3 text-[#6b7a73]">
              <span className="font-bold text-[#1a2e25]">{center?.name}</span>
              {center?.city && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{center.city}{center.state ? `, ${center.state}` : ''}</span>}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full border border-[#d4ede4] bg-[#edf7f3] px-3 py-1 font-bold text-[#157354]">{formatPay(job)}</span>
              <span className="rounded-full border border-[#e2e8e4] px-3 py-1 text-[#3d5a4f]">{EMPLOYMENT_TYPE_LABELS[job.employment_type]}</span>
              {job.role_value && <span className="rounded-full border border-[#e2e8e4] px-3 py-1 text-[#3d5a4f]">{lookupLabel(roleLookups, job.role_value)}</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-[#6b7a73]">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />Starts {job.start_date ? new Date(`${job.start_date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'as soon as possible'}</span>
              {(job.schedule_summary || job.hours_per_week) && <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" />{[job.schedule_summary, job.hours_per_week ? `${job.hours_per_week} hrs/week` : null].filter(Boolean).join(' · ')}</span>}
            </div>
          </div>
          <div className="md:text-right">
            {stage && stage !== 'withdrawn' ? (
              <Link href="/staff/applications" className="inline-flex rounded-xl border-2 border-[#157354] px-6 py-3 text-sm font-black text-[#157354] hover:bg-[#edf7f3]">{STAGE_LABELS[stage]} · View</Link>
            ) : canApply ? (
              <button onClick={() => setApplying(true)} className="rounded-xl bg-[#157354] px-8 py-3 text-sm font-black text-white shadow-lg shadow-[#157354]/20 hover:bg-[#0f4a36]">Apply</button>
            ) : (
              <span className="text-sm text-[#6b7a73]">No longer accepting applications</span>
            )}
            {canApply && <p className="mt-2 text-xs text-[#6b7a73]">{missing === 0 ? 'You have everything needed to apply.' : `${missing} item${missing === 1 ? '' : 's'} to add before you apply.`}</p>}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-[#e2e8e4] bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-bold text-[#1a2e25]">About the job</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-[#3d5a4f]">{job.description}</p>
            {job.benefits.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {job.benefits.map(b => <span key={b} className="rounded-full border border-[#d4ede4] bg-[#edf7f3] px-2.5 py-1 text-xs text-[#157354]">{benefitLabel(b)}</span>)}
              </div>
            )}
          </section>
          {programs.length > 0 && (
            <section className="rounded-2xl border border-[#e2e8e4] bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-lg font-bold text-[#1a2e25]">About {center?.name ?? 'the center'}</h2>
              <ul className="space-y-3">
                {programs.map(p => (
                  <li key={p.id}>
                    <div className="font-semibold text-[#1a2e25]">{p.name}{p.age_range ? <span className="font-normal text-[#6b7a73]"> · {p.age_range}</span> : null}</div>
                    {p.description && <p className="text-sm text-[#6b7a73]">{p.description}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="h-fit rounded-2xl border border-[#e2e8e4] bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[#6b7a73]">What you’ll need</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between gap-2">
              <span className="text-[#1a2e25]">Resume</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${findResume(docs) ? ITEM_STATE_STYLE.ready.className : ITEM_STATE_STYLE.missing.className}`}>{findResume(docs) ? 'Ready' : 'Missing'}</span>
            </li>
            {preview.map(item => (
              <li key={item.requirement.id} className="flex items-center justify-between gap-2">
                <span className="text-[#1a2e25]">{item.requirement.document_name}</span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${ITEM_STATE_STYLE[item.state].className}`}>{ITEM_STATE_STYLE[item.state].label}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {applying && staffId && (
        <ApplySheet job={job} staffId={staffId} items={items} records={records} vaultDocs={docs}
          onClose={() => { setApplying(false); load() }}
          onApplied={() => { setApplying(false); router.push('/staff/applications') }} />
      )}
    </div>
  )
}

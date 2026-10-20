'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Briefcase, ChevronRight, Loader2, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useLookups } from '@/hooks/use-lookups'
import { lookupLabel } from '@/lib/lookups'
import { JobAlerts } from '@/components/staff/JobAlerts'
import {
  EMPLOYMENT_TYPE_LABELS, STAGE_LABELS, formatPay,
  type ApplicationStage, type EmploymentType, type JobPosting,
} from '@/lib/jobs'

type FeedJob = JobPosting & { center: { name: string; city: string | null; state: string | null } | null }

/** Staff: published regular jobs in their vertical, nearest city first. */
export default function StaffJobsPage() {
  const { data: roleLookups } = useLookups('Role')
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState<FeedJob[]>([])
  const [applied, setApplied] = useState<Record<string, ApplicationStage>>({})
  const [city, setCity] = useState('')
  const [metro, setMetro] = useState<{ set: boolean; name: string | null }>({ set: true, name: null })
  const [type, setType] = useState<'all' | EmploymentType>('all')
  const [role, setRole] = useState('all')
  const [minPay, setMinPay] = useState('')

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from('staff_profiles').select('id, city, domain_key, metro_area_id, metro:metro_areas(name)').eq('user_id', user.id).maybeSingle()
      const [{ data: rows }, { data: apps }] = await Promise.all([
        supabase.from('job_postings').select('*, center:centers(name, city, state)')
          .eq('status', 'published').eq('domain_key', profile?.domain_key ?? 'childcare')
          .order('published_at', { ascending: false }),
        profile ? supabase.from('job_applications').select('job_id, stage').eq('staff_id', profile.id) : Promise.resolve({ data: [] }),
      ])
      setCity((profile?.city ?? '').toLowerCase())
      const metroRow = (Array.isArray(profile?.metro) ? profile.metro[0] : profile?.metro) as { name?: string } | null | undefined
      setMetro({ set: !!profile?.metro_area_id, name: metroRow?.name ?? null })
      setJobs((rows ?? []).map(r => ({ ...r, center: Array.isArray(r.center) ? r.center[0] : r.center })) as FeedJob[])
      setApplied(Object.fromEntries((apps ?? []).map(a => [a.job_id, a.stage as ApplicationStage])))
      setLoading(false)
    })()
  }, [])

  const visible = useMemo(() => jobs
    .filter(j => type === 'all' || j.employment_type === type)
    .filter(j => role === 'all' || j.role_value === role)
    .filter(j => !minPay || (j.pay_max ?? j.pay_min ?? 0) >= Number(minPay))
    // Nearest first: jobs in the person's city, then everything else (newest first within each)
    .sort((a, b) => Number((b.center?.city ?? '').toLowerCase() === city) - Number((a.center?.city ?? '').toLowerCase() === city)),
  [jobs, type, role, minPay, city])

  const roles = roleLookups.filter(r => r.is_active)

  return (
    <div className="max-w-5xl pb-32">
      <div className="mb-10">
        <h1 className="text-4xl font-black text-heading mb-2 tracking-tight">Jobs</h1>
        <p className="text-muted text-lg font-medium">Regular full-time and part-time positions at centers{metro.name ? ` in the ${metro.name} area` : ' in your metro area'}.</p>
      </div>

      {metro.set && <JobAlerts />}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select value={type} onChange={e => setType(e.target.value as 'all' | EmploymentType)} className="rounded-xl border border-border bg-white px-3 py-2 text-sm">
          <option value="all">Full-time and part-time</option>
          {(Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map(t => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>)}
        </select>
        <select value={role} onChange={e => setRole(e.target.value)} className="rounded-xl border border-border bg-white px-3 py-2 text-sm">
          <option value="all">Any role</option>
          {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          Pay at least $
          <input type="number" min={0} value={minPay} onChange={e => setMinPay(e.target.value)} className="w-24 rounded-xl border border-border bg-white px-3 py-2 text-sm" />
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : !metro.set ? (
        <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-50 p-10 text-center">
          <MapPin className="mx-auto mb-3 h-10 w-10 text-brand-600" />
          <p className="mb-4 font-bold text-heading">Set your metro area to see jobs near you.</p>
          <Link href="/staff/profile" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-800">Go to My Profile</Link>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center">
          <Briefcase className="mx-auto mb-3 h-10 w-10 text-subtle" />
          <p className="font-bold text-muted">{jobs.length === 0 ? 'No open jobs in your metro area right now. Check back soon.' : 'No jobs match these filters.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(job => (
            <Link key={job.id} href={`/staff/jobs/${job.id}`} className="flex items-center gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Briefcase className="h-6 w-6" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-heading">{job.title}</h2>
                  {applied[job.id] && <span className="rounded-full border border-brand-100 bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-600">{STAGE_LABELS[applied[job.id]]}</span>}
                </div>
                <div className="text-sm text-muted">
                  {job.center?.name}
                  {job.center?.city && <span className="ml-2 inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{job.center.city}{job.center.state ? `, ${job.center.state}` : ''}</span>}
                </div>
                <div className="mt-1 text-sm text-text-muted">
                  {[EMPLOYMENT_TYPE_LABELS[job.employment_type], job.role_value ? lookupLabel(roleLookups, job.role_value) : null, formatPay(job),
                    job.start_date ? `Starts ${new Date(`${job.start_date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Starts ASAP'].filter(Boolean).join(' · ')}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-subtle" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { DomainKey } from '@/lib/domain-config'
import type { EmploymentType } from '@/lib/jobs'

/**
 * Server-only reads for the public job pages (SEO, Google for Jobs). Uses the service role with an
 * explicit, safe column list, so nothing private is exposed and no anonymous read rules are needed:
 * only published postings and the hiring center's public details (name, address, city).
 * In-app browsing keeps its own metro-area rule (RLS); these pages are the public listing.
 */
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export interface PublicCenter {
  name: string
  slug: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  logo_url: string | null
  /** Handle of the center's public page (/centers/<handle>), when it has one */
  publicHandle: string | null
}

export interface PublicJob {
  id: string
  slug: string
  /** published = open; the others stay readable at the same address so search engines keep the page */
  status: 'published' | 'paused' | 'filled' | 'closed' | 'archived'
  title: string
  role_value: string | null
  employment_type: EmploymentType
  description: string
  schedule_summary: string | null
  hours_per_week: number | null
  pay_min: number | null
  pay_max: number | null
  pay_unit: 'hour' | 'year'
  benefits: string[]
  start_date: string | null
  openings: number
  published_at: string | null
  closes_at: string | null
  updated_at: string
  center: PublicCenter
}

const JOB_COLUMNS = 'id, slug, status, title, role_value, employment_type, description, schedule_summary, hours_per_week, pay_min, pay_max, pay_unit, benefits, start_date, openings, published_at, closes_at, updated_at, center:centers!inner(name, slug, address, city, state, zip, logo_url, is_active, public_enabled, public_handle)'

/** "Charlotte, NC" -> "charlotte-nc" */
export function citySlug(city: string | null | undefined, state: string | null | undefined) {
  return [city, state].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

type RawCenter = Omit<PublicCenter, 'publicHandle'> & { is_active?: boolean; public_enabled?: boolean; public_handle?: string | null }
type Row = Omit<PublicJob, 'center'> & { center: RawCenter | RawCenter[] }

function normalize(rows: Row[] | null): PublicJob[] {
  return (rows ?? []).flatMap(r => {
    const center = Array.isArray(r.center) ? r.center[0] : r.center
    if (!center || center.is_active === false) return []
    const { is_active: _ignored, public_enabled, public_handle, ...publicCenter } = center
    void _ignored
    return [{ ...r, center: { ...publicCenter, publicHandle: public_enabled ? public_handle ?? null : null } }]
  })
}

/** Every published job on this site (vertical), newest first */
export async function listPublicJobs(domain: DomainKey): Promise<PublicJob[]> {
  const { data } = await db().from('job_postings').select(JOB_COLUMNS)
    .eq('status', 'published').eq('domain_key', domain)
    .order('published_at', { ascending: false })
  return normalize(data as Row[] | null)
}

/** Published jobs in one city ("charlotte-nc") */
export async function listPublicJobsInCity(domain: DomainKey, slug: string) {
  const jobs = await listPublicJobs(domain)
  const inCity = jobs.filter(j => citySlug(j.center.city, j.center.state) === slug)
  const sample = inCity[0]?.center
  return { jobs: inCity, city: sample?.city ?? null, state: sample?.state ?? null }
}

/** Cities with open jobs, with counts */
export async function listJobCities(domain: DomainKey) {
  const jobs = await listPublicJobs(domain)
  const map = new Map<string, { slug: string; city: string; state: string | null; count: number }>()
  for (const j of jobs) {
    if (!j.center.city) continue
    const slug = citySlug(j.center.city, j.center.state)
    const entry = map.get(slug) ?? { slug, city: j.center.city, state: j.center.state, count: 0 }
    entry.count++
    map.set(slug, entry)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))
}

/** Every published job at one center (by the center slug), newest first */
export const listPublicJobsForCenter = cache(async (domain: DomainKey, centerSlug: string): Promise<PublicJob[]> => {
  const { data } = await db().from('job_postings').select(JOB_COLUMNS)
    .eq('status', 'published').eq('domain_key', domain).eq('center.slug', centerSlug)
    .order('published_at', { ascending: false })
  return normalize(data as Row[] | null)
})

/** One published job by its public URL; null when it is not (or no longer) published */
/**
 * One job by its address. Open jobs and jobs that are paused, filled, closed or archived are all returned (only
 * drafts are not), so a job's page stays up and indexed after it stops taking applications. Lists and the sitemap
 * still show open jobs only.
 */
export async function getPublicJob(domain: DomainKey, centerSlug: string, jobSlug: string): Promise<PublicJob | null> {
  const { data } = await db().from('job_postings').select(JOB_COLUMNS)
    .in('status', ['published', 'paused', 'filled', 'closed', 'archived']).eq('domain_key', domain).eq('slug', jobSlug).eq('center.slug', centerSlug)
    .limit(1)
  return normalize(data as Row[] | null)[0] ?? null
}

/** Role labels for public pages: the vertical's platform defaults, plus the center's own roles when a center is given (those win) */
export async function publicRoleLabels(domain: DomainKey, centerId?: string): Promise<Record<string, string>> {
  const { data } = await db().from('center_lookups').select('value, label, center_id')
    .eq('group_name', 'Role').eq('domain_key', domain)
    .or(centerId ? `center_id.is.null,center_id.eq.${centerId}` : 'center_id.is.null')
  const rows = data ?? []
  return Object.fromEntries([...rows.filter(r => !r.center_id), ...rows.filter(r => r.center_id)].map(r => [r.value, r.label]))
}

/** "home_health_aide" -> "home-health-aide": the role part of /jobs/in/<city>/<role> */
export const roleSlug = (value: string) => value.toLowerCase().replace(/_/g, '-')

/** Published jobs in one city for one role ("charlotte-nc", "teacher") */
export async function listPublicJobsInCityRole(domain: DomainKey, city: string, role: string) {
  const { jobs, city: name, state } = await listPublicJobsInCity(domain, city)
  const inRole = jobs.filter(j => j.role_value && roleSlug(j.role_value) === role)
  return { jobs: inRole, roleValue: inRole[0]?.role_value ?? null, city: name, state }
}

/** City and role pairs that have open jobs, with counts (for role links and the sitemap) */
export async function listJobCityRoles(domain: DomainKey) {
  const jobs = await listPublicJobs(domain)
  const map = new Map<string, { citySlug: string; roleSlug: string; roleValue: string; count: number }>()
  for (const j of jobs) {
    if (!j.center.city || !j.role_value) continue
    const city = citySlug(j.center.city, j.center.state)
    const key = `${city}/${roleSlug(j.role_value)}`
    const entry = map.get(key) ?? { citySlug: city, roleSlug: roleSlug(j.role_value), roleValue: j.role_value, count: 0 }
    entry.count++
    map.set(key, entry)
  }
  return [...map.values()]
}

export type PublicJobRequirement = { name: string; neededAt: 'apply' | 'offer' | 'start' }

/**
 * The documents a job asks for, by name only (never the center's notes or any file), with when each is needed.
 * Shown on the public job page so applicants know what to have ready.
 */
export async function listPublicJobRequirements(jobId: string): Promise<PublicJobRequirement[]> {
  const { data } = await db().from('job_posting_requirements')
    .select('needed_at, requirement:center_document_requirements!inner(document_name, sort_order)')
    .eq('job_id', jobId)
  type Row = { needed_at: PublicJobRequirement['neededAt']; requirement: { document_name: string; sort_order: number | null } | { document_name: string; sort_order: number | null }[] }
  return ((data ?? []) as unknown as Row[])
    .map(r => ({ r, req: Array.isArray(r.requirement) ? r.requirement[0] : r.requirement }))
    .filter(x => x.req?.document_name)
    .sort((a, b) => (a.req.sort_order ?? 0) - (b.req.sort_order ?? 0) || a.req.document_name.localeCompare(b.req.document_name))
    .map(x => ({ name: x.req.document_name, neededAt: x.r.needed_at }))
}

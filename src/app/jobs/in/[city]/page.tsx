import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { ArrowLeft } from 'lucide-react'
import { getDomainKey, getDomainConfig } from '@/lib/domain-config'
import { listPublicJobsInCity, publicRoleLabels } from '@/lib/server/public-jobs'
import { JobsShell, PublicJobCard, verticalNoun } from '../../_components/JobsShell'

type Props = { params: Promise<{ city: string }> }

async function siteDomain() {
  return getDomainKey((await headers()).get('host') || '')
}

/** "charlotte-nc" -> "Charlotte, NC" when there are no jobs to read the real name from */
function prettyCity(slug: string) {
  const parts = slug.split('-')
  const state = parts.length > 1 && parts[parts.length - 1].length === 2 ? parts.pop()!.toUpperCase() : null
  const city = parts.map(p => p[0]?.toUpperCase() + p.slice(1)).join(' ')
  return state ? `${city}, ${state}` : city
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city } = await params
  const domain = await siteDomain()
  const { city: name, state } = await listPublicJobsInCity(domain, city)
  const place = name ? `${name}${state ? `, ${state}` : ''}` : prettyCity(city)
  const noun = verticalNoun(domain)
  return {
    title: `${noun[0].toUpperCase()}${noun.slice(1)} jobs in ${place}`,
    description: `Open full-time and part-time ${noun} jobs in ${place} on ${getDomainConfig(domain).appName}. Apply in one tap.`,
    alternates: { canonical: `/jobs/in/${city}` },
  }
}

/** Public: open jobs in one city */
export default async function CityJobsPage({ params }: Props) {
  const { city } = await params
  const domain = await siteDomain()
  const [{ jobs, city: name, state }, roles] = await Promise.all([listPublicJobsInCity(domain, city), publicRoleLabels(domain)])
  const place = name ? `${name}${state ? `, ${state}` : ''}` : prettyCity(city)
  const noun = verticalNoun(domain)

  return (
    <JobsShell domain={domain}>
      <section className="mx-auto max-w-6xl px-6 py-14">
        <Link href="/jobs" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> All jobs</Link>
        <h1 className="mb-2 text-4xl font-extrabold tracking-tight text-heading">{noun[0].toUpperCase()}{noun.slice(1)} jobs in {place}</h1>
        <p className="mb-10 text-lg text-muted">{jobs.length} open position{jobs.length === 1 ? '' : 's'} at local centers.</p>
        {jobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center text-muted">
            No open jobs in {place} right now. <Link href="/register?type=staff" className="font-semibold text-brand-600 hover:underline">Create a free account</Link> and set a job alert for {place}.
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map(job => <PublicJobCard key={job.id} job={job} roleLabel={job.role_value ? roles[job.role_value] : undefined} />)}
          </div>
        )}
      </section>
    </JobsShell>
  )
}

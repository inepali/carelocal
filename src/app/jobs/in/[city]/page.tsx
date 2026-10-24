import type { Metadata, ResolvingMetadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { ArrowLeft } from 'lucide-react'
import { getDomainKey, getDomainConfig } from '@/lib/domain-config'
import { listPublicJobsInCity, publicRoleLabels, roleSlug } from '@/lib/server/public-jobs'
import { JobsShell, PublicJobCard, verticalNoun } from '../../_components/JobsShell'
import { jobsCrumbs, jobsListJsonLd, shareTags } from '@/lib/jobs-seo'
import { jsonLdString } from '@/lib/center-seo'

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

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { city } = await params
  const domain = await siteDomain()
  const { jobs, city: name, state } = await listPublicJobsInCity(domain, city)
  const place = name ? `${name}${state ? `, ${state}` : ''}` : prettyCity(city)
  const noun = verticalNoun(domain)
  const title = `${noun[0].toUpperCase()}${noun.slice(1)} jobs in ${place}`
  const description = `${jobs.length > 0 ? `${jobs.length} open ` : 'Open '}full-time and part-time ${noun} job${jobs.length === 1 ? '' : 's'} in ${place} on ${getDomainConfig(domain).appName}. Apply in one tap.`
  return {
    title,
    description,
    alternates: { canonical: `/jobs/in/${city}` },
    // A city with no open jobs has nothing to rank: keep it out of search (the link stays working)
    ...(jobs.length === 0 ? { robots: { index: false, follow: true } } : {}),
    ...(await shareTags(parent, domain, { title: `${title} | ${getDomainConfig(domain).appName}`, description, path: `/jobs/in/${city}` })),
  }
}

/** Public: open jobs in one city */
export default async function CityJobsPage({ params }: Props) {
  const { city } = await params
  const domain = await siteDomain()
  const [{ jobs, city: name, state }, roles] = await Promise.all([listPublicJobsInCity(domain, city), publicRoleLabels(domain)])
  const place = name ? `${name}${state ? `, ${state}` : ''}` : prettyCity(city)
  const noun = verticalNoun(domain)
  // One link per role that is hiring here (each leads to its own page)
  const counts = new Map<string, number>()
  for (const j of jobs) if (j.role_value) counts.set(j.role_value, (counts.get(j.role_value) ?? 0) + 1)
  const roleChips = [...counts].map(([value, count]) => ({ slug: roleSlug(value), label: roles[value] ?? value, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  const jsonLd = jsonLdString(jobsListJsonLd(domain, `${noun[0].toUpperCase()}${noun.slice(1)} jobs in ${place}`, `/jobs/in/${city}`, jobs, jobsCrumbs(domain, [{ name: place, path: `/jobs/in/${city}` }])))

  return (
    <JobsShell domain={domain}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <section className="mx-auto max-w-6xl px-6 py-14">
        <Link href="/jobs" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> All jobs</Link>
        <h1 className="mb-2 text-4xl font-extrabold tracking-tight text-heading">{noun[0].toUpperCase()}{noun.slice(1)} jobs in {place}</h1>
        <p className="mb-10 text-lg text-muted">{jobs.length} open position{jobs.length === 1 ? '' : 's'} at local centers.</p>
        {roleChips.length > 1 && (
          <div className="mb-8 flex flex-wrap gap-2">
            {roleChips.map(r => (
              <Link key={r.slug} href={`/jobs/in/${city}/${r.slug}`} className="rounded-full border border-border bg-white px-4 py-2 text-sm font-semibold text-brand-600 hover:bg-brand-50">
                {r.label} <span className="text-muted">({r.count})</span>
              </Link>
            ))}
          </div>
        )}
        {jobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center text-muted">
            No open jobs in {place} right now. <Link href="/register?type=staff" className="font-semibold text-brand-600 hover:underline">Create a free account</Link> and set a job alert for {place}.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {jobs.map(job => <PublicJobCard key={job.id} job={job} roleLabel={job.role_value ? roles[job.role_value] : undefined} />)}
          </div>
        )}
      </section>
    </JobsShell>
  )
}

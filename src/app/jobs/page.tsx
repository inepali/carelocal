import type { Metadata, ResolvingMetadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { MapPin } from 'lucide-react'
import { getDomainKey, getDomainConfig } from '@/lib/domain-config'
import { listJobCities, listPublicJobs, publicRoleLabels } from '@/lib/server/public-jobs'
import { JobsShell, PublicJobCard, verticalNoun } from './_components/JobsShell'
import { jobsCrumbs, jobsListJsonLd, shareTags } from '@/lib/jobs-seo'
import { jsonLdString } from '@/lib/center-seo'

async function siteDomain() {
  return getDomainKey((await headers()).get('host') || '')
}

export async function generateMetadata(_props: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const domain = await siteDomain()
  const noun = verticalNoun(domain)
  const title = `${noun[0].toUpperCase()}${noun.slice(1)} jobs`
  const description = `Full-time and part-time ${noun} jobs at local centers on ${getDomainConfig(domain).appName}. Apply in one tap with your documents and references.`
  return { title, description, alternates: { canonical: '/jobs' }, ...(await shareTags(parent, domain, { title: `${title} | ${getDomainConfig(domain).appName}`, description, path: '/jobs' })) }
}

/** Public: every open job on this site, and the cities hiring */
export default async function PublicJobsPage() {
  const domain = await siteDomain()
  const [jobs, cities, roles] = await Promise.all([listPublicJobs(domain), listJobCities(domain), publicRoleLabels(domain)])
  const noun = verticalNoun(domain)
  const jsonLd = jsonLdString(jobsListJsonLd(domain, `${noun[0].toUpperCase()}${noun.slice(1)} jobs`, '/jobs', jobs, jobsCrumbs(domain)))

  return (
    <JobsShell domain={domain}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <section className="mx-auto max-w-6xl px-6 py-14">
        <h1 className="mb-2 text-4xl font-extrabold tracking-tight text-heading">{noun[0].toUpperCase()}{noun.slice(1)} jobs near you</h1>
        <p className="mb-10 max-w-2xl text-lg text-muted">Regular full-time and part-time positions at local centers. Create a free account, keep your documents in one place, and apply in one tap.</p>

        {cities.length > 0 && (
          <div className="mb-10">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted">Browse by city</h2>
            <div className="flex flex-wrap gap-2">
              {cities.map(c => (
                <Link key={c.slug} href={`/jobs/in/${c.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-4 py-2 text-sm font-semibold text-brand-600 hover:bg-brand-50">
                  <MapPin className="h-4 w-4" /> {c.city}{c.state ? `, ${c.state}` : ''} <span className="text-muted">({c.count})</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {jobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center text-muted">
            No open jobs right now. <Link href="/register?type=staff" className="font-semibold text-brand-600 hover:underline">Create a free account</Link> and turn on job alerts to hear about new ones first.
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

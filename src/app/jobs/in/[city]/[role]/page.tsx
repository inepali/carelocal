import type { Metadata, ResolvingMetadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getDomainKey, getDomainConfig } from '@/lib/domain-config'
import { listPublicJobsInCityRole, publicRoleLabels } from '@/lib/server/public-jobs'
import { JobsShell, PublicJobCard, verticalNoun } from '../../../_components/JobsShell'
import { jobsCrumbs, jobsListJsonLd, shareTags } from '@/lib/jobs-seo'
import { jsonLdString } from '@/lib/center-seo'

type Props = { params: Promise<{ city: string; role: string }> }

async function siteDomain() {
  return getDomainKey((await headers()).get('host') || '')
}

/** "teacher" -> "Teacher", "home-health-aide" -> "Home health aide" when the role has no saved label */
const prettyRole = (slug: string) => {
  const text = slug.replace(/-/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { city, role } = await params
  const domain = await siteDomain()
  const [{ jobs, roleValue, city: name, state }, roles] = await Promise.all([listPublicJobsInCityRole(domain, city, role), publicRoleLabels(domain)])
  // No open jobs: nothing to rank, so keep the page out of search results
  if (jobs.length === 0) return { title: 'Jobs', robots: { index: false } }
  const place = `${name}${state ? `, ${state}` : ''}`
  const label = (roleValue && roles[roleValue]) || prettyRole(role)
  const title = `${label} jobs in ${place}`
  const description = `${jobs.length} open ${label.toLowerCase()} job${jobs.length === 1 ? '' : 's'} in ${place} at local ${verticalNoun(domain)} centers on ${getDomainConfig(domain).appName}. Apply in one tap.`
  return {
    title,
    description,
    alternates: { canonical: `/jobs/in/${city}/${role}` },
    ...(await shareTags(parent, domain, { title: `${title} | ${getDomainConfig(domain).appName}`, description, path: `/jobs/in/${city}/${role}` })),
  }
}

/** Public: open jobs for one role in one city, e.g. /jobs/in/charlotte-nc/teacher */
export default async function CityRoleJobsPage({ params }: Props) {
  const { city, role } = await params
  const domain = await siteDomain()
  const [{ jobs, roleValue, city: name, state }, roles] = await Promise.all([listPublicJobsInCityRole(domain, city, role), publicRoleLabels(domain)])
  if (jobs.length === 0) notFound()
  const place = `${name}${state ? `, ${state}` : ''}`
  const label = (roleValue && roles[roleValue]) || prettyRole(role)

  const jsonLd = jsonLdString(jobsListJsonLd(domain, `${label} jobs in ${place}`, `/jobs/in/${city}/${role}`, jobs, jobsCrumbs(domain, [{ name: place, path: `/jobs/in/${city}` }, { name: label, path: `/jobs/in/${city}/${role}` }])))

  return (
    <JobsShell domain={domain}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <section className="mx-auto max-w-6xl px-6 py-14">
        <Link href={`/jobs/in/${city}`} className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> All jobs in {place}</Link>
        <h1 className="mb-2 text-4xl font-extrabold tracking-tight text-heading">{label} jobs in {place}</h1>
        <p className="mb-10 text-lg text-muted">{jobs.length} open position{jobs.length === 1 ? '' : 's'} at local centers. Create a free account, keep your documents in one place, and apply in one tap.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          {jobs.map(job => <PublicJobCard key={job.id} job={job} roleLabel={label} />)}
        </div>
      </section>
    </JobsShell>
  )
}

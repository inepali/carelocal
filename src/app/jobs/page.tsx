import type { Metadata, ResolvingMetadata } from 'next'
import { headers } from 'next/headers'
import { getDomainKey, getDomainConfig } from '@/lib/domain-config'
import { listJobCities, listPublicJobs, publicRoleLabels } from '@/lib/server/public-jobs'
import { JobsShell, verticalNoun } from './_components/JobsShell'
import { FinalCta, HiringStrip, HowItWorks, JobsFaq, JobsHero, OpenJobs, WhyCareLocal, jobsFaq } from './_components/JobsLanding'
import { jobsCrumbs, jobsListJsonLd, shareTags } from '@/lib/jobs-seo'
import { jsonLdString } from '@/lib/center-seo'
import { registerHref } from '@/lib/attribution'

async function siteDomain() {
  return getDomainKey((await headers()).get('host') || '')
}

const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`

export async function generateMetadata(_props: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const domain = await siteDomain()
  const noun = verticalNoun(domain)
  const cities = await listJobCities(domain).catch(() => [])
  const where = cities[0] ? ` in ${cities[0].city}${cities[0].state ? `, ${cities[0].state}` : ''}` : ' near you'
  const title = `${cap(noun)} jobs${where}`
  const description = `Full-time, part-time and flexible ${noun} work at local centers. One free profile, apply in one tap, no fees ever.`
  const appName = getDomainConfig(domain).appName
  return {
    title,
    description,
    alternates: { canonical: '/jobs' },
    ...(await shareTags(parent, domain, { title: `${title} | ${appName}`, description, path: '/jobs' })),
  }
}

/**
 * Public: the jobs landing page (the page ads and shared links point to) and every open job on this site.
 * Hero, the open jobs right under it, then why CareLocal, how it works, questions and a last call to join.
 */
export default async function PublicJobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const domain = await siteDomain()
  const [jobs, cities, roles, sp] = await Promise.all([listPublicJobs(domain), listJobCities(domain), publicRoleLabels(domain), searchParams])
  const noun = verticalNoun(domain)
  const joinHref = registerHref('staff', sp)
  const stats = { jobs: jobs.length, centers: new Set(jobs.map(j => j.center.slug)).size, cities: cities.length }
  const topCity = cities[0] ? `${cities[0].city}${cities[0].state ? `, ${cities[0].state}` : ''}` : null

  const listLd = jobsListJsonLd(domain, `${cap(noun)} jobs`, '/jobs', jobs, jobsCrumbs(domain))
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: jobsFaq(domain).map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }

  return (
    <JobsShell domain={domain}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(listLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(faqLd) }} />
      <JobsHero domain={domain} stats={stats} topCity={topCity} joinHref={joinHref} />
      <OpenJobs jobs={jobs} cities={cities} roles={roles} joinHref={joinHref} sharePath="/jobs" />
      <WhyCareLocal domain={domain} />
      <HowItWorks domain={domain} joinHref={joinHref} />
      <JobsFaq domain={domain} />
      <HiringStrip />
      <FinalCta joinHref={joinHref} />
    </JobsShell>
  )
}

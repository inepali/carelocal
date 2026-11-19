import type { Metadata, ResolvingMetadata } from 'next'
import { headers } from 'next/headers'
import { getDomainKey, getDomainConfig } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'
import { getTierLimits } from '@/lib/types'
import { registerHref } from '@/lib/attribution'
import { listCenterCities, listPublicCenters } from '@/lib/server/public-center'
import { listPublicJobs } from '@/lib/server/public-jobs'
import { capitalize, jsonLdString, listJsonLd, nounFor } from '@/lib/center-seo'
import { JobsShell } from '@/app/jobs/_components/JobsShell'
import { shareTags } from '@/lib/jobs-seo'
import { CenterList, CenterTools, CentersFaq, CentersFinalCta, CentersHero, PublicPagePitch, VisitorStrip, centersFaq } from './_components/CentersLanding'

async function siteDomain() {
  return getDomainKey((await headers()).get('host') || '')
}

export async function generateMetadata(_props: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const domain = await siteDomain()
  const noun = nounFor(domain)
  const appName = getDomainConfig(domain).appName
  const title = `${capitalize(noun)} centers: find one or list yours`
  const description = `Browse local ${noun} centers' programs, team, open jobs and tours. Own a center? Fill shifts by text, keep staff files current and get found. 3 months free.`
  return {
    title,
    description,
    alternates: { canonical: `${siteUrl(domain)}/centers` },
    // The landing copy is worth indexing even before any center is listed
    robots: { index: true, follow: true },
    ...(await shareTags(parent, domain, { title: `${title} | ${appName}`, description, path: '/centers' })),
  }
}

/**
 * Public: the centers landing page (the page center-facing ads and shared links point to) and every center with a
 * public page. Hero for owners and directors, the listed centers right under it, then what a center gets, questions
 * and a last call to start the trial.
 */
export default async function CentersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const domain = await siteDomain()
  const [centers, cities, jobs, sp] = await Promise.all([
    listPublicCenters(domain),
    listCenterCities(domain),
    listPublicJobs(domain).catch(() => []),
    searchParams,
  ])
  const noun = nounFor(domain)
  const joinHref = registerHref('center', sp)
  const faqs = centersFaq(domain, getTierLimits(domain).starter.pricePerMonth)
  const stats = { centers: centers.length, cities: cities.length, jobs: jobs.length }

  const crumbs = [{ name: getDomainConfig(domain).appName, path: '/' }, { name: 'Centers', path: '/centers' }]
  const listLd = listJsonLd(`${capitalize(noun)} centers`, '/centers', centers, crumbs, domain)
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }

  return (
    <JobsShell domain={domain}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(listLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(faqLd) }} />
      <CentersHero domain={domain} stats={stats} joinHref={joinHref} />
      <CenterList domain={domain} centers={centers} cities={cities} joinHref={joinHref} />
      <PublicPagePitch domain={domain} />
      <CenterTools domain={domain} />
      <CentersFaq faqs={faqs} />
      <VisitorStrip domain={domain} />
      <CentersFinalCta domain={domain} joinHref={joinHref} />
    </JobsShell>
  )
}

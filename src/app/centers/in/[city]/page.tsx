import type { Metadata, ResolvingMetadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getDomainKey, getDomainConfig } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'
import { listPublicCentersInCity } from '@/lib/server/public-center'
import { capitalize, jsonLdString, listJsonLd, nounFor } from '@/lib/center-seo'
import { JobsShell } from '@/app/jobs/_components/JobsShell'
import { shareTags } from '@/lib/jobs-seo'
import { CenterCard } from '../../_components/CenterCard'

type Props = { params: Promise<{ city: string }> }

async function siteDomain() {
  return getDomainKey((await headers()).get('host') || '')
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { city } = await params
  const domain = await siteDomain()
  const { centers, city: name, state } = await listPublicCentersInCity(domain, city)
  if (centers.length === 0) return { title: 'No centers found', robots: { index: false, follow: false } }
  const place = `${name}${state ? `, ${state}` : ''}`
  const noun = nounFor(domain)
  const title = `${capitalize(noun)} centers in ${place}`
  const description = `${centers.length} ${noun} center${centers.length === 1 ? '' : 's'} in ${place} on ${getDomainConfig(domain).appName}: programs, team, open jobs and online tour requests.`
  const canonical = `${siteUrl(domain)}/centers/in/${city}`
  return {
    title,
    description,
    alternates: { canonical },
    ...(await shareTags(parent, domain, { title, description, path: `/centers/in/${city}` })),
  }
}

/** Public: the centers in one city, e.g. "child care centers in Harrisburg, NC" */
export default async function CityCentersPage({ params }: Props) {
  const { city } = await params
  const domain = await siteDomain()
  const { centers, city: name, state } = await listPublicCentersInCity(domain, city)
  if (centers.length === 0) notFound()   // an empty city page would be a soft 404

  const place = `${name}${state ? `, ${state}` : ''}`
  const noun = nounFor(domain)
  const crumbs = [
    { name: getDomainConfig(domain).appName, path: '/' },
    { name: 'Centers', path: '/centers' },
    { name: place, path: `/centers/in/${city}` },
  ]
  const jsonLd = jsonLdString(listJsonLd(`${capitalize(noun)} centers in ${place}`, `/centers/in/${city}`, centers, crumbs, domain))

  return (
    <JobsShell domain={domain}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <section className="mx-auto max-w-6xl px-6 py-14">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
          <ol className="flex flex-wrap items-center gap-2">
            <li><Link href="/" className="hover:text-brand-600 hover:underline">{crumbs[0].name}</Link></li>
            <li aria-hidden>›</li>
            <li><Link href="/centers" className="hover:text-brand-600 hover:underline">Centers</Link></li>
            <li aria-hidden>›</li>
            <li aria-current="page" className="font-semibold text-text-main">{place}</li>
          </ol>
        </nav>
        <h1 className="mb-2 text-4xl font-extrabold tracking-tight text-heading">{capitalize(noun)} centers in {place}</h1>
        <p className="mb-10 text-lg text-muted">{centers.length} center{centers.length === 1 ? '' : 's'} in {place}. See programs, meet the team and ask for a tour.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          {centers.map(c => <CenterCard key={c.handle} center={c} />)}
        </div>
        <p className="mt-8 text-sm">
          <Link href={`/jobs/in/${city}`} className="font-semibold text-brand-600 hover:underline">See {noun} jobs in {place}</Link>
        </p>
      </section>
    </JobsShell>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { MapPin } from 'lucide-react'
import { getDomainKey, getDomainConfig } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'
import { listCenterCities, listPublicCenters } from '@/lib/server/public-center'
import { capitalize, jsonLdString, listJsonLd, nounFor } from '@/lib/center-seo'
import { JobsShell } from '@/app/jobs/_components/JobsShell'
import { CenterCard } from './_components/CenterCard'

async function siteDomain() {
  return getDomainKey((await headers()).get('host') || '')
}

export async function generateMetadata(): Promise<Metadata> {
  const domain = await siteDomain()
  const noun = nounFor(domain)
  const centers = await listPublicCenters(domain)
  const title = `${capitalize(noun)} centers near you`
  const description = `Find ${noun} centers on ${getDomainConfig(domain).appName}: programs, team, open jobs and online tour requests.`
  return {
    title,
    description,
    alternates: { canonical: `${siteUrl(domain)}/centers` },
    // Nothing to list yet: keep the empty page out of search
    robots: centers.length === 0 ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: { title, description, url: `${siteUrl(domain)}/centers`, type: 'website', locale: 'en_US', siteName: getDomainConfig(domain).appName },
  }
}

/** Public: every center with a public page, and the cities they are in */
export default async function CentersDirectoryPage() {
  const domain = await siteDomain()
  const [centers, cities] = await Promise.all([listPublicCenters(domain), listCenterCities(domain)])
  const noun = nounFor(domain)
  const crumbs = [{ name: getDomainConfig(domain).appName, path: '/' }, { name: 'Centers', path: '/centers' }]
  const jsonLd = jsonLdString(listJsonLd(`${capitalize(noun)} centers`, '/centers', centers, crumbs, domain))

  return (
    <JobsShell domain={domain}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <section className="mx-auto max-w-6xl px-6 py-14">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
          <ol className="flex items-center gap-2">
            <li><Link href="/" className="hover:text-brand-600 hover:underline">{crumbs[0].name}</Link></li>
            <li aria-hidden>›</li>
            <li aria-current="page" className="font-semibold text-text-main">Centers</li>
          </ol>
        </nav>
        <h1 className="mb-2 text-4xl font-extrabold tracking-tight text-heading">{capitalize(noun)} centers</h1>
        <p className="mb-10 max-w-2xl text-lg text-muted">Learn about local centers: their programs and team, who is hiring, and how to ask for a tour.</p>

        {cities.length > 0 && (
          <div className="mb-10">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted">Browse by city</h2>
            <div className="flex flex-wrap gap-2">
              {cities.map(c => (
                <Link key={c.slug} href={`/centers/in/${c.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-4 py-2 text-sm font-semibold text-brand-600 hover:bg-brand-50">
                  <MapPin className="h-4 w-4" aria-hidden /> {c.city}{c.state ? `, ${c.state}` : ''} <span className="text-muted">({c.count})</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {centers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center text-muted">
            No centers are listed yet. Looking for work instead? <Link href="/jobs" className="font-semibold text-brand-600 hover:underline">Browse open jobs</Link>.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {centers.map(c => <CenterCard key={c.handle} center={c} />)}
          </div>
        )}
      </section>
    </JobsShell>
  )
}

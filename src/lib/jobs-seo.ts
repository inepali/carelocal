import type { Metadata, ResolvingMetadata } from 'next'
import type { DomainKey } from '@/lib/domain-config'
import { getDomainConfig } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'
import { breadcrumbJsonLd, type Crumb } from '@/lib/center-seo'
import type { PublicJob } from '@/lib/server/public-jobs'

/** Social and search metadata for the public job pages, one place so every page says its own thing. */

/**
 * Open Graph and Twitter tags for a page. A page that sets its own openGraph loses the site-wide share image, so the
 * parent's images are carried over, and the share title/description are the page's own (not the home page's).
 */
export async function shareTags(parent: ResolvingMetadata, domain: DomainKey, page: { title: string; description: string; path: string }): Promise<Pick<Metadata, 'openGraph' | 'twitter'>> {
  const resolved = await parent
  const images = resolved.openGraph?.images
  return {
    openGraph: {
      title: page.title, description: page.description, url: `${siteUrl(domain)}${page.path}`,
      type: 'website', locale: 'en_US', siteName: getDomainConfig(domain).appName, ...(images ? { images } : {}),
    },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description, ...(images ? { images: images as never } : {}) },
  }
}

const jobUrl = (domain: DomainKey, job: Pick<PublicJob, 'slug' | 'center'>) => `${siteUrl(domain)}/jobs/${job.center.slug}/${job.slug}`

/** Home > Jobs > City > Role, for a jobs list page */
export function jobsCrumbs(domain: DomainKey, parts: { name: string; path: string }[] = []): Crumb[] {
  return [
    { name: getDomainConfig(domain).appName, path: '/' },
    { name: 'Jobs', path: '/jobs' },
    ...parts,
  ]
}

/** A jobs list page: a collection of postings plus its breadcrumb */
export function jobsListJsonLd(domain: DomainKey, name: string, path: string, jobs: PublicJob[], crumbs: Crumb[]) {
  const base = siteUrl(domain)
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${base}${path}#page`,
        url: `${base}${path}`,
        name,
        breadcrumb: { '@id': `${base}${path}#breadcrumb` },
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: jobs.map((j, i) => ({ '@type': 'ListItem', position: i + 1, url: jobUrl(domain, j), name: `${j.title} at ${j.center.name}` })),
        },
      },
      breadcrumbJsonLd(crumbs, domain, `${base}${path}#breadcrumb`),
    ],
  }
}

/** The breadcrumb of one job page, as its own JSON-LD block (the job's JobPosting block stays separate) */
export function jobBreadcrumbJsonLd(domain: DomainKey, crumbs: Crumb[]) {
  return { '@context': 'https://schema.org', ...breadcrumbJsonLd(crumbs, domain) }
}

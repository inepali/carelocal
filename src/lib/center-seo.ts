import type { DomainKey } from '@/lib/domain-config'
import { getDomainConfig } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'
import { citySlug } from '@/lib/server/public-jobs'
import type { PublicCenterPage, PublicCenterSummary } from '@/lib/server/public-center'

/** Titles, descriptions, URLs and structured data for the public center pages. One place, so the page, its
 *  social image and the listing pages always say the same thing. */

/** "child care", "healthcare", "senior care" */
export const nounFor = (domain: DomainKey) => (domain === 'healthcare' ? 'healthcare' : domain === 'senior' ? 'senior care' : 'child care')
export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export const placeOf = (c: { city: string | null; state: string | null }) => [c.city, c.state].filter(Boolean).join(', ')

/** Collapse whitespace and cut at a word boundary, adding an ellipsis when shortened */
export function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`
}

export const centerPath = (handle: string) => `/centers/${handle}`
export const centerUrl = (domain: DomainKey, handle: string) => `${siteUrl(domain)}${centerPath(handle)}`
export const cityPath = (c: { city: string | null; state: string | null }) => `/centers/in/${citySlug(c.city, c.state)}`

/** "Kiddie Academy of Harrisburg – Child care in Harrisburg, NC": the name, the category and the place people search for */
export function centerTitle(c: Pick<PublicCenterPage, 'name' | 'city' | 'state'>, domain: DomainKey) {
  const place = placeOf(c)
  return `${c.name} – ${capitalize(nounFor(domain))}${place ? ` in ${place}` : ''}`
}

/** The center's own words when it wrote some, else a summary built from what it published. About 155 characters. */
export function centerDescription(c: PublicCenterPage, domain: DomainKey, openJobs: number) {
  if (c.description) return clip(c.description, 158)
  const place = placeOf(c)
  const parts = [`${c.name} is a ${nounFor(domain)} center${place ? ` in ${place}` : ''}.`]
  if (c.programs.length > 0) parts.push(`Programs include ${c.programs.slice(0, 3).map(p => p.name).join(', ')}.`)
  if (openJobs > 0) parts.push(`${openJobs} open job${openJobs === 1 ? '' : 's'}.`)
  if (c.toursEnabled) parts.push('Request a tour online.')
  return clip(parts.join(' '), 158)
}

export interface Crumb { name: string; path: string }

/** Home › Centers › City › Center */
export function centerCrumbs(c: Pick<PublicCenterPage, 'name' | 'handle' | 'city' | 'state'>, domain: DomainKey): Crumb[] {
  const place = placeOf(c)
  return [
    { name: getDomainConfig(domain).appName, path: '/' },
    { name: 'Centers', path: '/centers' },
    ...(c.city ? [{ name: place, path: cityPath(c) }] : []),
    { name: c.name, path: centerPath(c.handle) },
  ]
}

export function breadcrumbJsonLd(crumbs: Crumb[], domain: DomainKey, id?: string) {
  const base = siteUrl(domain)
  return {
    '@type': 'BreadcrumbList',
    ...(id ? { '@id': id } : {}),
    itemListElement: crumbs.map((crumb, i) => ({ '@type': 'ListItem', position: i + 1, name: crumb.name, item: `${base}${crumb.path === '/' ? '' : crumb.path}` })),
  }
}

/**
 * schema.org graph for a center page: the business (ChildCare for child care, LocalBusiness elsewhere), the web
 * page and the breadcrumb. No aggregateRating: Google does not show stars for ratings a business publishes about
 * itself, and marking them up risks a manual action.
 */
export function centerJsonLd(c: PublicCenterPage, domain: DomainKey, title: string, description: string) {
  const base = siteUrl(domain)
  const url = centerUrl(domain, c.handle)
  const place = placeOf(c)
  const query = encodeURIComponent([c.name, c.address, place, c.zip].filter(Boolean).join(', '))
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': domain === 'childcare' ? 'ChildCare' : 'LocalBusiness',
        '@id': `${url}#business`,
        name: c.name,
        url,
        description,
        ...(c.logoUrl ? { logo: c.logoUrl, image: c.logoUrl } : {}),
        ...(c.phone ? { telephone: c.phone } : {}),
        ...(c.email ? { email: c.email } : {}),
        ...(c.licenseNumber ? { identifier: { '@type': 'PropertyValue', name: 'License number', value: c.licenseNumber } } : {}),
        address: {
          '@type': 'PostalAddress',
          ...(c.address ? { streetAddress: c.address } : {}),
          ...(c.city ? { addressLocality: c.city } : {}),
          ...(c.state ? { addressRegion: c.state } : {}),
          ...(c.zip ? { postalCode: c.zip } : {}),
          addressCountry: 'US',
        },
        ...(c.city ? { areaServed: { '@type': 'City', name: c.city } } : {}),
        ...(c.address || c.city ? { hasMap: `https://www.google.com/maps/search/?api=1&query=${query}` } : {}),
        ...(c.programs.length > 0 ? {
          hasOfferCatalog: {
            '@type': 'OfferCatalog',
            name: 'Programs',
            itemListElement: c.programs.map(p => ({
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: p.name,
                ...(p.description ? { description: clip(p.description, 300) } : {}),
                ...(p.ageRange ? { audience: { '@type': 'Audience', audienceType: p.ageRange } } : {}),
              },
            })),
          },
        } : {}),
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: title,
        description,
        dateModified: c.lastModified,
        isPartOf: { '@type': 'WebSite', name: getDomainConfig(domain).appName, url: base },
        about: { '@id': `${url}#business` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      breadcrumbJsonLd(centerCrumbs(c, domain), domain, `${url}#breadcrumb`),
    ],
  }
}

/** JSON-LD for a list page (directory or city): an ItemList of the centers plus the breadcrumb */
export function listJsonLd(name: string, path: string, centers: PublicCenterSummary[], crumbs: Crumb[], domain: DomainKey) {
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
          itemListElement: centers.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: centerUrl(domain, c.handle), name: c.name })),
        },
      },
      breadcrumbJsonLd(crumbs, domain, `${base}${path}#breadcrumb`),
    ],
  }
}

/** Safe to place inside <script type="application/ld+json"> */
export const jsonLdString = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c')

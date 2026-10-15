import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { getDomainKey } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'

/** Public pages worth ranking, per domain (login / password pages are noindex). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host') || 'carelocal.co'
  const baseUrl = siteUrl(getDomainKey(host))
  const lastModified = new Date()

  return [
    { url: baseUrl, lastModified, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${baseUrl}/register`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/contact`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ]
}

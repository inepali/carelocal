import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { getDomainKey } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'
import { listJobCities, listPublicJobs } from '@/lib/server/public-jobs'

/** Public pages worth ranking, per domain (login / password pages are noindex). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host') || 'carelocal.co'
  const domain = getDomainKey(host)
  const baseUrl = siteUrl(domain)
  const lastModified = new Date()

  // Open jobs and the cities hiring (Google for Jobs reads the JobPosting data on each job page)
  const [jobs, cities] = await Promise.all([listPublicJobs(domain), listJobCities(domain)]).catch(() => [[], []] as const)

  return [
    { url: baseUrl, lastModified, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${baseUrl}/jobs`, lastModified, changeFrequency: 'daily', priority: 0.9 },
    ...cities.map(c => ({ url: `${baseUrl}/jobs/in/${c.slug}`, lastModified, changeFrequency: 'daily' as const, priority: 0.8 })),
    ...jobs.map(j => ({ url: `${baseUrl}/jobs/${j.center.slug}/${j.slug}`, lastModified: new Date(j.updated_at), changeFrequency: 'weekly' as const, priority: 0.7 })),
    { url: `${baseUrl}/register`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/contact`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ]
}

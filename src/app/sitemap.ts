import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { getDomainKey } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'
import { citySlug, listJobCities, listJobCityRoles, listPublicJobs, roleSlug } from '@/lib/server/public-jobs'
import { listCenterCities, listPublicCenterHandles } from '@/lib/server/public-center'

/** Public pages worth ranking, per domain (login / password pages are noindex). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host') || 'carelocal.co'
  const domain = getDomainKey(host)
  const baseUrl = siteUrl(domain)
  // Only real change dates: a date that moves on every request teaches search engines to ignore lastmod
  const latest = (dates: string[]) => (dates.length ? new Date(Math.max(...dates.map(d => new Date(d).getTime()))) : undefined)
  const jobsIn = (city: string, role?: string) => jobs.filter(j => citySlug(j.center.city, j.center.state) === city && (!role || (j.role_value && roleSlug(j.role_value) === role))).map(j => j.updated_at)

  // Open jobs and the cities hiring (Google for Jobs reads the JobPosting data on each job page)
  const [jobs, cities, cityRoles, centers, centerCities] = await Promise.all([listPublicJobs(domain), listJobCities(domain), listJobCityRoles(domain), listPublicCenterHandles(domain), listCenterCities(domain)]).catch(() => [[], [], [], [], []] as const)

  return [
    { url: baseUrl, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${baseUrl}/jobs`, lastModified: latest(jobs.map(j => j.updated_at)), changeFrequency: 'daily', priority: 0.9 },
    ...cities.map(c => ({ url: `${baseUrl}/jobs/in/${c.slug}`, lastModified: latest(jobsIn(c.slug)), changeFrequency: 'daily' as const, priority: 0.8 })),
    ...cityRoles.map(r => ({ url: `${baseUrl}/jobs/in/${r.citySlug}/${r.roleSlug}`, lastModified: latest(jobsIn(r.citySlug, r.roleSlug)), changeFrequency: 'daily' as const, priority: 0.75 })),
    // Centers with a public page that has something to read (thin pages are noindex and left out)
    ...(centers.length > 0 ? [{ url: `${baseUrl}/centers`, lastModified: latest(centers.map(c => c.updatedAt)), changeFrequency: 'daily' as const, priority: 0.8 }] : []),
    ...centerCities.map(c => ({ url: `${baseUrl}/centers/in/${c.slug}`, changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...centers.map(c => ({ url: `${baseUrl}/centers/${c.handle}`, lastModified: new Date(c.updatedAt), changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...jobs.map(j => ({ url: `${baseUrl}/jobs/${j.center.slug}/${j.slug}`, lastModified: new Date(j.updated_at), changeFrequency: 'weekly' as const, priority: 0.7 })),
    { url: `${baseUrl}/register`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/contact`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/terms`, changeFrequency: 'yearly', priority: 0.3 },
  ]
}

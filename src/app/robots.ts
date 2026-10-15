import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { getDomainKey } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host') || 'carelocal.co'
  const baseUrl = siteUrl(getDomainKey(host))

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Signed-in app areas and APIs (also sent X-Robots-Tag: noindex, see next.config.ts)
      disallow: ['/admin/', '/center/', '/staff/', '/mobile/', '/api/'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}

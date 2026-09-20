import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { getDomainKey } from '@/lib/domain-config'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const headersList = await headers()
  const host = headersList.get('host') || 'carelocal.co'
  const domainKey = getDomainKey(host)
  const baseUrl = domainKey === 'healthcare' ? 'https://carelocal.net' : domainKey === 'senior' ? 'https://carelocalsenior.com' : 'https://carelocal.co'

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/center/', '/staff/', '/api/'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}

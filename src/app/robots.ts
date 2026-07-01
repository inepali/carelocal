import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const headersList = await headers()
  const host = headersList.get('host') || 'carelocal.co'
  const isHealthcare = host.includes('carelocal.net') || host.includes('carelocalhealth.com') || host.includes(':3001') || host.startsWith('3001')
  const baseUrl = isHealthcare ? 'https://carelocal.net' : 'https://carelocal.co'

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/center/', '/staff/', '/api/'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { getDomainConfig } from '@/lib/domain-config'

export async function generateMetadata(): Promise<Metadata> {
  const config = getDomainConfig((await headers()).get('host') || '')
  return {
    title: 'Contact Us',
    description: `Questions about ${config.appName}? Contact our team about staffing, compliance and document management for your ${config.domainKey === 'healthcare' ? 'facility' : config.domainKey === 'senior' ? 'care organization' : 'center'} — sales, support and partnerships.`,
    alternates: { canonical: '/contact' },
  }
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

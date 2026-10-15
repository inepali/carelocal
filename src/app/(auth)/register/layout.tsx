import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { getDomainConfig } from '@/lib/domain-config'

export async function generateMetadata(): Promise<Metadata> {
  const config = getDomainConfig((await headers()).get('host') || '')
  const org = config.domainKey === 'healthcare' ? 'Facilities' : config.domainKey === 'senior' ? 'Care organizations' : 'Childcare centers'
  return {
    title: 'Start Your Free Trial',
    description: `Create your ${config.appName} account. ${org} get a free trial of staffing and compliance tools — staff accounts are always free.`,
    alternates: { canonical: '/register' },
  }
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { getDomainConfig, getDomainKey } from '@/lib/domain-config'
import ChildcareHomePage from './childcare/page'
import HealthcareHomePage from './healthcare/page'
import SeniorHomePage from './senior/page'

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const config = getDomainConfig(host)

  return {
    title: { absolute: config.title },
    description: config.description,
    alternates: { canonical: '/' },
  }
}

export default async function HomePage() {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const domainKey = getDomainKey(host)

  if (domainKey === 'healthcare') return <HealthcareHomePage />
  if (domainKey === 'senior') return <SeniorHomePage />
  return <ChildcareHomePage />
}

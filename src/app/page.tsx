import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { getDomainConfig } from '@/lib/domain-config'
import ChildcareHomePage from './childcare/page'
import HealthcareHomePage from './healthcare/page'

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const config = getDomainConfig(host)

  return {
    title: config.title,
    description: config.description,
  }
}

export default async function HomePage() {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const isHealthcare = host.includes('carelocalhealth.com') || host.includes(':3001') || host.startsWith('3001')

  if (isHealthcare) {
    return <HealthcareHomePage />
  }

  return <ChildcareHomePage />
}

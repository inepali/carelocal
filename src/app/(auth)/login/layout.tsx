import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { getDomainConfig } from '@/lib/domain-config'

export async function generateMetadata(): Promise<Metadata> {
  const config = getDomainConfig((await headers()).get('host') || '')
  return {
    title: 'Log In',
    description: `Log in to ${config.appName} to manage shifts, staff documents and compliance.`,
    // Utility page: keep it out of search results but let crawlers follow its links
    robots: { index: false, follow: true },
  }
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

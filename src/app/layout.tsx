import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { headers } from 'next/headers'
import { getDomainKey, getDomainConfig } from '@/lib/domain-config'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  weight: ['400', '500', '600', '700'],
})

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const domainKey = getDomainKey(host)
  const config = getDomainConfig(domainKey)
  const siteUrl = domainKey === 'healthcare' ? 'https://carelocal.net' : domainKey === 'senior' ? 'https://carelocalsenior.com' : 'https://carelocal.co'

  return {
    title: config.title,
    description: config.description,
    metadataBase: new URL(siteUrl),
    manifest: '/manifest.json',
    keywords: domainKey === 'healthcare'
      ? [
          'healthcare staff scheduling software',
          'hospital shift scheduling',
          'medical staffing platform',
          'PRN nursing pool',
          'clinic shift scheduler',
          'SMS shift blast nursing',
          'clinical compliance software',
          'nursing staffing alternative',
          'CNA shift scheduler'
        ]
      : domainKey === 'senior'
        ? [
          'senior care staffing software',
          'caregiver scheduling software',
          'home care agency staffing',
          'assisted living shift scheduling',
          'caregiver call-out coverage',
          'senior care workforce platform'
        ]
        : [
          'childcare staff scheduling software',
          'daycare substitute management',
          'preschool staff scheduling',
          'daycare substitute pool',
          'childcare shift scheduler',
          'SMS shift blast daycare',
          'childcare compliance software',
          'daycare staffing agency alternative',
          'early childhood educator staffing',
          'substitute teacher tracker daycare'
        ],
    openGraph: {
      title: config.title,
      description: config.description,
      url: siteUrl,
      siteName: config.appName,
      type: 'website',
    },
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const domainKey = getDomainKey(host)
  const themeClass = getDomainConfig(domainKey).themeClass

  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${themeClass}`}>
      <body className="antialiased">{children}</body>
    </html>
  )
}

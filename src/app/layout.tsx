import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { headers } from 'next/headers'
import { getDomainKey, getDomainConfig, type DomainKey } from '@/lib/domain-config'
import { siteUrl, SEO_KEYWORDS } from '@/lib/site'
import { Analytics } from '@vercel/analytics/next'
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

const THEME_COLOR: Record<DomainKey, string> = {
  childcare: '#157354',
  healthcare: '#4f46e5',
  senior: '#157354',
}

async function currentDomain() {
  const headersList = await headers()
  return getDomainKey(headersList.get('host') || '')
}

export async function generateMetadata(): Promise<Metadata> {
  const domainKey = await currentDomain()
  const config = getDomainConfig(domainKey)
  const url = siteUrl(domainKey)

  return {
    metadataBase: new URL(url),
    // Pages set a short title ("Contact Us"); the template adds the brand.
    // Landing pages use an absolute title. Canonical URLs are set per page.
    title: { default: config.title, template: `%s | ${config.appName}` },
    description: config.description,
    applicationName: config.appName,
    keywords: SEO_KEYWORDS[domainKey],
    category: 'business',
    manifest: '/manifest.json',
    icons: {
      icon: [{ url: '/icon.png', type: 'image/png' }],
      apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    },
    formatDetection: { telephone: false },
    openGraph: {
      title: config.title,
      description: config.description,
      url,
      siteName: config.appName,
      locale: 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: config.title,
      description: config.description,
    },
  }
}

export async function generateViewport(): Promise<Viewport> {
  const domainKey = await currentDomain()
  return { themeColor: THEME_COLOR[domainKey] }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const domainKey = await currentDomain()
  const themeClass = getDomainConfig(domainKey).themeClass

  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${themeClass}`}>
      <body className="antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  )
}

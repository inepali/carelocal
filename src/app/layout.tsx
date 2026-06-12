import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
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

export const metadata: Metadata = {
  title: 'CareLocal — Childcare Staffing Software & Daycare Substitute Management',
  description:
    'CareLocal is the childcare staff scheduling software built exclusively for early learning centers and daycares. Post shifts, SMS blast your substitute pool, and organize teacher certifications, background checks, and compliance logs in one dashboard.',
  metadataBase: new URL('https://carelocal.io'),
  manifest: '/manifest.json',
  keywords: [
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
    title: 'CareLocal — Childcare Staffing Software & Daycare Substitute Management',
    description: 'Post open shifts, SMS blast your daycare substitute teacher pool, and fill positions in minutes — not hours.',
    url: 'https://carelocal.io',
    siteName: 'CareLocal',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  )
}

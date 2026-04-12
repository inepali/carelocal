import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'CareLocal — Childcare Staffing. Simplified.',
  description:
    'CareLocal is the staffing coordination platform built exclusively for childcare centers. Post shifts, blast fill in minutes, and keep all staff documents organized in one place.',
  metadataBase: new URL('https://carelocal.io'),
  openGraph: {
    title: 'CareLocal — Childcare Staffing. Simplified.',
    description: 'Post open shifts, SMS blast your staff pool, and fill childcare positions in minutes — not hours.',
    url: 'https://carelocal.io',
    siteName: 'CareLocal',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">{children}</body>
    </html>
  )
}

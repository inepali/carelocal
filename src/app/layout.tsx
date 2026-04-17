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
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  )
}

import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Time Clock',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

/** The center's Time Clock tablet: no account, no site navigation */
export default function TimeClockLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh select-none bg-surface pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-text-main">
      {children}
    </div>
  )
}

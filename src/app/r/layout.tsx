import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Leave a review',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

/** "Ask for a review" links: no site navigation, phone-first */
export default function ReviewLinkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-text-main">
      <div className="mx-auto w-full max-w-xl px-4 py-8">{children}</div>
    </div>
  )
}

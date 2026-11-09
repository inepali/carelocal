import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Announcement',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

/** The link in an announcement email: no account, no site navigation (like the parent page). */
export default function AnnouncementLinkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-text-main">
      <div className="mx-auto w-full max-w-xl px-4 pb-16">{children}</div>
    </div>
  )
}

import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Parent',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

/** The parent portal: no account, no site navigation. Also the page a future wrapper app opens. */
export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-text-main">
      <div className="mx-auto w-full max-w-xl px-4 pb-16">{children}</div>
    </div>
  )
}

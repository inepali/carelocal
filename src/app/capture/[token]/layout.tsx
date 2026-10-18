import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Send a document',
  robots: { index: false, follow: false },
  referrer: 'no-referrer', // keep the one-time token out of Referer headers
}

export default function CaptureLayout({ children }: { children: React.ReactNode }) {
  return children
}

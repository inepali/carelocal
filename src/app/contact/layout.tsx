import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact Us | CareLocal Childcare Staffing',
  description: 'Have questions about CareLocal\'s childcare staffing and substitute scheduling software? Contact our support, sales, and partnerships team today.',
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

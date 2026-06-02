import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Start Free Trial | CareLocal Childcare Staffing',
  description: 'Create a free CareLocal account. Childcare centers start a 6-month free trial to manage sub pools and post shifts. Staff accounts are always free.',
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

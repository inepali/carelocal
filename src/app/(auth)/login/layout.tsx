import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Log In | CareLocal Childcare Staffing Portal',
  description: 'Log in to the CareLocal childcare staffing platform to manage shifts, view schedules, and update teacher documents.',
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

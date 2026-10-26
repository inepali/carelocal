import { GettingStarted } from '@/components/staff/GettingStarted'

export default function MobileGettingStartedPage() {
  // The profile editor only exists in the staff portal; documents have their own mobile page
  return <GettingStarted profileHref="/staff/profile" documentsHref="/mobile/documents" />
}

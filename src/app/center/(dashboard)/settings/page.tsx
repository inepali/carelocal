import { redirect } from 'next/navigation'

// Center profile moved to the tabbed About page; keep old links working.
export default function CenterSettingsRedirect() {
  redirect('/center/about')
}

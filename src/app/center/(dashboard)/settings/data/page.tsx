import { redirect } from 'next/navigation'

// Manage Data now lives in the About page; keep old links (and ?tab= deep links) working.
export default async function ManageDataRedirect({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  redirect(`/center/about${tab ? `?tab=${encodeURIComponent(tab)}` : ''}#data`)
}

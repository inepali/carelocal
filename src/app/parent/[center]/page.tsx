import { redirect } from 'next/navigation'
import { normalizeCenterKey } from '@/lib/parent-code'
import { loadPortalCenter, loadPortalHome, parentTokenHash } from '@/lib/server/parent-portal'
import { NoCenterLink, SignInForm } from '../_components/SignInForm'

/**
 * /parent/<key>: a center's private sign-in link. The parent types their 6-digit PIN; PINs are unique only
 * within a center, so the link says which center. Already signed in for this center: straight to /parent.
 */
export default async function ParentCenterSignIn({ params, searchParams }: {
  params: Promise<{ center: string }>
  searchParams: Promise<{ expired?: string }>
}) {
  const [{ center: raw }, sp] = await Promise.all([params, searchParams])
  const key = normalizeCenterKey(raw)
  const center = key ? await loadPortalCenter(key) : null
  if (!center) return <NoCenterLink broken />

  const tokenHash = await parentTokenHash()
  const home = tokenHash ? await loadPortalHome(tokenHash) : null
  if (home && home.center.id === center.id) redirect('/parent')

  return <SignInForm centerKey={center.key} centerName={center.name} expired={sp.expired === '1'} />
}

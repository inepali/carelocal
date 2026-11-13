import { NextResponse } from 'next/server'
import { parentDb } from '@/lib/server/parent-portal'

/**
 * Parents on a center's review link: on to the parent portal's rating page, which signs them in with their PIN
 * and checks they have an enrolled child. The portal key is looked up server-side (service role only).
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const c = code.toLowerCase()
  if (!/^[0-9a-hjkmnp-tv-z]{12}$/.test(c)) return NextResponse.redirect(new URL('/parent', request.url))
  const { data } = await parentDb().rpc('care_review_link_parent_key', { p_code: c })
  const key = typeof data === 'string' ? data : null
  return NextResponse.redirect(new URL(key ? `/parent/${key}?to=review` : `/r/${c}`, request.url))
}

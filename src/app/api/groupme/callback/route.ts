import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GROUPME_STATE_COOKIE, GROUPME_TOKEN_COOKIE } from '@/lib/server/groupme'

/**
 * GroupMe sends the director back here after sign-in, as ?access_token=... (GroupMe's implicit OAuth flow).
 * The token is kept for 10 minutes in an httpOnly cookie, only long enough to pick a group and create the bot,
 * then deleted. It is accepted only from a signed-in owner/admin who started the connection from the About page.
 */
export async function GET(req: NextRequest) {
  const back = (result: string) => {
    const url = new URL('/center/about', req.nextUrl.origin)
    url.searchParams.set('groupme', result)
    url.hash = 'profile'
    return url
  }

  const token = req.nextUrl.searchParams.get('access_token')
  const started = req.cookies.get(GROUPME_STATE_COOKIE)?.value
  if (!token || !/^[A-Za-z0-9]{10,200}$/.test(token) || !started) {
    const res = NextResponse.redirect(back('failed'))
    res.cookies.delete(GROUPME_STATE_COOKIE)
    return res
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: admin } = user
    ? await supabase.from('center_admins').select('center_id').eq('user_id', user.id).in('role', ['owner', 'admin']).limit(1).maybeSingle()
    : { data: null }
  if (!admin) {
    const res = NextResponse.redirect(new URL('/login', req.nextUrl.origin))
    res.cookies.delete(GROUPME_STATE_COOKIE)
    return res
  }

  const res = NextResponse.redirect(back('choose'))
  res.cookies.delete(GROUPME_STATE_COOKIE)
  res.cookies.set(GROUPME_TOKEN_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600,
  })
  return res
}

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getDomainKey, type DomainKey } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'
import { canAccessDomain, WRONG_DOMAIN_ERROR } from '@/lib/supabase/user-domain'

export async function updateSession(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const domainKey = getDomainKey(host)
  const homePath = `/${domainKey}`

  // SEO: each vertical's landing page lives only at "/" of its own domain.
  // /childcare, /healthcare and /senior are internal paths (see the rewrite below),
  // so a direct visit is redirected instead of serving duplicate content.
  const vertical = request.nextUrl.pathname.replace(/\/$/, '')
  if (vertical === '/childcare' || vertical === '/healthcare' || vertical === '/senior') {
    const target = vertical.slice(1) as DomainKey
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
    if (target === domainKey) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url, 308)
    }
    if (!isLocal) {
      return NextResponse.redirect(new URL('/', siteUrl(target)), 308)
    }
  }

  let supabaseResponse = request.nextUrl.pathname === '/'
    ? NextResponse.rewrite(new URL(homePath, request.url), {
        request,
      })
    : NextResponse.next({
        request,
      })

  // Create an unauthenticated supabase client
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfjpsucszngvsnacjscq.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmanBzdWNzem5ndnNuYWNqc2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NjM5NjIsImV4cCI6MjA5MTUzOTk2Mn0.gFy0P-2A4YO3TgGOkhYXtPheXTP0DuQ6wcunftAELc0',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = request.nextUrl.pathname === '/'
            ? NextResponse.rewrite(new URL(homePath, request.url), {
                request,
              })
            : NextResponse.next({
                request,
              })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isCenterRoute = request.nextUrl.pathname.startsWith('/center')
  const isStaffRoute = request.nextUrl.pathname.startsWith('/staff')
  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin')

  // 1. Basic Auth Protection
  if ((isCenterRoute || isStaffRoute || isAdminRoute) && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  // 2. Role-Based Protection for Super Admin
  if (isAdminRoute && user?.app_metadata?.is_super_admin !== true) {
    const url = request.nextUrl.clone()
    url.pathname = '/login' // Or a "forbidden" page
    return NextResponse.redirect(url)
  }

  // 3. Vertical Lock: accounts may only use the vertical (childcare/healthcare/senior) they signed up on
  const isMobileRoute = request.nextUrl.pathname.startsWith('/mobile') && request.nextUrl.pathname !== '/mobile/login'
  if (user && (isCenterRoute || isStaffRoute || isMobileRoute)) {
    const siteDomain = domainKey
    if (!(await canAccessDomain(supabase, user, siteDomain))) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = isMobileRoute ? '/mobile/login' : '/login'
      url.search = ''
      url.searchParams.set('error', WRONG_DOMAIN_ERROR)
      const redirect = NextResponse.redirect(url)
      // Carry the cleared session cookies onto the redirect.
      supabaseResponse.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie))
      return redirect
    }
  }

  return supabaseResponse
}

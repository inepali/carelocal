import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // Create an unauthenticated supabase client
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
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

  return supabaseResponse
}

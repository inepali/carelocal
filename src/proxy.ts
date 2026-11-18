import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    // Also skipped: files from public/ (service worker, manifests), robots/sitemap, share images,
    // and machine-to-machine routes (cron jobs, Stripe and Resend webhooks) that never use a browser session.
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|site\\.webmanifest|robots\\.txt|sitemap\\.xml|api/cron/|api/webhooks/|api/stripe/webhook|(?:.*/)?opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|json|webmanifest|txt|xml|woff2?|map)$).*)',
  ],
}

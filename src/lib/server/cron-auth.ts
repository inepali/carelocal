import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Guards Vercel Cron routes. Fails closed: without CRON_SECRET nobody gets in
 * (Vercel sends `Authorization: Bearer $CRON_SECRET` when the variable is set).
 * Returns a response to send back when the request is rejected, or null when it may proceed.
 */
export function rejectUnauthorizedCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET is not set; refusing to run cron job')
    return NextResponse.json({ error: 'Cron is not configured' }, { status: 503 })
  }

  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(request.headers.get('authorization') ?? '')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

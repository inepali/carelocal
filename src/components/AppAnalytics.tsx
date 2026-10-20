'use client'

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next'

/**
 * Vercel Analytics with secrets removed from page URLs before they are sent:
 * the one-time token in /capture/<token> and the code / token in password-reset links.
 */
function redact(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url)
  url.pathname = url.pathname.replace(/^\/capture\/[^/]+/, '/capture/[token]')
  ;['code', 'token_hash', 'access_token', 'refresh_token'].forEach(key => url.searchParams.delete(key))
  url.hash = ''
  return { ...event, url: url.toString() }
}

export function AppAnalytics() {
  return <Analytics beforeSend={redact} />
}

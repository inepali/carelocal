import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Turns what someone typed ("example.com/enroll", "https://example.com") into a safe http(s) URL,
 * or null when it is empty or not a web address. Only http and https are allowed, so a saved value
 * can never be a javascript: or data: link.
 */
export function normalizeWebUrl(input: string | null | undefined): string | null {
  const text = (input ?? '').trim()
  if (!text) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

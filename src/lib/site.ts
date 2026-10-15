import type { DomainKey } from '@/lib/domain-config'

/** Public site per vertical (production). */
export const SITE_URLS: Record<DomainKey, string> = {
  childcare: 'https://carelocal.co',
  healthcare: 'https://carelocal.net',
  senior: 'https://carelocalsenior.com',
}

export function siteUrl(domainKey: DomainKey) {
  return SITE_URLS[domainKey]
}

/** Search keywords per vertical (minor signal for Bing / others; Google ignores meta keywords). */
export const SEO_KEYWORDS: Record<DomainKey, string[]> = {
  childcare: [
    'childcare staffing software',
    'childcare compliance software',
    'daycare staff file checklist',
    'daycare substitute scheduling',
    'childcare staff scheduling app',
    'daycare licensing compliance',
    'childcare training record tracking',
    'NC childcare staff file checklist',
    'childcare inspection tracking',
    'daycare substitute pool',
    'daycare staffing agency alternative',
    'early childhood education staffing',
  ],
  healthcare: [
    'healthcare staff scheduling software',
    'credential tracking software',
    'nurse credentialing software',
    'hospital shift scheduling',
    'PRN nursing pool',
    'clinic compliance software',
    'license expiration tracking',
    'facility inspection tracking',
    'medical staffing agency alternative',
  ],
  senior: [
    'senior care staffing software',
    'caregiver scheduling software',
    'caregiver compliance tracking',
    'home care agency software',
    'assisted living staff scheduling',
    'caregiver credential tracking',
    'caregiver call-out coverage',
  ],
}

/** Serializes JSON-LD safely for a <script> tag (escapes "<" per Next.js guidance). */
export function jsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

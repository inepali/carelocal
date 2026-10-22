import type { DomainKey } from '@/lib/domain-config'

/**
 * Shared by the Terms & Conditions and the Privacy Policy. Change LEGAL_UPDATED whenever the text of either
 * document changes: a legal page must show the date it was actually revised, not today's date.
 */
export const LEGAL_UPDATED = 'October 22, 2026'

export interface LegalVocab {
  /** "Center" / "Facility" / "Organization" and the plural */
  provider: string
  providers: string
  /** Article for the provider: "a center" / "an organization" (an: lower case, An: sentence start) */
  an: string
  An: string
  /** Who works there: "childcare professionals", "healthcare professionals", "caregivers" */
  professionals: string
  /** Regulations the provider answers to, e.g. "childcare" */
  regulation: string
  /** Who receives care */
  recipients: string
  /** What a family or visitor asks for a tour on behalf of */
  tourSubject: string
  /** Child-specific wording applies (names and birth or due dates are collected on tour requests) */
  childcare: boolean
}

export function legalVocab(domain: DomainKey): LegalVocab {
  if (domain === 'healthcare') {
    return { provider: 'Facility', providers: 'Facilities', an: 'a', An: 'A', professionals: 'healthcare professionals', regulation: 'healthcare and licensing', recipients: 'patients', tourSubject: 'a patient or family member', childcare: false }
  }
  if (domain === 'senior') {
    return { provider: 'Organization', providers: 'Organizations', an: 'an', An: 'An', professionals: 'caregivers', regulation: 'senior care and licensing', recipients: 'residents and clients', tourSubject: 'a loved one', childcare: false }
  }
  return { provider: 'Center', providers: 'Centers', an: 'a', An: 'A', professionals: 'childcare professionals', regulation: 'childcare', recipients: 'children', tourSubject: 'a child', childcare: true }
}

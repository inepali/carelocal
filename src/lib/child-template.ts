// Self-contained on purpose (type-only imports, no path aliases) so the access-rule tests can load it directly.
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The NC child record template: sections and rules, built from docs/child-files/nc-rules-verification.md
 * (10A NCAC 09 .0801, .0802, .2318; G.S. 130A-155; G.S. 110-91(1)).
 *
 * Only timings that were VERIFIED are encoded. Where a deadline or renewal was not verified, the rule has no
 * deadline and its note says so, rather than guessing. Not legal advice.
 */

export interface ChildSectionDef { id: string; label: string; description: string }

/** Child rules live in sections whose id starts with "child_" (the database enforces this). */
export const CHILD_SECTIONS: ChildSectionDef[] = [
  { id: 'child_enrollment', label: 'Enrollment & Authorizations', description: 'Application, emergency care information and the signed emergency treatment authorization' },
  { id: 'child_health', label: 'Health & Immunizations', description: 'Health assessment, immunization record and medical action plans' },
  { id: 'child_policies', label: 'Parent Acknowledgments & Permissions', description: 'Signed policy acknowledgments and parental permissions' },
]

export const isChildSection = (id: string) => id.startsWith('child_')

export interface ChildTemplateItem {
  key: string
  document_name: string
  section: string
  document_category: 'medical' | 'other'
  due_within_days: number | null
  renewal_type: 'none' | 'interval'
  renewal_months: number | null
  is_conditional: boolean
  /** The rule it comes from */
  rule: string
  notes: string
}

const UNVERIFIED = 'Timing and when it applies are not yet verified against the rule text.'

export const NC_CHILD_REQUIREMENTS: ChildTemplateItem[] = [
  // ── Enrollment & authorizations: on file the child's FIRST DAY ──
  { key: 'application', document_name: 'Child Application (signed by parent)', section: 'child_enrollment', document_category: 'other',
    due_within_days: 0, renewal_type: 'none', renewal_months: null, is_conditional: false, rule: '.0801(a)',
    notes: 'On file the first day the child attends. Includes emergency medical information, date of birth, allergies, health needs, fears or behavior notes, and the people the child may be released to.' },
  { key: 'emergency-info', document_name: 'Emergency Medical Care Information', section: 'child_enrollment', document_category: 'medical',
    due_within_days: 0, renewal_type: 'interval', renewal_months: 12, is_conditional: false, rule: '.0802(c)',
    notes: 'On file the first day. Update as changes occur and at least annually.' },
  { key: 'emergency-authorization', document_name: 'Emergency Treatment Authorization (signed by parent)', section: 'child_enrollment', document_category: 'medical',
    due_within_days: 0, renewal_type: 'none', renewal_months: null, is_conditional: false, rule: '.0802(d)',
    notes: 'Signed statement authorizing the center to obtain emergency medical attention. On file the first day and easy for staff to reach.' },

  // ── Health & immunizations ──
  { key: 'medical-report', document_name: 'Child Medical Report (health assessment)', section: 'child_health', document_category: 'medical',
    due_within_days: 30, renewal_type: 'none', renewal_months: null, is_conditional: true, rule: 'G.S. 110-91(1); .0302(d)(2)',
    notes: 'Before admission or within 30 days after. Completed by a physician, nurse practitioner, physician assistant or public health nurse. A written religious objection can exempt a child in normal health (mark Not applicable with the reason). Renewal and school-age rules are not yet verified.' },
  { key: 'immunization', document_name: 'Immunization Record', section: 'child_health', document_category: 'medical',
    due_within_days: 30, renewal_type: 'none', renewal_months: null, is_conditional: false, rule: 'G.S. 130A-155; .0302(d)(2)',
    notes: '30 calendar days from the first day of attendance. A physician may certify more time for a multi-dose series (set a due date). After that the child may not attend unless the record is complete or an exemption is on file. Choose the child’s immunization status for the state report.' },
  { key: 'action-plan', document_name: 'Child Medical Action Plan', section: 'child_health', document_category: 'medical',
    due_within_days: 0, renewal_type: 'interval', renewal_months: 12, is_conditional: true, rule: '.0801(b)',
    notes: 'For a child with allergies, asthma or another chronic condition: attach to the application. Update annually and whenever it changes. Mark Not applicable if the child has no such needs.' },

  // ── Parent acknowledgments and permissions (kept for the child's file; most apply only to some children) ──
  { key: 'safe-sleep-policy', document_name: 'Safe Sleep Policy (parent acknowledgment)', section: 'child_policies', document_category: 'other',
    due_within_days: null, renewal_type: 'none', renewal_months: null, is_conditional: true, rule: '.0606(c)', notes: UNVERIFIED },
  { key: 'safe-sleep-amendment', document_name: 'Notice of Amendment to Safe Sleep Policy', section: 'child_policies', document_category: 'other',
    due_within_days: null, renewal_type: 'none', renewal_months: null, is_conditional: true, rule: '.0606(d)', notes: UNVERIFIED },
  { key: 'safe-sleep-waiver', document_name: 'Safe Sleep Waiver', section: 'child_policies', document_category: 'other',
    due_within_days: null, renewal_type: 'none', renewal_months: null, is_conditional: true, rule: '.0606(e)', notes: UNVERIFIED },
  { key: 'medication-permission', document_name: 'Parental Permission for Administration of Medication', section: 'child_policies', document_category: 'medical',
    due_within_days: null, renewal_type: 'none', renewal_months: null, is_conditional: true, rule: '.0803(3), (4), (6)-(9), (11)',
    notes: 'Needed before any medication is given. Medication administration records are kept separately for 6 months after (.2318(3)). ' + UNVERIFIED },
  { key: 'food-opt-out', document_name: 'Supplemental Food "Opt Out" Statement', section: 'child_policies', document_category: 'other',
    due_within_days: null, renewal_type: 'none', renewal_months: null, is_conditional: true, rule: '.0901(d)', notes: UNVERIFIED },
  { key: 'transport-permission', document_name: 'Parental Permission for Transportation and Off-Premises Activities', section: 'child_policies', document_category: 'other',
    due_within_days: null, renewal_type: 'none', renewal_months: null, is_conditional: true, rule: '.1003(i), (j); .1005(b)(3), (4)', notes: UNVERIFIED },
  { key: 'aquatic-permission', document_name: 'Parental Permission for Aquatic Activities', section: 'child_policies', document_category: 'other',
    due_within_days: null, renewal_type: 'none', renewal_months: null, is_conditional: true, rule: '.1403(i)', notes: UNVERIFIED },
  { key: 'discipline-policy', document_name: 'Discipline Policy (parent acknowledgment)', section: 'child_policies', document_category: 'other',
    due_within_days: null, renewal_type: 'none', renewal_months: null, is_conditional: false, rule: '.1804(a)', notes: UNVERIFIED },
  { key: 'discipline-change', document_name: 'Notice of Change to Discipline Policies', section: 'child_policies', document_category: 'other',
    due_within_days: null, renewal_type: 'none', renewal_months: null, is_conditional: true, rule: '.1804(b)', notes: UNVERIFIED },
  { key: 'sbs-policy', document_name: 'Shaken Baby Syndrome and Abusive Head Trauma Policy (parent acknowledgment)', section: 'child_policies', document_category: 'other',
    due_within_days: null, renewal_type: 'none', renewal_months: null, is_conditional: false, rule: '.0608', notes: UNVERIFIED },
]

const TEMPLATE_PREFIX = 'nc-child:'

/**
 * Adds the NC child rules to a center, skipping any it already has (safe to run again). Run it as the
 * center's signed-in admin. Child rules never appear on staff screens (audience = 'child').
 */
export async function seedNcChildRequirements(supabase: SupabaseClient, centerId: string) {
  const { data: existing, error: readError } = await supabase
    .from('center_document_requirements').select('template_key')
    .eq('center_id', centerId).eq('audience', 'child')
  if (readError) return { success: false as const, error: readError.message }

  const have = new Set((existing ?? []).map(r => r.template_key as string | null))
  const sortWithinSection: Record<string, number> = {}
  const rows = NC_CHILD_REQUIREMENTS.flatMap(item => {
    sortWithinSection[item.section] = (sortWithinSection[item.section] ?? 0) + 1
    if (have.has(TEMPLATE_PREFIX + item.key)) return []
    return [{
      center_id: centerId,
      audience: 'child',
      template_key: TEMPLATE_PREFIX + item.key,
      document_name: item.document_name,
      notes: `${item.notes} (Rule ${item.rule})`,
      document_category: item.document_category,
      section: item.section,
      // A document supplied by the subject. For children that is the parent's signed form or a medical record.
      evidence_type: 'staff_document',
      is_internal: false,
      is_required: !item.is_conditional,
      is_confidential: true,
      is_conditional: item.is_conditional,
      due_within_days: item.due_within_days,
      renewal_type: item.renewal_type,
      renewal_months: item.renewal_type === 'interval' ? item.renewal_months : null,
      applies_to: null,
      applies_to_class: null,
      sort_order: sortWithinSection[item.section],
    }]
  })
  if (rows.length === 0) return { success: true as const, added: 0, skipped: NC_CHILD_REQUIREMENTS.length }

  const { error } = await supabase.from('center_document_requirements').insert(rows)
  if (error) return { success: false as const, error: error.message }
  return { success: true as const, added: rows.length, skipped: NC_CHILD_REQUIREMENTS.length - rows.length }
}

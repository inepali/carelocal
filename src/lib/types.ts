import type { DomainKey } from '@/lib/domain-config'

export type SubscriptionTier = 'starter' | 'growth' | 'network' | 'enterprise'
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused'
export type StaffType = string  // A 'Role' value from center_lookups
export type AgeGroup = 'infant' | 'toddler' | 'preschool' | 'school_age' | 'mixed'
export type CenterStaffStatus = 'invited' | 'applying' | 'active' | 'inactive' | 'removed'
export type EmploymentClass = 'regular' | 'substitute'
export type DocumentCategory = string  // A 'Document Type' value from center_lookups
export type DocReviewStatus = 'missing' | 'pending_review' | 'accepted' | 'rejected' | 'expired'
/** Built-in ids ('personnel' | 'health' | 'training' | 'health_safety' | 'policies' | 'evaluations') or a center's own 'custom:<slug>' */
export type RequirementSection = string
export type EvidenceType = 'staff_document' | 'center_record' | 'acknowledgement' | 'training'
export type RenewalType = 'none' | 'interval' | 'document_expiry' | 'policy_change'
export type ShiftStatus = 'open' | 'filled' | 'cancelled' | 'unfilled'
export type ClaimStatus = 'pending' | 'confirmed' | 'cancelled'
export type MetroArea = {
  id: string
  name: string
  slug: string
  city?: string
  state_code: string
  timezone?: string
  is_active: boolean
  created_at: string
  staff_maintenance_fee?: number
}

export interface Center {
  id: string
  slug: string
  name: string
  address?: string
  city: string
  state: string
  zip?: string
  phone?: string
  email?: string
  director_name?: string
  license_number?: string
  max_capacity?: number
  logo_url?: string
  timezone?: string
  metro_area_id?: string
  subscription_tier: SubscriptionTier
  subscription_status: SubscriptionStatus
  stripe_customer_id?: string
  trial_ends_at?: string
  trial_months?: number
  staff_term?: string
  work_area_term?: string
  domain_key?: string
  created_at: string
  updated_at: string
}

export interface StaffProfile {
  id: string
  user_id: string
  first_name: string
  last_name: string
  phone?: string
  email: string
  city?: string
  state?: string
  zip?: string
  staff_type?: StaffType
  bio?: string
  metro_area_id?: string
  requested_employment_class?: EmploymentClass | null  // chosen at sign-up; the center sets the real class
  available_days: string[]
  available_from?: string
  available_to?: string
  preferred_payment_methods: string[]
  availability_notes?: string
  avatar_url?: string
  is_active: boolean
  domain_key?: string
  created_at: string
  updated_at: string
  balance_due?: number
}

/** A staff role type row from the staff_role_types table */
export interface StaffRoleType {
  id: string
  center_id: string | null  // null = platform default
  value: string
  label: string
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface StaffExperience {
  id: string
  staff_id: string
  employer: string
  role: string
  age_group?: AgeGroup
  start_month?: number
  start_year?: number
  end_month?: number
  end_year?: number
  is_current: boolean
  description?: string
  sort_order: number
  created_at: string
}

export interface StaffReference {
  id: string
  staff_id: string
  full_name: string
  email: string
  phone: string
  business: string
  title: string
  created_at: string
}

export const MIN_STAFF_REFERENCES = 2

export interface StaffCredential {
  id: string
  staff_id: string
  credential_name: string
  issuing_body?: string
  credential_number?: string
  issue_date?: string
  expiry_date?: string
  linked_document_id?: string
  sort_order: number
  created_at: string
  // Joined
  linked_document?: StaffDocument
}

export interface CenterStaff {
  id: string
  center_id: string
  staff_id: string
  status: CenterStaffStatus
  employment_class: EmploymentClass
  employment_start_date?: string | null  // date the due-date clock starts (admin-set)
  is_preferred: boolean
  invite_token?: string
  invite_expires_at?: string
  notes?: string
  added_at: string
  // Joined
  staff_profile?: StaffProfile
}

export interface StaffDocument {
  id: string
  staff_id: string
  document_name: string
  document_category: DocumentCategory
  issued_date?: string
  expiry_date?: string
  file_url: string
  file_key?: string
  bucket_name?: string
  file_name?: string
  file_size_bytes?: number
  notes?: string
  uploaded_at: string
}

export interface CenterDocumentRequirement {
  id: string
  center_id: string
  document_name: string
  document_category: DocumentCategory
  is_required: boolean
  is_internal?: boolean
  applies_to?: StaffType[]
  applies_to_class?: EmploymentClass[] | null  // null = all classes
  notes?: string
  sort_order: number
  template_file_key?: string
  template_bucket_name?: string
  template_file_name?: string
  // Compliance rules (see src/lib/compliance.ts)
  section: RequirementSection
  section_label?: string | null     // display name of a custom section
  evidence_type: EvidenceType
  is_confidential: boolean
  due_within_days?: number | null   // days after employment start; 0 = by day 1; null = no deadline
  renewal_type: RenewalType
  renewal_months?: number | null
  is_conditional: boolean           // "if applicable"
  group_label?: string | null
  template_key?: string | null
  policy_version: number           // bumped when an acknowledged policy changes
  policy_updated_at?: string | null
  created_at: string
}

export interface CenterStaffDocumentStatus {
  id: string
  center_id: string
  staff_id: string
  requirement_id: string
  matched_document_id?: string
  status: DocReviewStatus
  center_reviewed: boolean
  reviewed_by?: string
  reviewed_at?: string
  review_notes?: string
  completed_on?: string | null
  hours?: number | null
  expires_on?: string | null
  not_applicable: boolean
  not_applicable_reason?: string | null
  acknowledged_at?: string | null
  acknowledged_version?: number | null
  acknowledged_signature?: string | null
  // Joined
  requirement?: CenterDocumentRequirement
  matched_document?: StaffDocument
}

export interface WorkArea {
  id: string
  center_id: string
  name: string
  age_group?: string
  capacity?: number
  notes?: string
  is_active: boolean
  created_at: string
}

export interface CenterProgram {
  id: string
  center_id: string
  name: string
  age_range?: string | null
  schedule?: string | null
  capacity?: number | null
  description?: string | null
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface CenterTeamMember {
  id: string
  center_id: string
  name: string
  title?: string | null
  bio?: string | null
  role?: string | null   // a 'Role' value from center_lookups
  email?: string | null
  sort_order: number
  created_at: string
}

export interface CenterAboutItem {
  id: string
  center_id: string
  title: string
  content?: string | null
  sort_order: number
  created_at: string
}

export interface Shift {
  id: string
  center_id: string
  work_area_id?: string
  shift_date: string
  start_time: string
  end_time: string
  staff_type_needed?: StaffType
  require_docs_complete: boolean
  hourly_rate?: number
  payment_mode?: string
  status: ShiftStatus
  notes?: string
  created_by?: string
  created_at: string
  updated_at: string
  is_archived?: boolean
  // Joined
  work_area?: WorkArea
  shift_claims?: ShiftClaim[]
}

export interface ShiftClaim {
  id: string
  shift_id: string
  staff_id: string
  status: ClaimStatus
  claimed_at: string
  confirmed_at?: string
  cancelled_at?: string
  cancel_reason?: string
  // Joined
  staff_profile?: StaffProfile
  shift?: Shift
}

export const EMPLOYMENT_CLASS_LABELS: Record<EmploymentClass, string> = {
  regular: 'Regular',
  substitute: 'Substitute',
}

/** Whether a document requirement applies to a staff member's employment class at that center */
export function appliesToEmploymentClass(
  req: Pick<CenterDocumentRequirement, 'applies_to_class'>,
  employmentClass: EmploymentClass | null | undefined
) {
  if (!req.applies_to_class || req.applies_to_class.length === 0) return true
  return req.applies_to_class.includes(employmentClass ?? 'substitute')
}

export const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  infant:     'Infant (0–1)',
  toddler:    'Toddler (1–3)',
  preschool:  'Pre-K (3–5)',
  school_age: 'School Age (5+)',
  mixed:      'Mixed Ages',
}

export function getTierLimits(domainKey: DomainKey): Record<SubscriptionTier, { maxLocations: number; maxStaff: number; pricePerMonth: number }> {
  if (domainKey === 'senior') {
    return {
      starter: { maxLocations: 1, maxStaff: 30, pricePerMonth: 79 },
      growth: { maxLocations: 3, maxStaff: 100, pricePerMonth: 199 },
      network: { maxLocations: 10, maxStaff: 300, pricePerMonth: 399 },
      enterprise: { maxLocations: Infinity, maxStaff: Infinity, pricePerMonth: 0 },
    }
  }
  if (domainKey === 'healthcare') {
    return {
      starter: { maxLocations: 1, maxStaff: 30, pricePerMonth: 99 },
      growth: { maxLocations: 3, maxStaff: 100, pricePerMonth: 249 },
      network: { maxLocations: 10, maxStaff: 300, pricePerMonth: 499 },
      enterprise: { maxLocations: Infinity, maxStaff: Infinity, pricePerMonth: 0 },
    }
  }
  return {
    starter: { maxLocations: 1, maxStaff: 30, pricePerMonth: 49 },
    growth: { maxLocations: 3, maxStaff: 100, pricePerMonth: 129 },
    network: { maxLocations: 10, maxStaff: 300, pricePerMonth: 279 },
    enterprise: { maxLocations: Infinity, maxStaff: Infinity, pricePerMonth: 0 },
  }
}

export const TIER_LIMITS = getTierLimits('childcare')

// ── Vendors & Inspections ──────────────────────────────────────

export interface Vendor {
  id: string
  center_id: string
  name: string
  service_type?: string | null
  contact_name?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  address?: string | null
  notes?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type InspectionIntervalUnit = 'days' | 'weeks' | 'months' | 'years'
export type InspectionResult = 'passed' | 'passed_with_conditions' | 'failed'

export const INSPECTION_RESULT_LABELS: Record<InspectionResult, string> = {
  passed: 'Passed',
  passed_with_conditions: 'Passed w/ conditions',
  failed: 'Failed',
}

export interface Inspection {
  id: string
  center_id: string
  inspection_type: string
  title?: string | null
  interval_value?: number | null
  interval_unit?: InspectionIntervalUnit | null
  last_inspection_date?: string | null
  next_due_date?: string | null
  last_result?: InspectionResult | null
  vendor_id?: string | null
  notes?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  vendor?: Pick<Vendor, 'id' | 'name'> | null
}

export interface InspectionLog {
  id: string
  inspection_id: string
  center_id: string
  performed_on: string
  result?: InspectionResult | null
  vendor_id?: string | null
  inspector_name?: string | null
  notes?: string | null
  created_by?: string | null
  created_at: string
  vendor?: Pick<Vendor, 'id' | 'name'> | null
}

/** A report or other paper record attached to an inspection (center_inspection_files) */
export interface InspectionFile {
  id: string
  center_id: string
  inspection_id: string
  log_id: string | null
  file_name: string
  content_type?: string | null
  size_bytes?: number | null
  uploaded_at: string
}

export type DocumentRequestStatus = 'open' | 'submitted' | 'completed' | 'cancelled'

/** A center's request for a document from one employee (see document_requests) */
export interface DocumentRequest {
  id: string
  center_id: string
  staff_id: string
  requirement_id: string | null
  title: string
  message: string | null
  due_date: string | null
  is_confidential: boolean
  status: DocumentRequestStatus
  submitted_document_id: string | null
  submitted_at: string | null
  staff_note: string | null
  center_note: string | null
  requested_by: string | null
  resolved_at: string | null
  created_at: string
}

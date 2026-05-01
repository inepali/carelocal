export type SubscriptionTier = 'starter' | 'growth' | 'network' | 'enterprise'
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused'
export type StaffType = string  // Open-ended — values are now stored in staff_role_types table
export type AgeGroup = 'infant' | 'toddler' | 'preschool' | 'school_age' | 'mixed'
export type CenterStaffStatus = 'invited' | 'applying' | 'active' | 'inactive' | 'removed'
export type DocumentCategory = 'identity' | 'certification' | 'background' | 'training' | 'medical' | 'other'
export type DocReviewStatus = 'missing' | 'pending_review' | 'accepted' | 'rejected' | 'expired'
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
  available_days: string[]
  available_from?: string
  available_to?: string
  preferred_payment_methods: string[]
  availability_notes?: string
  avatar_url?: string
  is_active: boolean
  created_at: string
  updated_at: string
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
  applies_to?: StaffType[]
  notes?: string
  sort_order: number
  template_file_key?: string
  template_bucket_name?: string
  template_file_name?: string
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
  // Joined
  requirement?: CenterDocumentRequirement
  matched_document?: StaffDocument
}

export interface Classroom {
  id: string
  center_id: string
  name: string
  age_group?: string
  capacity?: number
  notes?: string
  is_active: boolean
  created_at: string
}

export interface Shift {
  id: string
  center_id: string
  classroom_id?: string
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
  // Joined
  classroom?: Classroom
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

/** @deprecated Use useStaffRoles() hook instead — values now come from the DB */
export const STAFF_TYPE_LABELS: Record<string, string> = {
  teacher: 'Teacher',
  floater: 'Floater',
  support: 'Support Staff',
  cook: 'Cook',
}

export const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  infant:     'Infant (0–1)',
  toddler:    'Toddler (1–3)',
  preschool:  'Pre-K (3–5)',
  school_age: 'School Age (5+)',
  mixed:      'Mixed Ages',
}

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  identity: 'Identity (ID/Passport)',
  certification: 'Certification (CPR/First Aid)',
  background: 'Background Check',
  training: 'Training',
  medical: 'Medical/Health',
  other: 'Other'
}

export const TIER_LIMITS: Record<SubscriptionTier, { maxLocations: number; maxStaff: number; pricePerMonth: number }> = {
  starter: { maxLocations: 1, maxStaff: 30, pricePerMonth: 49 },
  growth: { maxLocations: 3, maxStaff: 100, pricePerMonth: 129 },
  network: { maxLocations: 10, maxStaff: 300, pricePerMonth: 279 },
  enterprise: { maxLocations: Infinity, maxStaff: Infinity, pricePerMonth: 0 },
}

export type SubscriptionTier = 'starter' | 'growth' | 'network' | 'enterprise'
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused'
export type StaffType = 'teacher' | 'floater' | 'support' | 'cook'
export type CenterStaffStatus = 'invited' | 'active' | 'inactive' | 'removed'
export type DocumentCategory = 'identity' | 'certification' | 'background' | 'training' | 'medical' | 'other'
export type DocReviewStatus = 'missing' | 'pending_review' | 'accepted' | 'rejected' | 'expired'
export type ShiftStatus = 'open' | 'filled' | 'cancelled'
export type ClaimStatus = 'pending' | 'confirmed' | 'cancelled'

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
  subscription_tier: SubscriptionTier
  subscription_status: SubscriptionStatus
  stripe_customer_id?: string
  trial_ends_at?: string
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
  staff_type: StaffType
  bio?: string
  available_days: string[]
  available_from?: string
  available_to?: string
  avatar_url?: string
  is_active: boolean
  created_at: string
  updated_at: string
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
  file_name?: string
  file_size_bytes?: number
  notes?: string
  uploaded_at: string
}

export interface CenterDocumentRequirement {
  id: string
  center_id: string
  document_name: string
  is_required: boolean
  applies_to?: StaffType[]
  notes?: string
  sort_order: number
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

export const STAFF_TYPE_LABELS: Record<StaffType, string> = {
  teacher: 'Teacher',
  floater: 'Floater',
  support: 'Support Staff',
  cook: 'Cook',
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

/** Types for Child Files (children, guardians, per-child record status, files, audit trail). */

export type ChildStatus = 'enrolled' | 'withdrawn'

/** G.S. 130A-155: what the annual immunization counts report is built from */
export type ImmunizationStatus = 'missing' | 'complete' | 'in_progress' | 'medical_exemption' | 'religious_exemption'

export const IMMUNIZATION_STATUS_LABELS: Record<ImmunizationStatus, string> = {
  missing: 'Not on file',
  complete: 'Complete',
  in_progress: 'Series in progress (physician certified)',
  medical_exemption: 'Medical exemption',
  religious_exemption: 'Religious exemption',
}

export interface Child {
  id: string
  center_id: string
  first_name: string
  last_name: string
  preferred_name: string | null
  date_of_birth: string
  classroom_id: string | null
  status: ChildStatus
  enrolled_on: string
  /** Starts the 30-day immunization and health assessment windows */
  first_attended_on: string | null
  /** Starts the 1-year retention clock (10A NCAC 09 .2318) */
  withdrawn_on: string | null
  immunization_status: ImmunizationStatus
  custody_restriction: boolean
  custody_note: string | null
  source_tour_request_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ChildGuardian {
  id: string
  center_id: string
  child_id: string
  name: string
  relationship: string | null
  phone: string | null
  email: string | null
  is_primary: boolean
  is_emergency_contact: boolean
  /** A child is released only to someone explicitly authorized (10A NCAC 09 .0801(c)) */
  can_pick_up: boolean
  created_at: string
  updated_at: string
}

/** One child's status for one requirement. Same field names the compliance engine already reads for staff. */
export interface ChildDocumentStatus {
  id: string
  center_id: string
  child_id: string
  requirement_id: string
  status: 'missing' | 'pending_review' | 'accepted' | 'rejected' | 'expired'
  completed_on: string | null
  expires_on: string | null
  due_on: string | null
  not_applicable: boolean
  not_applicable_reason: string | null
  acknowledged_version: number | null
  review_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface ChildFile {
  id: string
  center_id: string
  child_id: string
  requirement_id: string | null
  file_key: string
  bucket_name: string
  file_name: string
  content_type: string | null
  size_bytes: number | null
  source: 'center' | 'parent'
  /** 'incident' = an uploaded incident form; 'record' = a checklist record or other file */
  category: 'record' | 'incident'
  uploaded_by: string | null
  created_at: string
}

export interface ChildAuditEntry {
  id: string
  center_id: string
  child_id: string
  table_name: string
  row_id: string | null
  action: 'insert' | 'update' | 'delete'
  changed_by: string | null
  changed_at: string
  changed_fields: string[]
  /** Names and flags only, never health details */
  summary: string | null
}

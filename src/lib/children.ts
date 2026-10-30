// Self-contained on purpose (type-only imports, no path aliases) so the access-rule tests can load it directly.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Child, ChildAuditEntry, ChildDocumentStatus, ChildFile, ChildGuardian, ChildMedication } from './child-types'

/**
 * Every read and write the Child Files screens make. Each function takes the CALLER's Supabase client, so the
 * database decides access (owner or admin of the child's center, with Child Files switched on). Nothing here
 * uses the service role.
 */

type Failure = { success: false; error: string }
type Ok<T> = { success: true } & T

/** A message a person can act on, instead of a raw database error */
export function friendlyChildError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return 'Something went wrong.'
  if (error.code === '42501') return 'Child Files is not turned on for your center, or you do not have access to it.'
  if (error.code === '23505') return 'That record already exists.'
  return error.message?.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong.'
}
const fail = (error: { code?: string; message?: string } | string | null | undefined): Failure =>
  ({ success: false, error: typeof error === 'string' ? error : friendlyChildError(error) })

export interface ChildRequirement {
  id: string
  center_id: string
  document_name: string
  section: string
  notes: string | null
  is_required: boolean
  is_conditional: boolean
  due_within_days: number | null
  renewal_type: 'none' | 'interval' | 'document_expiry' | 'policy_change'
  renewal_months: number | null
  sort_order: number | null
  template_key: string | null
}

export interface Classroom {
  id: string
  name: string
  capacity?: number | null
  ratio_children?: number | null
  min_age_months?: number | null
  max_age_months?: number | null
  /** Enrolled children whose home room this is */
  enrolled?: number
}

const REQUIREMENT_COLUMNS = 'id, center_id, document_name, section, notes, is_required, is_conditional, due_within_days, renewal_type, renewal_months, sort_order, template_key'

async function childRequirements(supabase: SupabaseClient, centerId: string) {
  const { data, error } = await supabase.from('center_document_requirements').select(REQUIREMENT_COLUMNS)
    .eq('center_id', centerId).eq('audience', 'child')
    .order('section').order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  return { rows: (data ?? []) as ChildRequirement[], error }
}

/** Active classrooms in the center's order, with their age range, capacity and how many children call each home */
export async function loadClassrooms(supabase: SupabaseClient, centerId: string) {
  const [rooms, kids] = await Promise.all([
    supabase.from('work_areas').select('id, name, capacity, ratio_children, min_age_months, max_age_months')
      .eq('center_id', centerId).eq('is_active', true).order('sort_order').order('name'),
    supabase.from('children').select('classroom_id').eq('center_id', centerId).eq('status', 'enrolled'),
  ])
  const enrolled = new Map<string, number>()
  for (const k of (kids.data ?? []) as { classroom_id: string | null }[]) {
    if (k.classroom_id) enrolled.set(k.classroom_id, (enrolled.get(k.classroom_id) ?? 0) + 1)
  }
  return ((rooms.data ?? []) as Classroom[]).map(r => ({ ...r, enrolled: enrolled.get(r.id) ?? 0 }))
}
const classrooms = loadClassrooms

// ─── Reading ─────────────────────────────────────────────────────────────────

/** Everything the child list needs: children, the center's child rules, every record and the classrooms */
export async function loadChildrenOverview(supabase: SupabaseClient, centerId: string) {
  const [kids, reqs, records, rooms] = await Promise.all([
    supabase.from('children').select('*').eq('center_id', centerId).order('last_name').order('first_name'),
    childRequirements(supabase, centerId),
    supabase.from('child_documents').select('*').eq('center_id', centerId),
    classrooms(supabase, centerId),
  ])
  if (kids.error) return fail(kids.error)
  return {
    success: true as const,
    children: (kids.data ?? []) as Child[],
    requirements: reqs.rows,
    records: (records.data ?? []) as ChildDocumentStatus[],
    classrooms: rooms,
  }
}

/** One child's whole file, or null when it does not exist or the caller has no access (the same answer for both) */
export async function loadChildFile(supabase: SupabaseClient, childId: string) {
  const { data: child } = await supabase.from('children').select('*').eq('id', childId).maybeSingle()
  if (!child) return null
  const [guardians, records, files, audit, reqs, rooms] = await Promise.all([
    supabase.from('child_guardians').select('*').eq('child_id', childId).order('created_at'),
    supabase.from('child_documents').select('*').eq('child_id', childId),
    supabase.from('child_files').select('*').eq('child_id', childId).eq('category', 'record').order('created_at', { ascending: false }),
    supabase.from('child_audit_log').select('*').eq('child_id', childId).order('changed_at', { ascending: false }).limit(100),
    childRequirements(supabase, (child as Child).center_id),
    classrooms(supabase, (child as Child).center_id),
  ])
  return {
    child: child as Child,
    guardians: (guardians.data ?? []) as ChildGuardian[],
    records: (records.data ?? []) as ChildDocumentStatus[],
    files: (files.data ?? []) as ChildFile[],
    audit: (audit.data ?? []) as ChildAuditEntry[],
    requirements: reqs.rows,
    classrooms: rooms,
  }
}

// ─── Children ────────────────────────────────────────────────────────────────

export interface NewChildInput {
  first_name: string
  last_name: string
  preferred_name?: string | null
  date_of_birth: string
  classroom_id?: string | null
  enrolled_on?: string
  first_attended_on?: string | null
  source_tour_request_id?: string | null
}

export interface GuardianInput {
  name: string
  relationship?: string | null
  phone?: string | null
  email?: string | null
  is_primary?: boolean
  is_emergency_contact?: boolean
  /** Defaults to false: a child is released only to someone explicitly authorized */
  can_pick_up?: boolean
}

const clean = (value: string | null | undefined) => (value ?? '').trim() || null

export async function addChild(supabase: SupabaseClient, centerId: string, input: NewChildInput, guardians: GuardianInput[] = []) {
  if (!input.first_name?.trim() || !input.last_name?.trim()) return fail('Enter the child’s first and last name.')
  if (!input.date_of_birth) return fail('Enter the child’s date of birth.')

  const { data, error } = await supabase.from('children').insert({
    center_id: centerId,
    first_name: input.first_name.trim(),
    last_name: input.last_name.trim(),
    preferred_name: clean(input.preferred_name),
    date_of_birth: input.date_of_birth,
    classroom_id: input.classroom_id || null,
    ...(input.enrolled_on ? { enrolled_on: input.enrolled_on } : {}),
    first_attended_on: input.first_attended_on || null,
    source_tour_request_id: input.source_tour_request_id ?? null,
  }).select('*').single()
  if (error || !data) return fail(error)

  const child = data as Child
  const named = guardians.filter(g => g.name?.trim())
  if (named.length > 0) {
    const { error: guardianError } = await supabase.from('child_guardians').insert(named.map((g, i) => ({
      center_id: centerId,
      child_id: child.id,
      name: g.name.trim(),
      relationship: clean(g.relationship),
      phone: clean(g.phone),
      email: clean(g.email),
      is_primary: g.is_primary ?? i === 0,
      is_emergency_contact: g.is_emergency_contact ?? false,
      can_pick_up: g.can_pick_up ?? false,
    })))
    if (guardianError) return { ...fail(guardianError), child }   // the child exists; only the contacts failed
  }
  return { success: true as const, child } as Ok<{ child: Child }>
}

export type ChildChanges = Partial<Pick<Child,
  'first_name' | 'last_name' | 'preferred_name' | 'date_of_birth' | 'classroom_id' | 'enrolled_on' | 'first_attended_on'
  | 'custody_restriction' | 'custody_note' | 'care_alert' | 'toilet_trained' | 'marketing_photos_allowed'>>

export async function updateChild(supabase: SupabaseClient, childId: string, changes: ChildChanges) {
  const { data, error } = await supabase.from('children').update(changes).eq('id', childId).select('*')
  if (error) return fail(error)
  if (!data?.length) return fail('Child not found or you do not have access to it.')
  return { success: true as const, child: data[0] as Child } as Ok<{ child: Child }>
}

/** Withdrawing starts the 1-year retention clock (10A NCAC 09 .2318) */
export async function withdrawChild(supabase: SupabaseClient, childId: string, withdrawnOn: string) {
  const { data, error } = await supabase.from('children').update({ status: 'withdrawn', withdrawn_on: withdrawnOn }).eq('id', childId).select('*')
  if (error) return fail(error)
  if (!data?.length) return fail('Child not found or you do not have access to it.')
  return { success: true as const, child: data[0] as Child } as Ok<{ child: Child }>
}

export async function reenrollChild(supabase: SupabaseClient, childId: string, enrolledOn: string) {
  const { data, error } = await supabase.from('children')
    .update({ status: 'enrolled', withdrawn_on: null, enrolled_on: enrolledOn }).eq('id', childId).select('*')
  if (error) return fail(error)
  if (!data?.length) return fail('Child not found or you do not have access to it.')
  return { success: true as const, child: data[0] as Child } as Ok<{ child: Child }>
}

// ─── Guardians and pick-up ───────────────────────────────────────────────────

export async function saveGuardian(supabase: SupabaseClient, centerId: string, childId: string, input: GuardianInput & { id?: string }) {
  if (!input.name?.trim()) return fail('Enter the person’s name.')
  const row = {
    name: input.name.trim(),
    relationship: clean(input.relationship),
    phone: clean(input.phone),
    email: clean(input.email),
    is_primary: input.is_primary ?? false,
    is_emergency_contact: input.is_emergency_contact ?? false,
    can_pick_up: input.can_pick_up ?? false,
  }
  const query = input.id
    ? supabase.from('child_guardians').update(row).eq('id', input.id).select('*')
    : supabase.from('child_guardians').insert({ ...row, center_id: centerId, child_id: childId }).select('*')
  const { data, error } = await query
  if (error) return fail(error)
  if (!data?.length) return fail('Contact not found or you do not have access to it.')
  return { success: true as const, guardian: data[0] as ChildGuardian } as Ok<{ guardian: ChildGuardian }>
}

export async function deleteGuardian(supabase: SupabaseClient, guardianId: string) {
  const { data, error } = await supabase.from('child_guardians').delete().eq('id', guardianId).select('id')
  if (error) return fail(error)
  if (!data?.length) return fail('Contact not found or you do not have access to it.')
  return { success: true as const }
}

// ─── Records (status, dates, comments) ───────────────────────────────────────

export interface RecordChanges {
  status?: ChildDocumentStatus['status']
  completed_on?: string | null
  expires_on?: string | null
  due_on?: string | null
  not_applicable?: boolean
  not_applicable_reason?: string | null
  review_notes?: string | null
}

/** Creates or updates one child's record for one requirement and stamps who reviewed it and when */
export async function saveChildRecord(
  supabase: SupabaseClient, centerId: string, childId: string, requirementId: string, changes: RecordChanges, reviewerId: string | null,
) {
  const { data, error } = await supabase.from('child_documents').upsert({
    center_id: centerId,
    child_id: childId,
    requirement_id: requirementId,
    ...changes,
    reviewed_by: reviewerId,
    reviewed_at: new Date().toISOString(),
  }, { onConflict: 'child_id,requirement_id' }).select('*')
  if (error) return fail(error)
  if (!data?.length) return fail('Could not save the record.')
  return { success: true as const, record: data[0] as ChildDocumentStatus } as Ok<{ record: ChildDocumentStatus }>
}

// ─── Tour request to enrolled child ──────────────────────────────────────────

export interface TourRequestForEnrollment {
  id: string
  center_id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  children: { name: string; dob: string | null }[]
}

/**
 * Turns one child on a tour request into an enrolled child, with the parent who asked as the first contact.
 * A tour request may carry only a due date or no date at all, so the caller supplies the date of birth.
 * The parent is not authorized for pick-up automatically: that is a deliberate step on the child's file.
 */
export async function enrollFromTourRequest(
  supabase: SupabaseClient, request: TourRequestForEnrollment, childIndex: number,
  overrides: { date_of_birth: string; classroom_id?: string | null; enrolled_on?: string; first_attended_on?: string | null },
) {
  const named = request.children[childIndex]
  if (!named) return fail('That child is not on this tour request.')
  const parts = named.name.trim().split(/\s+/)
  const first = parts.shift() ?? ''
  const last = parts.join(' ') || request.last_name
  return addChild(supabase, request.center_id, {
    first_name: first,
    last_name: last,
    date_of_birth: overrides.date_of_birth,
    classroom_id: overrides.classroom_id ?? null,
    enrolled_on: overrides.enrolled_on,
    first_attended_on: overrides.first_attended_on ?? null,
    source_tour_request_id: request.id,
  }, [{
    name: `${request.first_name} ${request.last_name}`,
    relationship: 'Parent',
    phone: request.phone,
    email: request.email,
    is_primary: true,
    is_emergency_contact: true,
    can_pick_up: false,
  }])
}

// ─── Medicines (from the child's medical form) ─────────────────────────────────────────────────────────────────

export interface MedicationInput {
  name: string
  dose: string
  schedule?: string | null
  instructions?: string | null
  permission_signed_on: string
  starts_on: string
  ends_on?: string | null
}

/** The child's authorized medicines, active first, and the doses given (newest first, up to 50) */
export async function loadMedications(supabase: SupabaseClient, childId: string) {
  const [meds, given] = await Promise.all([
    supabase.from('child_medications').select('*').eq('child_id', childId).order('active', { ascending: false }).order('name'),
    supabase.from('child_daily_entries').select('id, medication_id, at, details, voided_at, void_reason')
      .eq('child_id', childId).eq('kind', 'medicine').order('at', { ascending: false }).limit(50),
  ])
  if (meds.error) return fail(meds.error)
  return {
    success: true as const,
    medications: (meds.data ?? []) as ChildMedication[],
    // Doses are readable when the live roster is on; otherwise the list is just empty
    given: (given.data ?? []) as { id: string; medication_id: string | null; at: string; details: { dose?: string; note?: string }; voided_at: string | null; void_reason: string | null }[],
  }
}

export async function saveMedication(supabase: SupabaseClient, centerId: string, childId: string, input: MedicationInput & { id?: string }) {
  if (!input.name?.trim() || !input.dose?.trim()) return fail('Enter the medicine and the dose.')
  if (!input.permission_signed_on) return fail('Enter the date the parent signed the permission.')
  if (!input.starts_on) return fail('Enter the start date.')
  if (input.ends_on && input.ends_on < input.starts_on) return fail('The end date is before the start date.')
  const row = {
    name: input.name.trim(),
    dose: input.dose.trim(),
    schedule: clean(input.schedule),
    instructions: clean(input.instructions),
    permission_signed_on: input.permission_signed_on,
    starts_on: input.starts_on,
    ends_on: input.ends_on || null,
  }
  const query = input.id
    ? supabase.from('child_medications').update(row).eq('id', input.id).select('*')
    : supabase.from('child_medications').insert({ ...row, center_id: centerId, child_id: childId }).select('*')
  const { data, error } = await query
  if (error) return fail(error)
  if (!data?.length) return fail('Medicine not found or you do not have access to it.')
  return { success: true as const, medication: data[0] as ChildMedication } as Ok<{ medication: ChildMedication }>
}

/** Stop (or restart) a medicine. Stopped medicines stay on file with the doses given. */
export async function setMedicationActive(supabase: SupabaseClient, medicationId: string, active: boolean) {
  const { data, error } = await supabase.from('child_medications').update({ active }).eq('id', medicationId).select('id')
  if (error) return fail(error)
  if (!data?.length) return fail('Medicine not found or you do not have access to it.')
  return { success: true as const } as Ok<object>
}

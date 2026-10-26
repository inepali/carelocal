import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The staff "Getting started" checklist: five profile tasks that live in the app, plus the documents the super admin
 * listed for the staff member's state. Staff tick items off by hand; nothing here is reviewed or enforced.
 */
export const PROFILE_TASKS = [
  { key: 'profile', label: 'Complete your profile', hint: 'Name, phone, city and state, and the role you work in.', tab: 'personal' },
  { key: 'id', label: 'Upload your ID', hint: 'A photo of a government-issued ID, added to My Documents.', tab: null },
  { key: 'education', label: 'Add your education', hint: 'Degrees, diplomas and coursework.', tab: 'academic' },
  { key: 'credentials', label: 'Add your credentials', hint: 'Licenses, certifications and training.', tab: 'credentials' },
  { key: 'availability', label: 'Set your availability', hint: 'The days and hours you can work.', tab: 'availability' },
] as const

export type ProfileTaskKey = (typeof PROFILE_TASKS)[number]['key']

export interface OnboardingDoc {
  id: string
  document_name: string
  instructions: string | null
  link_url: string | null
  is_required: boolean
}

export interface OnboardingData {
  staffId: string
  stateCode: string | null
  /** True when the super admin has added this state for the staff member's vertical */
  stateListed: boolean
  docs: OnboardingDoc[]
  /** Ticked items and when each was ticked: 'profile' … 'availability' for tasks, `doc:<id>` for state documents */
  done: Map<string, string>
}

export const docKey = (id: string) => `doc:${id}`

/** Where the staff member works: their metro area's state, else a two-letter state on their profile */
function stateOf(profile: { state: string | null; metro_areas: { state_code: string } | { state_code: string }[] | null }) {
  const metro = Array.isArray(profile.metro_areas) ? profile.metro_areas[0] : profile.metro_areas
  const fromMetro = metro?.state_code?.trim().toUpperCase()
  if (fromMetro && /^[A-Z]{2}$/.test(fromMetro)) return fromMetro
  const fromProfile = profile.state?.trim().toUpperCase()
  return fromProfile && /^[A-Z]{2}$/.test(fromProfile) ? fromProfile : null
}

export async function loadOnboarding(supabase: SupabaseClient): Promise<OnboardingData | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('staff_profiles')
    .select('id, state, domain_key, metro_areas(state_code)')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile) return null

  const stateCode = stateOf(profile as never)

  const [{ data: stateRow }, { data: items }] = await Promise.all([
    stateCode
      ? supabase.from('onboarding_states').select('id').eq('state_code', stateCode).eq('domain_key', profile.domain_key).eq('status', 'active').maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('staff_onboarding_items').select('task, doc_id, completed_at').eq('staff_id', profile.id),
  ])

  let docs: OnboardingDoc[] = []
  if (stateRow) {
    const { data } = await supabase
      .from('state_required_docs')
      .select('id, document_name, instructions, link_url, is_required')
      .eq('state_id', stateRow.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    docs = (data ?? []) as OnboardingDoc[]
  }

  const done = new Map<string, string>()
  for (const item of items ?? []) done.set(item.task ?? docKey(item.doc_id), item.completed_at)

  return { staffId: profile.id, stateCode, stateListed: !!stateRow, docs, done }
}

/** The tasks this staff member sees: regular employees have no availability to set */
export function tasksFor(includeAvailability: boolean) {
  return PROFILE_TASKS.filter(t => includeAvailability || t.key !== 'availability')
}

export function progressOf(data: OnboardingData, includeAvailability: boolean) {
  const keys = [...tasksFor(includeAvailability).map(t => t.key as string), ...data.docs.map(d => docKey(d.id))]
  return { done: keys.filter(k => data.done.has(k)).length, total: keys.length }
}

/** Tick or untick one item. `completedAt` is the saved time when ticking; `error` is a message when the save failed. */
export async function setOnboardingItem(supabase: SupabaseClient, staffId: string, key: string, checked: boolean): Promise<{ error: string | null; completedAt: string | null }> {
  const isDoc = key.startsWith('doc:')
  const column = isDoc ? 'doc_id' : 'task'
  const value = isDoc ? key.slice(4) : key
  if (checked) {
    const { data, error } = await supabase.from('staff_onboarding_items').insert({ staff_id: staffId, [column]: value }).select('completed_at').single()
    // Ticked twice (two tabs): already done, nothing to report
    if (error && error.code !== '23505') return { error: error.message, completedAt: null }
    return { error: null, completedAt: data?.completed_at ?? new Date().toISOString() }
  }
  const { error } = await supabase.from('staff_onboarding_items').delete().eq('staff_id', staffId).eq(column, value)
  return { error: error?.message ?? null, completedAt: null }
}

'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getDomainConfig, type DomainKey } from '@/lib/domain-config'

/**
 * Super admin: a center's owners. An owner is an employee (a staff account) the super admin picks; a center can have
 * several. Owners then name Directors, Assistant Directors and other roles from the employee page. The database
 * function set_center_role() holds the rules (one center per sign-in, at least one owner); this file only adds the
 * super admin check, finds people, and makes sure the person is on the center's team first.
 */

type Fail = { success: false; error: string }
type Result<T = object> = ({ success: true } & T) | Fail

export interface CenterOwner {
  userId: string
  staffId: string | null
  name: string
  email: string | null
}

export interface OwnerCandidate {
  staffId: string
  name: string
  email: string | null
  /** Their status on this center's team, null when not on it */
  memberStatus: string | null
  employmentClass: string | null
  /** Already an owner / admin of this center */
  centerAccess: string | null
  /** Manages a different center, so they cannot also own this one */
  managesOtherCenter: boolean
}

const service = () => createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function requireSuperAdmin(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.app_metadata?.is_super_admin === true ? user.id : null
}

const fail = (error: string): Fail => ({ success: false, error })
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

/** The owners of a center, including owners who registered the center and have no staff profile */
export async function listCenterOwners(centerId: string): Promise<Result<{ owners: CenterOwner[] }>> {
  if (!await requireSuperAdmin()) return fail('Not allowed')
  if (!isUuid(centerId)) return fail('Center not found')
  const db = service()

  const { data: rows, error } = await db.from('center_admins').select('user_id').eq('center_id', centerId).eq('role', 'owner')
  if (error) return fail(error.message)
  const userIds = (rows ?? []).map(r => r.user_id as string)
  if (userIds.length === 0) return { success: true, owners: [] }

  const { data: profiles } = await db.from('staff_profiles').select('id, user_id, first_name, last_name, email').in('user_id', userIds)
  const byUser = new Map((profiles ?? []).map(p => [p.user_id as string, p]))

  const owners = await Promise.all(userIds.map(async (userId): Promise<CenterOwner> => {
    const p = byUser.get(userId)
    if (p) return { userId, staffId: p.id, name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unnamed', email: p.email ?? null }
    const { data } = await db.auth.admin.getUserById(userId)
    return { userId, staffId: null, name: 'Center account (no staff profile)', email: data.user?.email ?? null }
  }))
  return { success: true, owners }
}

/** Staff accounts on the center's site matching a name or email, for picking an owner */
export async function searchOwnerCandidates(centerId: string | null, query: string, domainKey?: DomainKey): Promise<Result<{ people: OwnerCandidate[] }>> {
  if (!await requireSuperAdmin()) return fail('Not allowed')
  const db = service()

  let domain = domainKey ?? 'childcare'
  if (centerId) {
    if (!isUuid(centerId)) return fail('Center not found')
    const { data: center } = await db.from('centers').select('domain_key').eq('id', centerId).maybeSingle()
    if (!center) return fail('Center not found')
    domain = (center.domain_key ?? 'childcare') as DomainKey
  }

  // Only characters that can't change the PostgREST filter
  const q = query.replace(/[^\p{L}\p{N}@.\-_' ]/gu, '').trim().slice(0, 80)
  if (q.length < 2) return { success: true, people: [] }
  const words = q.split(/\s+/).filter(Boolean)
  const like = (w: string) => `%${w}%`

  let req = db.from('staff_profiles').select('id, user_id, first_name, last_name, email').eq('domain_key', domain).limit(10)
  if (words.length >= 2) {
    req = req.ilike('first_name', like(words[0])).ilike('last_name', like(words.slice(1).join(' ')))
  } else {
    req = req.or(`first_name.ilike.${like(q)},last_name.ilike.${like(q)},email.ilike.${like(q)}`)
  }
  const { data: profiles, error } = await req
  if (error) return fail(error.message)
  const list = profiles ?? []
  if (list.length === 0) return { success: true, people: [] }

  const [{ data: memberships }, { data: grants }] = await Promise.all([
    centerId
      ? db.from('center_staff').select('staff_id, status, employment_class').eq('center_id', centerId).in('staff_id', list.map(p => p.id))
      : Promise.resolve({ data: [] as { staff_id: string; status: string; employment_class: string }[] }),
    db.from('center_admins').select('user_id, center_id, role').in('user_id', list.map(p => p.user_id)),
  ])
  const member = new Map((memberships ?? []).map(m => [m.staff_id as string, m]))

  return {
    success: true,
    people: list.map(p => {
      const mine = (grants ?? []).filter(g => g.user_id === p.user_id)
      const here = mine.find(g => g.center_id === centerId)
      const m = member.get(p.id)
      return {
        staffId: p.id,
        name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unnamed',
        email: p.email ?? null,
        memberStatus: m?.status ?? null,
        employmentClass: m?.employment_class ?? null,
        centerAccess: here?.role ?? null,
        managesOtherCenter: mine.some(g => g.center_id !== centerId),
      }
    }),
  }
}

/** Puts the person on the center's team as an active Regular employee when they aren't already */
async function ensureTeamMember(db: ReturnType<typeof service>, centerId: string, staffId: string, superAdminId: string): Promise<string | null> {
  const { data: row } = await db.from('center_staff').select('id, status').eq('center_id', centerId).eq('staff_id', staffId).maybeSingle()
  if (!row) {
    const { error } = await db.from('center_staff').insert({
      center_id: centerId, staff_id: staffId, status: 'active', employment_class: 'regular', added_by: superAdminId,
    })
    return error?.message ?? null
  }
  if (row.status !== 'active') {
    const { error } = await db.from('center_staff').update({ status: 'active', employment_class: 'regular' }).eq('id', row.id)
    return error?.message ?? null
  }
  return null
}

/** Make an employee (or any staff account on the center's site) an owner of the center */
export async function addCenterOwner(centerId: string, staffId: string): Promise<Result> {
  const superAdminId = await requireSuperAdmin()
  if (!superAdminId) return fail('Not allowed')
  if (!isUuid(centerId) || !isUuid(staffId)) return fail('Not found')
  const db = service()

  const [{ data: center }, { data: profile }] = await Promise.all([
    db.from('centers').select('id, domain_key').eq('id', centerId).maybeSingle(),
    db.from('staff_profiles').select('id, user_id, domain_key').eq('id', staffId).maybeSingle(),
  ])
  if (!center) return fail('Center not found')
  if (!profile) return fail('Staff account not found')
  if ((profile.domain_key ?? 'childcare') !== (center.domain_key ?? 'childcare')) return fail('This person signs in on a different CareLocal site.')

  const { data: elsewhere } = await db.from('center_admins').select('center_id').eq('user_id', profile.user_id).neq('center_id', centerId).limit(1)
  if (elsewhere?.length) return fail('This person already manages another center.')

  const memberError = await ensureTeamMember(db, centerId, staffId, superAdminId)
  if (memberError) return fail(memberError)

  const { error } = await db.rpc('set_center_role', { p_center_id: centerId, p_staff_id: staffId, p_role: 'owner' })
  if (error) return fail(error.message)
  console.warn(`[roles] super admin ${superAdminId} made staff ${staffId} an owner of center ${centerId}`)
  return { success: true }
}

/** Remove an owner. A staff owner stays on the team with no role; the center must keep at least one owner. */
export async function removeCenterOwner(centerId: string, userId: string): Promise<Result> {
  const superAdminId = await requireSuperAdmin()
  if (!superAdminId) return fail('Not allowed')
  if (!isUuid(centerId) || !isUuid(userId)) return fail('Not found')
  const db = service()

  const { data: owners } = await db.from('center_admins').select('user_id').eq('center_id', centerId).eq('role', 'owner')
  if (!(owners ?? []).some(o => o.user_id === userId)) return fail('This person is not an owner of the center.')
  if ((owners ?? []).length < 2) return fail('A center needs at least one owner. Add another owner first.')

  const { data: profile } = await db.from('staff_profiles').select('id').eq('user_id', userId).maybeSingle()
  const { data: member } = profile
    ? await db.from('center_staff').select('id, status').eq('center_id', centerId).eq('staff_id', profile.id).maybeSingle()
    : { data: null }

  if (profile && member && member.status !== 'removed') {
    const { error } = await db.rpc('set_center_role', { p_center_id: centerId, p_staff_id: profile.id, p_role: null })
    if (error) return fail(error.message)
  } else {
    const { error } = await db.from('center_admins').delete().eq('center_id', centerId).eq('user_id', userId).eq('role', 'owner')
    if (error) return fail(error.message)
  }
  console.warn(`[roles] super admin ${superAdminId} removed user ${userId} as owner of center ${centerId}`)
  return { success: true }
}

export interface NewCenterInput {
  name: string
  domainKey: DomainKey
  metroId: string | null
  email: string
  phone: string
  directorName: string
  ownerStaffId: string
}

/** Create a center and make the chosen staff account its first owner. It starts on the Free Trial like a sign-up. */
export async function createCenterWithOwner(input: NewCenterInput): Promise<Result<{ centerId: string }>> {
  const superAdminId = await requireSuperAdmin()
  if (!superAdminId) return fail('Not allowed')
  const name = input.name?.trim()
  if (!name) return fail('Enter the center name.')
  if (!['childcare', 'healthcare', 'senior'].includes(input.domainKey)) return fail('Pick a site.')
  if (!isUuid(input.ownerStaffId)) return fail('Pick the owner.')
  if (input.metroId && !isUuid(input.metroId)) return fail('Pick a metro area.')
  const db = service()

  const { data: profile } = await db.from('staff_profiles').select('id, user_id, domain_key').eq('id', input.ownerStaffId).maybeSingle()
  if (!profile) return fail('Owner not found')
  if ((profile.domain_key ?? 'childcare') !== input.domainKey) return fail('The owner signs in on a different CareLocal site.')
  const { data: elsewhere } = await db.from('center_admins').select('center_id').eq('user_id', profile.user_id).limit(1)
  if (elsewhere?.length) return fail('This person already manages another center.')

  const config = getDomainConfig(input.domainKey)
  const centerId = crypto.randomUUID()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.floor(Math.random() * 1000)
  const { error: centerError } = await db.from('centers').insert({
    id: centerId,
    name,
    slug,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    director_name: input.directorName?.trim() || null,
    metro_area_id: input.metroId || null,
    domain_key: input.domainKey,
    staff_term: config.staffTerm,
    work_area_term: config.workAreaTerm,
  })
  if (centerError) return fail(centerError.message)

  const memberError = await ensureTeamMember(db, centerId, profile.id, superAdminId)
  const { error: roleError } = memberError
    ? { error: { message: memberError } }
    : await db.rpc('set_center_role', { p_center_id: centerId, p_staff_id: profile.id, p_role: 'owner' })
  if (roleError) {
    // Don't leave a center nobody can open
    await db.from('centers').delete().eq('id', centerId)
    return fail(roleError.message)
  }
  console.warn(`[roles] super admin ${superAdminId} created center ${centerId} with owner staff ${profile.id}`)
  return { success: true, centerId }
}

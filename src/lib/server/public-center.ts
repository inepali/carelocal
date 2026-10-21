import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { DomainKey } from '@/lib/domain-config'
import { normalizeWebUrl } from '@/lib/utils'
import { citySlug } from '@/lib/server/public-jobs'

/**
 * Server-only reads for the public center pages (/centers, /centers/in/<city>, /centers/<handle>). Like
 * public-jobs.ts it uses the service role with an explicit, safe column list, so nothing private can leak:
 * only a center that turned its page on (public_enabled), is active and belongs to this site (vertical).
 * Phone, email, license number and the Care Score appear only when the center chose to show them.
 * Team emails are never selected.
 */
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export interface PublicCenterPage {
  id: string
  slug: string                       // invite links use this, not the public handle
  handle: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  logoUrl: string | null
  description: string | null
  phone: string | null               // null unless the center shows it
  email: string | null
  licenseNumber: string | null
  careScore: { average: number; count: number } | null
  toursEnabled: boolean
  /** Newest change across the center, its programs, team and About items (sitemap lastmod, dateModified) */
  lastModified: string
  /** Nothing to read yet (no description, programs, team or About items): kept out of search until it has content */
  thin: boolean
  programs: { id: string; name: string; ageRange: string | null; schedule: string | null; capacity: number | null; description: string | null; moreInfoUrl: string | null }[]
  team: { id: string; name: string; title: string | null; role: string | null; bio: string | null }[]
  about: { id: string; title: string; content: string | null }[]
}

/** A center in a public list (directory, city page, "more centers nearby") */
export interface PublicCenterSummary {
  handle: string
  name: string
  city: string | null
  state: string | null
  description: string | null
  programNames: string[]
  lastModified: string
}

const CENTER_COLUMNS = 'id, slug, public_handle, name, address, city, state, zip, phone, email, license_number, logo_url, public_description, public_show_phone, public_show_email, public_show_license, public_show_care_score, public_tours_enabled, updated_at'

const newest = (...dates: (string | null | undefined)[]) =>
  dates.filter((d): d is string => !!d).reduce((a, b) => (new Date(b) > new Date(a) ? b : a))

/** The public page of a center, or null when it does not exist, is switched off, inactive or on another site. Cached per request. */
export const getPublicCenter = cache(async (domain: DomainKey, handle: string): Promise<PublicCenterPage | null> => {
  const client = db()
  const { data: c } = await client.from('centers').select(CENTER_COLUMNS)
    .eq('public_handle', handle.toLowerCase()).eq('public_enabled', true).eq('is_active', true).eq('domain_key', domain)
    .maybeSingle()
  if (!c) return null

  const [programs, team, about, reviews] = await Promise.all([
    client.from('center_programs').select('id, name, age_range, schedule, capacity, description, more_info_url, updated_at')
      .eq('center_id', c.id).eq('is_active', true).order('sort_order').order('created_at'),
    client.from('center_team_members').select('id, name, title, role, bio, updated_at')
      .eq('center_id', c.id).order('sort_order').order('created_at'),
    client.from('center_about_items').select('id, title, content, updated_at')
      .eq('center_id', c.id).order('sort_order').order('created_at'),
    c.public_show_care_score
      ? client.from('shift_reviews').select('rating').eq('reviewee_id', c.id).eq('reviewer_type', 'staff')
      : Promise.resolve({ data: null }),
  ])

  const programRows = programs.data ?? []
  const teamRows = team.data ?? []
  const aboutRows = about.data ?? []
  const ratings = (reviews.data ?? []) as { rating: number }[]
  const description = c.public_description?.trim() || null
  return {
    id: c.id,
    slug: c.slug,
    handle: c.public_handle,
    name: c.name,
    address: c.address ?? null,
    city: c.city ?? null,
    state: c.state ?? null,
    zip: c.zip ?? null,
    logoUrl: c.logo_url ?? null,
    description,
    phone: c.public_show_phone ? c.phone ?? null : null,
    email: c.public_show_email ? c.email ?? null : null,
    licenseNumber: c.public_show_license ? c.license_number ?? null : null,
    careScore: ratings.length > 0
      ? { average: ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length, count: ratings.length }
      : null,
    toursEnabled: c.public_tours_enabled !== false,
    lastModified: newest(c.updated_at, ...programRows.map(p => p.updated_at), ...teamRows.map(t => t.updated_at), ...aboutRows.map(a => a.updated_at)),
    thin: !description && programRows.length === 0 && teamRows.length === 0 && aboutRows.length === 0,
    programs: programRows.map(p => ({
      id: p.id, name: p.name, ageRange: p.age_range ?? null, schedule: p.schedule ?? null,
      capacity: p.capacity ?? null, description: p.description ?? null, moreInfoUrl: normalizeWebUrl(p.more_info_url),
    })),
    team: teamRows.map(t => ({ id: t.id, name: t.name, title: t.title ?? null, role: t.role ?? null, bio: t.bio ?? null })),
    about: aboutRows.map(a => ({ id: a.id, title: a.title, content: a.content ?? null })),
  }
})

/**
 * Every public center on this site that has something to show, newest content first. Thin pages are left out
 * so lists and the sitemap only point search engines at pages worth indexing. Cached per request.
 */
export const listPublicCenters = cache(async (domain: DomainKey): Promise<PublicCenterSummary[]> => {
  const client = db()
  const { data: centers } = await client.from('centers')
    .select('id, public_handle, name, city, state, public_description, updated_at')
    .eq('public_enabled', true).eq('is_active', true).eq('domain_key', domain).not('public_handle', 'is', null)
  if (!centers || centers.length === 0) return []

  const ids = centers.map(c => c.id as string)
  const [programs, about, team] = await Promise.all([
    client.from('center_programs').select('center_id, name, updated_at').in('center_id', ids).eq('is_active', true).order('sort_order'),
    client.from('center_about_items').select('center_id, updated_at').in('center_id', ids),
    client.from('center_team_members').select('center_id, updated_at').in('center_id', ids),
  ])
  const by = <T extends { center_id: string }>(rows: T[] | null, id: string) => (rows ?? []).filter(r => r.center_id === id)

  return centers.flatMap(c => {
    const p = by(programs.data, c.id), a = by(about.data, c.id), t = by(team.data, c.id)
    const description = c.public_description?.trim() || null
    if (!description && p.length === 0 && a.length === 0 && t.length === 0) return []
    return [{
      handle: c.public_handle as string,
      name: c.name as string,
      city: (c.city as string | null) ?? null,
      state: (c.state as string | null) ?? null,
      description,
      programNames: p.map(x => x.name as string),
      lastModified: newest(c.updated_at, ...p.map(x => x.updated_at), ...a.map(x => x.updated_at), ...t.map(x => x.updated_at)),
    }]
  }).sort((x, y) => x.name.localeCompare(y.name))
})

/** Cities with public centers, with counts */
export async function listCenterCities(domain: DomainKey) {
  const map = new Map<string, { slug: string; city: string; state: string | null; count: number }>()
  for (const c of await listPublicCenters(domain)) {
    if (!c.city) continue
    const slug = citySlug(c.city, c.state)
    const entry = map.get(slug) ?? { slug, city: c.city, state: c.state, count: 0 }
    entry.count++
    map.set(slug, entry)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))
}

/** Public centers in one city ("harrisburg-nc") */
export async function listPublicCentersInCity(domain: DomainKey, slug: string) {
  const centers = (await listPublicCenters(domain)).filter(c => citySlug(c.city, c.state) === slug)
  return { centers, city: centers[0]?.city ?? null, state: centers[0]?.state ?? null }
}

/** Other public centers in the same city, for the "more centers" links on a center page */
export async function listNearbyCenters(domain: DomainKey, city: string | null, state: string | null, excludeHandle: string, limit = 6) {
  if (!city) return []
  const here = citySlug(city, state)
  return (await listPublicCenters(domain)).filter(c => c.handle !== excludeHandle && citySlug(c.city, c.state) === here).slice(0, limit)
}

/** Handles and last-modified dates of every indexable center, for the sitemap */
export async function listPublicCenterHandles(domain: DomainKey) {
  return (await listPublicCenters(domain)).map(c => ({ handle: c.handle, updatedAt: c.lastModified }))
}

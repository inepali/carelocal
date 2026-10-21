import { createClient } from '@supabase/supabase-js'
import type { DomainKey } from '@/lib/domain-config'
import { normalizeWebUrl } from '@/lib/utils'

/**
 * Server-only reads for the public center page (/centers/<handle>). Like public-jobs.ts it uses the service
 * role with an explicit, safe column list, so nothing private can leak: only a center that turned its page
 * on (public_enabled), is active and belongs to this site (vertical). Phone, email, license number and the
 * Care Score appear only when the center chose to show them. Team emails are never selected.
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
  updatedAt: string
  programs: { id: string; name: string; ageRange: string | null; schedule: string | null; capacity: number | null; description: string | null; moreInfoUrl: string | null }[]
  team: { id: string; name: string; title: string | null; role: string | null; bio: string | null }[]
  about: { id: string; title: string; content: string | null }[]
}

const CENTER_COLUMNS = 'id, slug, public_handle, name, address, city, state, zip, phone, email, license_number, logo_url, public_description, public_show_phone, public_show_email, public_show_license, public_show_care_score, updated_at'

/** The public page of a center, or null when it does not exist, is switched off, inactive or on another site */
export async function getPublicCenter(domain: DomainKey, handle: string): Promise<PublicCenterPage | null> {
  const client = db()
  const { data: c } = await client.from('centers').select(CENTER_COLUMNS)
    .eq('public_handle', handle.toLowerCase()).eq('public_enabled', true).eq('is_active', true).eq('domain_key', domain)
    .maybeSingle()
  if (!c) return null

  const [programs, team, about, reviews] = await Promise.all([
    client.from('center_programs').select('id, name, age_range, schedule, capacity, description, more_info_url')
      .eq('center_id', c.id).eq('is_active', true).order('sort_order').order('created_at'),
    client.from('center_team_members').select('id, name, title, role, bio')
      .eq('center_id', c.id).order('sort_order').order('created_at'),
    client.from('center_about_items').select('id, title, content')
      .eq('center_id', c.id).order('sort_order').order('created_at'),
    c.public_show_care_score
      ? client.from('shift_reviews').select('rating').eq('reviewee_id', c.id).eq('reviewer_type', 'staff')
      : Promise.resolve({ data: null }),
  ])

  const ratings = (reviews.data ?? []) as { rating: number }[]
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
    description: c.public_description ?? null,
    phone: c.public_show_phone ? c.phone ?? null : null,
    email: c.public_show_email ? c.email ?? null : null,
    licenseNumber: c.public_show_license ? c.license_number ?? null : null,
    careScore: ratings.length > 0
      ? { average: ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length, count: ratings.length }
      : null,
    updatedAt: c.updated_at,
    programs: (programs.data ?? []).map(p => ({
      id: p.id, name: p.name, ageRange: p.age_range ?? null, schedule: p.schedule ?? null,
      capacity: p.capacity ?? null, description: p.description ?? null, moreInfoUrl: normalizeWebUrl(p.more_info_url),
    })),
    team: (team.data ?? []).map(t => ({ id: t.id, name: t.name, title: t.title ?? null, role: t.role ?? null, bio: t.bio ?? null })),
    about: (about.data ?? []).map(a => ({ id: a.id, title: a.title, content: a.content ?? null })),
  }
}

/** Handles of every public center on this site, for the sitemap */
export async function listPublicCenterHandles(domain: DomainKey) {
  const { data } = await db().from('centers').select('public_handle, updated_at')
    .eq('public_enabled', true).eq('is_active', true).eq('domain_key', domain).not('public_handle', 'is', null)
  return (data ?? []).map(c => ({ handle: c.public_handle as string, updatedAt: c.updated_at as string }))
}

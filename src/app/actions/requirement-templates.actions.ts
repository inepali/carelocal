'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { RequirementTemplateItem } from '@/lib/requirement-templates'

const admin = () => createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

/** Server actions are public endpoints: confirm the caller is a platform super admin. */
async function requireSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.app_metadata?.is_super_admin === true ? user : null
}

/** Save a center's current document requirements as a reusable template. */
export async function exportCenterRequirementsAsTemplate(centerId: string, name: string, description?: string) {
  const user = await requireSuperAdmin()
  if (!user) return { success: false as const, error: 'Not allowed' }
  if (!name.trim()) return { success: false as const, error: 'Template name is required' }

  const db = admin()
  const [{ data: center }, { data: rows, error }] = await Promise.all([
    db.from('centers').select('domain_key').eq('id', centerId).maybeSingle(),
    db.from('center_document_requirements').select('*').eq('center_id', centerId)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
  ])
  if (error || !center) return { success: false as const, error: error?.message ?? 'Center not found' }
  if (!rows?.length) return { success: false as const, error: 'This center has no requirements to export' }

  const items: RequirementTemplateItem[] = rows.map(r => ({
    document_name: r.document_name,
    notes: r.notes ?? null,
    document_category: r.document_category,
    section: r.section,
    section_label: r.section_label ?? null,
    evidence_type: r.evidence_type,
    is_conditional: !!r.is_conditional,
    is_confidential: !!r.is_confidential,
    due_within_days: r.due_within_days ?? null,
    renewal_type: r.renewal_type,
    renewal_months: r.renewal_months ?? null,
    group_label: r.group_label ?? null,
    applies_to_class: r.applies_to_class ?? null,
  }))

  const { error: insertError } = await db.from('requirement_templates').insert({
    name: name.trim(),
    description: description?.trim() || null,
    domain_key: center.domain_key,
    items,
    source_center_id: centerId,
    created_by: user.id,
  })
  if (insertError) return { success: false as const, error: insertError.message }
  return { success: true as const, count: items.length }
}

export async function deleteRequirementTemplate(templateId: string) {
  if (!(await requireSuperAdmin())) return { success: false as const, error: 'Not allowed' }
  const { error } = await admin().from('requirement_templates').delete().eq('id', templateId)
  return error ? { success: false as const, error: error.message } : { success: true as const }
}

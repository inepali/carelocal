import type { EmploymentClass, EvidenceType, RenewalType, RequirementSection } from '@/lib/types'

/**
 * A saved checklist a super admin exported from one center so other centers can import it.
 * Items are the requirement rules only: no files, role restrictions or staff data.
 */
export interface RequirementTemplateItem {
  document_name: string
  notes: string | null
  document_category: string
  section: RequirementSection
  section_label: string | null
  evidence_type: EvidenceType
  is_conditional: boolean
  is_confidential: boolean
  due_within_days: number | null
  renewal_type: RenewalType
  renewal_months: number | null
  group_label: string | null
  applies_to_class: EmploymentClass[] | null
}

export interface RequirementTemplate {
  id: string
  name: string
  description: string | null
  domain_key: string
  items: RequirementTemplateItem[]
  created_at: string
}

/** De-dupe key stored in center_document_requirements.template_key so re-importing never doubles items */
export function templateItemKey(templateId: string, item: Pick<RequirementTemplateItem, 'document_name' | 'group_label'>) {
  return `tpl:${templateId}:${item.group_label ?? ''}:${item.document_name}`.slice(0, 200)
}

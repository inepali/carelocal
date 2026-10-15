import type { EmploymentClass, EvidenceType, RenewalType, RequirementSection } from '@/lib/types'

/**
 * Ready-made checklists a center can add in one click (child care vertical).
 * Source: NC DCDEE "Staff File Checklist – Center" (01-2023), "Substitute Staff File
 * Checklist – Center" (01/2023) and "Health and Safety Training Record" (02/2021).
 *
 * Items with identical rules on both checklists apply to everyone; items on one list
 * (or with different rules) are limited to that employment class.
 * `due_within_days` counts from the employment start date (0 = by day 1).
 * Centers can edit everything after adding a template.
 */
export interface TemplateItem {
  key: string
  name: string
  notes?: string
  section: RequirementSection
  evidence_type: EvidenceType
  document_category: string
  due_within_days: number | null
  renewal_type: RenewalType
  renewal_months?: number
  is_conditional?: boolean
  is_confidential?: boolean
  classes?: EmploymentClass[] // undefined = all staff
  group_label?: string
}

export interface ComplianceTemplate {
  id: string
  name: string
  description: string
  items: TemplateItem[]
}

const REGULAR: EmploymentClass[] = ['regular']
const SUBSTITUTE: EmploymentClass[] = ['substitute']

const NC_STAFF_FILES: ComplianceTemplate = {
  id: 'nc_childcare_staff_files',
  name: 'NC Staff & Substitute File Checklist',
  description: 'Personnel file items from the NC center Staff and Substitute file checklists, with due dates and renewals.',
  items: [
    // ── Personnel file ──
    { key: 'nc_employment_application', name: 'Employment Application', notes: 'Includes date of birth, education, training and experience.',
      section: 'personnel', evidence_type: 'center_record', document_category: 'documentation', due_within_days: 0, renewal_type: 'none' },
    { key: 'nc_emergency_information', name: 'Emergency Information Form', notes: 'Update as changes occur.',
      section: 'personnel', evidence_type: 'staff_document', document_category: 'documentation', due_within_days: 0, renewal_type: 'interval', renewal_months: 12 },
    { key: 'nc_cbc_letter', name: 'CBC Qualification Letter', notes: 'Criminal background check qualification letter.',
      section: 'personnel', evidence_type: 'center_record', document_category: 'background', due_within_days: 0, renewal_type: 'interval', renewal_months: 60 },
    { key: 'nc_substitute_driver', name: 'Substitute Driver Qualification', notes: 'Must be 21 with a valid driver\'s license. Required before driving duties.',
      section: 'personnel', evidence_type: 'staff_document', document_category: 'identity', due_within_days: null, renewal_type: 'document_expiry', is_conditional: true, classes: SUBSTITUTE },
    { key: 'nc_works_notification', name: 'DCDEE WORKS Qualification Notification', notes: 'Notification regarding submitted education/training for position qualification.',
      section: 'personnel', evidence_type: 'center_record', document_category: 'academic_qualification', due_within_days: 180, renewal_type: 'none', classes: REGULAR },
    { key: 'nc_coursework_enrollment', name: 'Enrollment in Coursework', notes: 'Within 6 months of assuming duties.',
      section: 'personnel', evidence_type: 'staff_document', document_category: 'academic_qualification', due_within_days: 180, renewal_type: 'none', is_conditional: true, classes: REGULAR },

    // ── Health (confidential medical file) ──
    { key: 'nc_medical_report', name: 'Medical Report', notes: 'Prior to employment. Keep in the confidential medical file.',
      section: 'health', evidence_type: 'staff_document', document_category: 'medical', due_within_days: 0, renewal_type: 'none', is_confidential: true, classes: REGULAR },
    { key: 'nc_tb_screening', name: 'TB Screening or Test Results', notes: 'Prior to the first day of work. Keep in the confidential medical file.',
      section: 'health', evidence_type: 'staff_document', document_category: 'medical', due_within_days: 0, renewal_type: 'none', is_confidential: true },
    { key: 'nc_health_questionnaire', name: 'Health Questionnaire', notes: 'Keep in the confidential medical file.',
      section: 'health', evidence_type: 'staff_document', document_category: 'medical', due_within_days: 0, renewal_type: 'interval', renewal_months: 12, is_confidential: true },

    // ── Training & certifications ──
    { key: 'nc_orientation', name: 'Orientation', notes: 'Within 2 weeks (6 weeks for some topics) of employment.',
      section: 'training', evidence_type: 'training', document_category: 'training', due_within_days: 14, renewal_type: 'none' },
    { key: 'nc_health_safety_training', name: 'Health and Safety Training', notes: 'Within the 1st year, then every 5 years. See the Health & Safety Training template for topic-level tracking.',
      section: 'training', evidence_type: 'training', document_category: 'training', due_within_days: 365, renewal_type: 'interval', renewal_months: 60, classes: REGULAR },
    { key: 'nc_health_safety_training_sub', name: 'Health and Safety Training (substitutes)', notes: 'Required if the substitute works more than 10 days in a 12-month period.',
      section: 'training', evidence_type: 'training', document_category: 'training', due_within_days: 365, renewal_type: 'interval', renewal_months: 60, is_conditional: true, classes: SUBSTITUTE },
    { key: 'nc_ongoing_training', name: 'On-Going Training', notes: 'After the first year of employment and annually thereafter.',
      section: 'training', evidence_type: 'training', document_category: 'training', due_within_days: 730, renewal_type: 'interval', renewal_months: 12, classes: REGULAR },
    { key: 'nc_cpr_first_aid', name: 'CPR / First Aid Certification', notes: 'Within 90 days of employment; renew before the expiration date.',
      section: 'training', evidence_type: 'staff_document', document_category: 'certification', due_within_days: 90, renewal_type: 'document_expiry' },
    { key: 'nc_playground_safety', name: 'Playground Safety Training', notes: 'Within 6 months of employment.',
      section: 'training', evidence_type: 'training', document_category: 'training', due_within_days: 180, renewal_type: 'none', is_conditional: true, classes: REGULAR },
    { key: 'nc_bsac', name: 'BSAC Training', notes: 'Within 3 months of employment.',
      section: 'training', evidence_type: 'training', document_category: 'training', due_within_days: 90, renewal_type: 'none', is_conditional: true, classes: REGULAR },
    { key: 'nc_its_sids', name: 'ITS-SIDS Safe Sleep Training', notes: 'Within 2 months of infant room work, then every 3 years. Administrators within 90 days.',
      section: 'training', evidence_type: 'training', document_category: 'training', due_within_days: 60, renewal_type: 'interval', renewal_months: 36, is_conditional: true },
    { key: 'nc_child_maltreatment', name: 'Recognizing and Responding to Suspicions of Child Maltreatment', notes: 'Within 90 days of employment.',
      section: 'training', evidence_type: 'training', document_category: 'training', due_within_days: 90, renewal_type: 'none' },
    { key: 'nc_epr_training', name: 'EPR in Child Care Training', notes: 'Within 1 year of licensure and within 4 months of trained staff\'s departure.',
      section: 'training', evidence_type: 'training', document_category: 'training', due_within_days: null, renewal_type: 'none', is_conditional: true, classes: REGULAR },

    // ── Policies & acknowledgements ──
    { key: 'nc_shaken_baby_policy', name: 'Receipt of Shaken Baby Syndrome / Abusive Head Trauma Policy', notes: 'Prior to providing care, and 14 days before a new policy is implemented.',
      section: 'policies', evidence_type: 'acknowledgement', document_category: 'documentation', due_within_days: 0, renewal_type: 'policy_change' },
    { key: 'nc_emc_review', name: 'Emergency Medical Care Plan (EMC) Review', notes: 'Review annually and whenever the plan is revised.',
      section: 'policies', evidence_type: 'acknowledgement', document_category: 'documentation', due_within_days: 14, renewal_type: 'interval', renewal_months: 12 },
    { key: 'nc_epr_plan_review', name: 'EPR Plan Review', notes: 'At orientation and annually.',
      section: 'policies', evidence_type: 'acknowledgement', document_category: 'documentation', due_within_days: 14, renewal_type: 'interval', renewal_months: 12, classes: REGULAR },
    { key: 'nc_epr_plan_informed_sub', name: 'Informed of EPR Plan and Its Location', notes: 'Day 1 and annually.',
      section: 'policies', evidence_type: 'acknowledgement', document_category: 'documentation', due_within_days: 0, renewal_type: 'interval', renewal_months: 12, classes: SUBSTITUTE },
    { key: 'nc_job_description', name: 'Receipt of Job Description', notes: 'At the time of employment.',
      section: 'policies', evidence_type: 'acknowledgement', document_category: 'documentation', due_within_days: 0, renewal_type: 'policy_change' },
    { key: 'nc_personnel_policy', name: 'Receipt of Operational and Personnel Policies', notes: 'Day 1 and when changes occur.',
      section: 'policies', evidence_type: 'acknowledgement', document_category: 'documentation', due_within_days: 0, renewal_type: 'policy_change', classes: REGULAR },
    { key: 'nc_aquatic_policy', name: 'Receipt of Aquatic Activities Policy', notes: 'Includes pool operator / off-site aquatic facility rules. Before supervising aquatic activity and annually.',
      section: 'policies', evidence_type: 'acknowledgement', document_category: 'documentation', due_within_days: 0, renewal_type: 'interval', renewal_months: 12, is_conditional: true },

    // ── Evaluations & development ──
    { key: 'nc_professional_development_plan', name: 'Professional Development Plan', notes: 'Within 1 year of employment and annually.',
      section: 'evaluations', evidence_type: 'center_record', document_category: 'documentation', due_within_days: 365, renewal_type: 'interval', renewal_months: 12 },
    { key: 'nc_staff_evaluation', name: 'Staff Evaluation', notes: 'Annually.',
      section: 'evaluations', evidence_type: 'center_record', document_category: 'documentation', due_within_days: 365, renewal_type: 'interval', renewal_months: 12 },
  ],
}

const HS_GROUP = 'Health & Safety Training'
const hsTopic = (key: string, name: string, extra: Partial<TemplateItem> = {}): TemplateItem => ({
  key: `nc_hs_${key}`, name, section: 'training', evidence_type: 'training', document_category: 'training',
  due_within_days: 365, renewal_type: 'interval', renewal_months: 60, group_label: HS_GROUP,
  notes: 'Within the 1st year of employment, then every 5 years. Record date and hours.', ...extra,
})

const NC_HEALTH_SAFETY: ComplianceTemplate = {
  id: 'nc_childcare_health_safety',
  name: 'NC Health & Safety Training (11 topics)',
  description: 'Topic-level tracking for the Health and Safety Training Record (Child Care Rule .1102 / .1703(b)).',
  items: [
    hsTopic('infectious_disease', 'Prevention and control of infectious diseases, including immunizations'),
    hsTopic('safe_sleep', 'Prevention of SIDS and use of safe sleep practices', {
      is_conditional: true,
      notes: 'Not required with current ITS-SIDS certification (FCCH operators, infant staff and administrators take the NC ITS-SIDS course instead).',
    }),
    hsTopic('medication', 'Administration of medication, with standards for parental consent'),
    hsTopic('allergies', 'Prevention of and response to emergencies due to food and allergic reactions'),
    hsTopic('premises_safety', 'Building and physical premises safety', { notes: 'Electrical hazards, bodies of water, vehicular traffic. Within the 1st year, then every 5 years.' }),
    hsTopic('emergency_preparedness', 'Emergency preparedness and response planning'),
    hsTopic('hazardous_materials', 'Handling and storage of hazardous materials and disposal of biocontaminants'),
    hsTopic('transporting', 'Precautions in transporting children', { is_conditional: true }),
    hsTopic('shaken_baby', 'Prevention of Shaken Baby Syndrome, Abusive Head Trauma and child maltreatment'),
    hsTopic('abuse_reporting', 'Recognizing and reporting child abuse, neglect and maltreatment'),
    // Shared key with the file checklist so it is never added twice
    { key: 'nc_cpr_first_aid', name: 'CPR / First Aid Certification', notes: 'Within 90 days of employment; renew before the expiration date. Hours do not count toward on-going training.',
      section: 'training', evidence_type: 'staff_document', document_category: 'certification', due_within_days: 90, renewal_type: 'document_expiry' },
  ],
}

/** Templates offered per vertical (child care only for now) */
export const COMPLIANCE_TEMPLATES: Record<string, ComplianceTemplate[]> = {
  childcare: [NC_STAFF_FILES, NC_HEALTH_SAFETY],
}

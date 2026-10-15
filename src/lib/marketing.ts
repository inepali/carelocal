import type { DomainKey } from '@/lib/domain-config'

/**
 * Landing-page copy for the compliance & operations suite (document management,
 * training records, policy sign-off, document requests, inspections, vendors, reminders).
 * One entry per vertical; keep claims to what the product actually does.
 */
export type SuiteIcon = 'files' | 'request' | 'signature' | 'training' | 'inspection' | 'reminder'

export interface SuitePillar {
  icon: SuiteIcon
  title: string
  desc: string
  points: string[]
}

export interface ComplianceSuiteCopy {
  eyebrow: string
  title: string
  titleHighlight: string
  subtitle: string
  pillars: SuitePillar[]
  security: { title: string; desc: string }[]
  /** Labels for the illustrative compliance grid */
  gridColumns: string[]
  people: string
}

const SECURITY_COMMON = (medical: string) => [
  { title: 'Confidential medical file', desc: `${medical} are locked to the owner and designated admins.` },
  { title: 'Private, encrypted storage', desc: 'Files never sit on a public link. Each view uses a link that expires in minutes.' },
  { title: 'Every view is logged', desc: 'A record of who opened which document, and when.' },
  { title: 'Records that stay on file', desc: 'Accepted documents remain in your records, even after someone leaves.' },
]

export const COMPLIANCE_SUITE: Record<DomainKey, ComplianceSuiteCopy> = {
  childcare: {
    eyebrow: 'Compliance & operations',
    title: 'Inspection-ready, ',
    titleHighlight: 'every single day',
    subtitle: 'Filling shifts is only half the job. CareLocal keeps every staff file, training record and facility inspection current — so a licensing visit is a formality, not a fire drill.',
    pillars: [
      {
        icon: 'files',
        title: 'Staff files that track themselves',
        desc: 'Every requirement gets a due date from each employee’s start date and renews on schedule.',
        points: [
          'Start from the NC Staff & Substitute file checklists in one click',
          'Different rules for regular and substitute staff',
          'Annual, every-5-year and on-expiry renewals handled for you',
        ],
      },
      {
        icon: 'request',
        title: 'Request documents in one click',
        desc: 'Ask one teacher — or everyone missing an item — and they reply from their phone.',
        points: [
          'Staff answer from their own document library',
          'Only the document they choose is shared with you',
          'Review, accept or send it back with a note',
        ],
      },
      {
        icon: 'training',
        title: 'Training records with hours',
        desc: 'Health & Safety topics, ITS-SIDS, CPR / First Aid, orientation and on-going training in one place.',
        points: [
          'Track all 11 Health & Safety Training topics',
          'Record completion dates and training hours',
          'Mark items not applicable, with a reason',
        ],
      },
      {
        icon: 'signature',
        title: 'Policies signed digitally',
        desc: 'Shaken baby / AHT, emergency plans, job descriptions and personnel policies — acknowledged online.',
        points: [
          'Each signature records name, time and policy version',
          'Update a policy and everyone is asked to sign again',
          'No more chasing paper signatures',
        ],
      },
      {
        icon: 'inspection',
        title: 'Inspections & vendors',
        desc: 'Fire marshal, sanitation, playground, fire extinguisher, pest control, HVAC and more.',
        points: [
          'Due dates, results and full history for every inspection',
          'Attach the inspection report and paperwork to each visit',
          'Keep your service vendors and contacts in one list',
        ],
      },
      {
        icon: 'reminder',
        title: 'Reminders that do the chasing',
        desc: 'Staff hear about what’s due before it’s due. You get one digest, not a pile of alerts.',
        points: [
          'Staff reminded 30, 7 and 1 day ahead, then weekly',
          'Director digest when something needs your review',
          'One-glance compliance grid for every employee',
        ],
      },
    ],
    security: SECURITY_COMMON('Medical reports, TB results and health questionnaires'),
    gridColumns: ['App', 'TB', 'CBC', 'CPR', 'H&S', 'SIDS', 'EPR'],
    people: 'teachers',
  },

  healthcare: {
    eyebrow: 'Credentialing & operations',
    title: 'Survey-ready, ',
    titleHighlight: 'every single day',
    subtitle: 'Filling shifts is only half the job. CareLocal Health keeps every credential, competency and facility inspection current — so you are never caught out by an expired license.',
    pillars: [
      {
        icon: 'files',
        title: 'Credential files that track themselves',
        desc: 'Licenses, BLS, immunizations and competencies with due dates from each hire date.',
        points: [
          'Build your checklist once; it applies to every clinician',
          'Renewals before expiry, annually or on your schedule',
          'Separate rules for staff and per-diem clinicians',
        ],
      },
      {
        icon: 'request',
        title: 'Request credentials in one click',
        desc: 'Ask one nurse — or everyone with an expiring card — and they reply from their phone.',
        points: [
          'Clinicians answer from their own document library',
          'Only the document they choose is shared with you',
          'Review, accept or send it back with a note',
        ],
      },
      {
        icon: 'training',
        title: 'Training & competencies',
        desc: 'Orientation, annual competencies and in-services with completion dates and hours.',
        points: [
          'Record completion dates and hours',
          'Mark items not applicable, with a reason',
          'See who is current at a glance',
        ],
      },
      {
        icon: 'signature',
        title: 'Policies signed digitally',
        desc: 'Policy and procedure acknowledgements captured online — no paper rounds.',
        points: [
          'Each signature records name, time and policy version',
          'Update a policy and everyone is asked to sign again',
          'A clear record for every staff member',
        ],
      },
      {
        icon: 'inspection',
        title: 'Inspections & vendors',
        desc: 'Fire, generator load tests, equipment calibration, elevator and health department inspections.',
        points: [
          'Due dates, results and full history for every inspection',
          'Attach the inspection report and paperwork to each visit',
          'Keep your service vendors and contacts in one list',
        ],
      },
      {
        icon: 'reminder',
        title: 'Reminders that do the chasing',
        desc: 'Clinicians hear about expiring credentials before they lapse. You get one digest.',
        points: [
          'Staff reminded 30, 7 and 1 day ahead, then weekly',
          'Manager digest when something needs review',
          'One-glance credential grid for every clinician',
        ],
      },
    ],
    security: SECURITY_COMMON('Health records and immunization documents'),
    gridColumns: ['License', 'BLS', 'TB', 'Vax', 'Orient', 'Skills', 'HIPAA'],
    people: 'clinicians',
  },

  senior: {
    eyebrow: 'Compliance & operations',
    title: 'Audit-ready, ',
    titleHighlight: 'every single day',
    subtitle: 'Covering call-outs is only half the job. CareLocal Senior keeps caregiver files, training records and facility inspections current — so an audit never turns into a scramble.',
    pillars: [
      {
        icon: 'files',
        title: 'Caregiver files that track themselves',
        desc: 'Background checks, CPR, TB and training with due dates from each caregiver’s start date.',
        points: [
          'Build your checklist once; it applies to every caregiver',
          'Renewals before expiry, annually or on your schedule',
          'Separate rules for staff and on-call caregivers',
        ],
      },
      {
        icon: 'request',
        title: 'Request documents in one click',
        desc: 'Ask one caregiver — or everyone missing an item — and they reply from their phone.',
        points: [
          'Caregivers answer from their own document library',
          'Only the document they choose is shared with you',
          'Review, accept or send it back with a note',
        ],
      },
      {
        icon: 'training',
        title: 'Training records with hours',
        desc: 'Caregiver, medication and in-service training with completion dates and hours.',
        points: [
          'Record completion dates and hours',
          'Mark items not applicable, with a reason',
          'See who is current at a glance',
        ],
      },
      {
        icon: 'signature',
        title: 'Policies signed digitally',
        desc: 'Care policies, job descriptions and handbooks acknowledged online.',
        points: [
          'Each signature records name, time and policy version',
          'Update a policy and everyone is asked to sign again',
          'No more chasing paper signatures',
        ],
      },
      {
        icon: 'inspection',
        title: 'Inspections & vendors',
        desc: 'Fire safety, health and sanitation, pest control, HVAC and licensing inspections.',
        points: [
          'Due dates, results and full history for every inspection',
          'Attach the inspection report and paperwork to each visit',
          'Keep your service vendors and contacts in one list',
        ],
      },
      {
        icon: 'reminder',
        title: 'Reminders that do the chasing',
        desc: 'Caregivers hear about what’s due before it lapses. You get one digest.',
        points: [
          'Staff reminded 30, 7 and 1 day ahead, then weekly',
          'Manager digest when something needs review',
          'One-glance compliance grid for every caregiver',
        ],
      },
    ],
    security: SECURITY_COMMON('Medical and health records'),
    gridColumns: ['BG check', 'TB', 'CPR', 'Train', 'Meds', 'Policy', 'Review'],
    people: 'caregivers',
  },
}

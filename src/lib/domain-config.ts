export type DomainKey = 'childcare' | 'senior' | 'healthcare'

export interface PricingPlan {
  name: string
  price: number
  desc: string
  features: string[]
  cta: string
  href: string
  highlight: boolean
}

export interface DomainConfig {
  domainKey: DomainKey
  themeClass: string
  appName: string
  title: string
  description: string
  staffTerm: string
  workAreaTerm: string
  logoShort: string
  supportEmail: string
  privacyEmail: string
  hero: {
    tagline: string
    title: string
    titleHighlight: string
    subtitle: string
    ctaPrimary: string
    ctaSecondary: string
    footnote: string
  }
  stats: { val: string; label: string }[]
  howItWorks: {
    step: string
    title: string
    desc: string
    iconName: string
  }[]
  features: {
    iconName: string
    title: string
    desc: string
  }[]
  trustQuote: {
    quote: string
    author: string
  }
  faqs: { q: string; a: string }[]
  pricing: PricingPlan[]
  onboarding: {
    roleHeading: string
    roleSubtitle: string
    centerSelectorLabel: string
    centerSelectorDesc: string
    staffSelectorLabel: string
    staffSelectorDesc: string
    centerNameLabel: string
    centerNamePlaceholder: string
    directorNameLabel: string
    directorNamePlaceholder: string
    emailPlaceholder: string
    defaultStaffRole: string
    complianceInfoTitle: string
    complianceInfoDesc: string
  }
}

export const DOMAIN_CONFIGS: Record<DomainKey, DomainConfig> = {
  childcare: {
    domainKey: 'childcare',
    themeClass: 'theme-childcare',
    appName: 'CareLocal',
    title: 'CareLocal | Childcare Staffing & Compliance Software',
    description: 'Fill daycare shifts by text in minutes and keep staff files, training records and inspections current. 3-month free trial.',
    staffTerm: 'Staffs',
    workAreaTerm: 'Classrooms',
    logoShort: 'CL',
    supportEmail: 'support@carelocal.co',
    privacyEmail: 'privacy@carelocal.co',
    hero: {
      tagline: 'Now live in Charlotte, NC',
      title: 'Fill childcare shifts in ',
      titleHighlight: 'minutes, not hours',
      subtitle: 'CareLocal is the staffing coordination platform built exclusively for childcare centers. Post a shift, blast your staff pool via SMS, and get confirmation — before you finish your coffee.',
      ctaPrimary: 'Start your free trial',
      ctaSecondary: 'See how it works',
      footnote: '3-month free trial · No credit card required · Staff accounts free to join'
    },
    stats: [
      { val: '< 4 hrs', label: 'Avg. shift fill time' },
      { val: '75%+', label: 'Shift fill rate' },
      { val: '$0', label: 'Cost to staff' }
    ],
    howItWorks: [
      {
        step: '01',
        title: 'Center subscribes',
        desc: 'Sign up in minutes. Set up your center profile, classrooms, and document checklist.',
        iconName: 'ShieldCheck'
      },
      {
        step: '02',
        title: 'Invite your staff pool',
        desc: 'Send unique invite links to your teachers, floaters, support staff, and cooks. Their accounts are free to join.',
        iconName: 'Users'
      },
      {
        step: '03',
        title: 'Post an open shift',
        desc: 'It takes 30 seconds. Pick the date, time, classroom, and staff type needed.',
        iconName: 'Clock'
      },
      {
        step: '04',
        title: 'Blast fill via SMS',
        desc: 'CareLocal instantly texts your eligible staff pool. The first to claim it gets the shift.',
        iconName: 'MessageSquare'
      }
    ],
    features: [
      {
        iconName: 'Zap',
        title: 'Instant SMS Blast Fill',
        desc: 'When a shift opens, your entire eligible staff pool gets a text immediately. No calls. No group chats.'
      },
      {
        iconName: 'FileText',
        title: 'Document Profiles',
        desc: 'Staff upload their CPR cards, background checks, and certs once. You review and approve them directly.'
      },
      {
        iconName: 'Users',
        title: 'Your Staff, Your Pool',
        desc: "Not a marketplace. Your center builds its own trusted pool of people you already know."
      },
      {
        iconName: 'ShieldCheck',
        title: 'You Own Compliance',
        desc: 'Set your own document checklist. CareLocal organizes docs — your center makes all compliance calls.'
      }
    ],
    trustQuote: {
      quote: '"We used to spend 45 minutes calling substitutes every morning. Now I post a shift and my phone buzzes with a confirmation before I finish setting up the classroom."',
      author: 'Center Director, Charlotte, NC'
    },
    faqs: [
      {
        q: 'How does the SMS shift blast work?',
        a: "With CareLocal's childcare staff scheduling software, posting a shift takes under 30 seconds. The platform instantly broadcasts an SMS text notification to your pre-approved substitute pool. The first eligible teacher to claim it gets the shift. No phone tag, no manual group messages."
      },
      {
        q: 'Is CareLocal a childcare staffing agency?',
        a: 'No. CareLocal is a software platform and a direct alternative to expensive daycare staffing agencies. We provide the tools for childcare centers to build, organize, and dispatch their own private substitute pools, saving thousands in agency markups and placement fees.'
      },
      {
        q: 'How does CareLocal help with state licensing compliance?',
        a: 'We serve as your central database for teacher credentials. Staff upload background checks, CPR cards, and training certifications once. Center directors can review, approve, and track expiration dates in real-time, ensuring only compliant subs are allowed to claim open shifts.'
      },
      {
        q: 'Is CareLocal free for daycare teachers and substitutes?',
        a: "Yes, it is free to join. Teacher, floater, and substitute accounts have no subscription: create a profile, upload certifications, and claim shifts from any mobile browser. A small platform maintenance fee, set by your metro area, may be added to your balance when you check in to a shift."
      },
      {
        q: 'How does the 3-month free trial work?',
        a: 'We want center directors to experience the benefits risk-free. You get full access to CareLocal\'s staff scheduling features, SMS blasting, and document management for 3 months. No credit card is required to sign up, and you can cancel anytime.'
      }
    ],
    pricing: [
      {
        name: 'Starter',
        price: 49,
        desc: 'Perfect for a single-location center getting started.',
        features: ['1 location', 'Up to 30 staff profiles', 'Shift posting & blast fill', 'SMS + email notifications', 'Document collection & review', 'Basic reporting'],
        cta: 'Start free trial',
        href: '/register?plan=starter',
        highlight: false
      },
      {
        name: 'Growth',
        price: 99,
        desc: 'For growing centers with multiple rooms or a second location.',
        features: ['Up to 3 locations', 'Up to 100 staff profiles', 'Everything in Starter', 'Staff preference & priority blast', 'Scheduling calendar', 'Payroll export (CSV)', 'Document expiry reminders', 'Staff reliability scores'],
        cta: 'Start free trial',
        href: '/register?plan=growth',
        highlight: true
      },
      {
        name: 'Network',
        price: 199,
        desc: 'For multi-site operators managing a shared staff pool.',
        features: ['Up to 10 locations', 'Up to 300 staff profiles', 'Everything in Growth', 'Shared staff pool across locations', 'Mobile PWA for staff', 'QuickBooks / Gusto export', 'Priority support'],
        cta: 'Start free trial',
        href: '/register?plan=network',
        highlight: false
      }
    ],
    onboarding: {
      roleHeading: 'Create your account',
      roleSubtitle: 'Choose how you want to use the platform to get started.',
      centerSelectorLabel: 'I am a Childcare Center',
      centerSelectorDesc: 'I want to post shifts and find staff.',
      staffSelectorLabel: 'I am a Staff Member',
      staffSelectorDesc: 'I want to find shifts at local centers.',
      centerNameLabel: 'Center Name',
      centerNamePlaceholder: 'Sunshine Early Learning',
      directorNameLabel: 'Your Name (Director/Admin)',
      directorNamePlaceholder: 'Jane Doe',
      emailPlaceholder: 'director@sunshine.org',
      defaultStaffRole: 'floater',
      complianceInfoTitle: 'You own your compliance.',
      complianceInfoDesc: 'CareLocal gives you the tools to collect, review, and organize staff documents in one secure place. Set your own requirements and manage your pool with confidence.'
    }
  },
  healthcare: {
    domainKey: 'healthcare',
    themeClass: 'theme-healthcare',
    appName: 'CareLocal Health',
    title: 'CareLocal Health | Healthcare Staffing & Credentialing',
    description: 'Fill clinical shifts from your credentialed pool by text in minutes and keep licenses, competencies and inspections current. Free trial.',
    staffTerm: 'Medical Staff',
    workAreaTerm: 'Care Areas',
    logoShort: 'CLH',
    supportEmail: 'support@carelocal.net',
    privacyEmail: 'privacy@carelocal.net',
    hero: {
      tagline: 'Healthcare Staffing Platform',
      title: 'Fill hospital & clinic shifts in ',
      titleHighlight: 'minutes, not hours',
      subtitle: 'CareLocal Health is the staffing coordination platform built exclusively for healthcare facilities. Post a shift, blast your credentialed nursing pool via SMS, and get shifts claimed instantly.',
      ctaPrimary: 'Start free clinic trial',
      ctaSecondary: 'Learn details',
      footnote: '3-month free trial · No setup fees · Free staff accounts'
    },
    stats: [
      { val: '< 15 mins', label: 'Avg. shift fill time' },
      { val: '92%+', label: 'Shift fill rate' },
      { val: '$0', label: 'Cost to medical staff' }
    ],
    howItWorks: [
      {
        step: '01',
        title: 'Facility subscribes',
        desc: 'Sign up in minutes. Set up your hospital or clinic profile, care areas, and credential checklist.',
        iconName: 'ShieldCheck'
      },
      {
        step: '02',
        title: 'Invite nursing pool',
        desc: 'Send unique invite links to your RNs, LPNs, CNAs, and caregivers. Their accounts are free to join.',
        iconName: 'Users'
      },
      {
        step: '03',
        title: 'Post open shift',
        desc: 'It takes 30 seconds. Pick the date, time, Care Area (e.g. ICU, ER), and staff type needed.',
        iconName: 'Clock'
      },
      {
        step: '04',
        title: 'Blast fill via SMS',
        desc: 'CareLocal Health instantly texts your credentialed staff pool. The first to claim gets the shift.',
        iconName: 'MessageSquare'
      }
    ],
    features: [
      {
        iconName: 'Zap',
        title: 'Instant SMS Shift Broadcast',
        desc: 'When a shift opens, your entire pre-approved pool gets a text alert. No phone tag. No agency middleman.'
      },
      {
        iconName: 'FileText',
        title: 'Credential Verification Vault',
        desc: 'Nurses upload licenses, BLS certifications, and immunizations. You review and approve documents directly.'
      },
      {
        iconName: 'Users',
        title: 'Your Private Network',
        desc: 'Not a third-party marketplace. Build, maintain, and dispatch your own trusted, internal healthcare pool.'
      },
      {
        iconName: 'ShieldCheck',
        title: 'Complete Compliance Control',
        desc: 'Set your own compliance standards. Verify credentials against clinic policies, and let software track expiry dates.'
      }
    ],
    trustQuote: {
      quote: '"Managing shift coverage across our clinics used to take half a day. Now we broadcast the shift and a qualified CNA claims it in minutes. Our operations are seamless."',
      author: 'Operations Director, Charlotte Health System'
    },
    faqs: [
      {
        q: 'How does the SMS shift broadcast work?',
        a: "With CareLocal Health, posting a shift takes under 30 seconds. The platform instantly broadcasts an SMS text notification to your pre-approved pool of nurses and aides. The first qualified professional to claim it gets the shift. No phone tag, no manual group messages."
      },
      {
        q: 'Is CareLocal Health a healthcare staffing agency?',
        a: 'No. CareLocal Health is a software-as-a-service platform that helps you avoid expensive staffing agencies. We provide the tools for clinics and hospitals to build, organize, and dispatch their own private substitute and PRN pools, saving thousands in markup fees.'
      },
      {
        q: 'How does the platform help with medical compliance?',
        a: 'We serve as a central vault for medical credentials. Staff upload state nursing licenses, BLS certifications, background checks, and health/immunization logs. Administrators can review, approve, and track expiration dates in real-time, ensuring only fully compliant staff claim open shifts.'
      },
      {
        q: 'Is CareLocal Health free for nurses and CNAs?',
        a: "Yes, it is free to join. Nurse, CNA, and caregiver accounts have no subscription: create a profile, upload certifications, and claim shifts from any mobile browser. A small platform maintenance fee, set by your metro area, may be added to your balance when you check in to a shift."
      },
      {
        q: 'How does the 3-month free trial work?',
        a: 'We want healthcare administrators to experience the benefits risk-free. You get full access to CareLocal Health\'s staff scheduling features, SMS blasting, and compliance management for 3 months. No credit card is required to sign up, and you can cancel anytime.'
      }
    ],
    pricing: [
      {
        name: 'Starter',
        price: 99,
        desc: 'Perfect for a single-location clinic or practice getting started.',
        features: ['1 clinic location', 'Up to 30 staff profiles', 'Shift posting & blast fill', 'SMS + email notifications', 'License collection & review', 'Basic reporting'],
        cta: 'Start free trial',
        href: '/register?plan=starter',
        highlight: false
      },
      {
        name: 'Growth',
        price: 249,
        desc: 'For larger medical facilities or practices with multiple wards.',
        features: ['Up to 3 locations', 'Up to 100 staff profiles', 'Everything in Starter', 'Staff preference & priority blast', 'Scheduling calendar', 'Payroll export (CSV)', 'License expiry alerts', 'Staff reliability scores'],
        cta: 'Start free trial',
        href: '/register?plan=growth',
        highlight: true
      },
      {
        name: 'Network',
        price: 499,
        desc: 'For healthcare networks managing a shared nurse registry.',
        features: ['Up to 10 locations', 'Up to 300 staff profiles', 'Everything in Growth', 'Shared staff pool across wards', 'Mobile PWA for staff', 'QuickBooks / Gusto export', 'Priority support'],
        cta: 'Start free trial',
        href: '/register?plan=network',
        highlight: false
      }
    ],
    onboarding: {
      roleHeading: 'Create your facility account',
      roleSubtitle: 'Choose how you want to use the healthcare platform to get started.',
      centerSelectorLabel: 'I am a Healthcare Facility',
      centerSelectorDesc: 'I want to post clinical shifts and find healthcare staff.',
      staffSelectorLabel: 'I am a Staff Member (RN/LPN/CNA)',
      staffSelectorDesc: 'I want to find shifts at local clinics and hospitals.',
      centerNameLabel: 'Facility Name',
      centerNamePlaceholder: 'Mercy Health Clinic',
      directorNameLabel: 'Your Name (Administrator/Director)',
      directorNamePlaceholder: 'Jane Doe, RN',
      emailPlaceholder: 'admin@mercyhealth.com',
      defaultStaffRole: 'caregiver',
      complianceInfoTitle: 'Fully manage clinical compliance.',
      complianceInfoDesc: 'CareLocal Health gives you the tools to collect, review, and organize medical licenses, BLS cards, and immunization records in one secure place. Set your own requirements and manage shifts with absolute compliance.'
    }
  },
  senior: {} as DomainConfig
}

DOMAIN_CONFIGS.senior = {
  ...DOMAIN_CONFIGS.healthcare,
  domainKey: 'senior',
  themeClass: 'theme-senior',
  appName: 'CareLocal Senior',
  title: 'CareLocal Senior — Caregiver Staffing & Compliance Software',
  description: 'Cover caregiver call-outs with your trusted caregiver network and keep files, training records and inspections current in one place.',
  staffTerm: 'Caregivers',
  workAreaTerm: 'Care Areas',
  logoShort: 'CLS',
  supportEmail: 'support@carelocalsenior.com',
  privacyEmail: 'privacy@carelocalsenior.com',
  hero: {
    tagline: 'Senior care staffing, made dependable',
    title: 'Keep senior-care shifts ' ,
    titleHighlight: 'covered with confidence',
    subtitle: 'CareLocal Senior helps home-care agencies, assisted-living communities, and senior-care teams fill call-outs with a trusted, qualified caregiver network.',
    ctaPrimary: 'Start your free trial',
    ctaSecondary: 'See how it works',
    footnote: '3-month free trial · No setup fees · Free to join for caregivers'
  },
  stats: [
    { val: '< 2 hrs', label: 'Avg. coverage response' },
    { val: '85%+', label: 'Shift fill target' },
    { val: '$0', label: 'Cost to caregivers' }
  ],
  howItWorks: [
    { step: '01', title: 'Agency subscribes', desc: 'Set up your locations, care areas, caregiver roles, and credential checklist.', iconName: 'ShieldCheck' },
    { step: '02', title: 'Invite your caregiver pool', desc: 'Build a trusted network of caregivers, aides, and support professionals.', iconName: 'Users' },
    { step: '03', title: 'Post an open shift', desc: 'Choose the client or care area, schedule, role, and requirements.', iconName: 'Clock' },
    { step: '04', title: 'Fill with confidence', desc: 'Notify eligible caregivers and keep handoffs and coverage visible.', iconName: 'MessageSquare' }
  ],
  features: [
    { iconName: 'Zap', title: 'Fast Call-Out Coverage', desc: 'Notify your eligible caregiver pool as soon as coverage changes.' },
    { iconName: 'FileText', title: 'Caregiver Credentials', desc: 'Organize background checks, training, CPR, and other required documents.' },
    { iconName: 'Users', title: 'Your Private Network', desc: 'Build and manage the trusted caregiver pool your organization knows.' },
    { iconName: 'ShieldCheck', title: 'Continuity of Care', desc: 'Keep approvals, shift notes, and care-area requirements visible to managers.' }
  ],
  trustQuote: {
    quote: '"When a caregiver calls out, we need a trusted replacement quickly and a clear handoff for the next shift."',
    author: 'Senior Care Operations Director'
  },
  faqs: [
    { q: 'How does CareLocal Senior fill open shifts?', a: 'Post an open shift and notify the eligible caregiver pool approved by your organization. Managers can review claims and confirm coverage.' },
    { q: 'Is CareLocal Senior a caregiving agency?', a: 'No. CareLocal Senior is software that helps care organizations manage their own private caregiver networks.' },
    { q: 'What documents can caregivers upload?', a: 'Organizations can collect background checks, CPR cards, training records, references, and other internal requirements.' },
    { q: 'Can this support home-care and facility care?', a: 'Yes. Configure locations, care areas, roles, and approval rules for your operating model.' },
    { q: 'How does CareLocal Senior keep caregiver files compliant?', a: 'Build your checklist once — background checks, TB, CPR, caregiver and medication training — and every item gets a due date from each caregiver’s start date and renews on schedule. Record training dates and hours, collect policy acknowledgements online, and see who needs what at a glance.' },
    { q: 'How are caregiver documents protected?', a: 'Documents live in private, encrypted storage and open only through links that expire within minutes. Medical records are kept in a confidential file only owners and designated admins can open, and every view is logged.' },
    { q: 'How does the free trial work?', a: 'Start with the staffing, compliance, document and notification workflows during the trial. No credit card is required.' }
  ],
  pricing: [
    { name: 'Starter', price: 79, desc: 'For a single home-care agency or senior-care location.', features: ['1 location', 'Up to 30 caregiver profiles', 'Shift posting and notifications', 'Credential collection and review', 'Basic reporting'], cta: 'Start free trial', href: '/register?plan=starter', highlight: false },
    { name: 'Growth', price: 199, desc: 'For growing agencies and assisted-living operators.', features: ['Up to 3 locations', 'Up to 100 caregiver profiles', 'Everything in Starter', 'Care-area workflows', 'PTO and schedule reporting', 'Credential expiry alerts'], cta: 'Start free trial', href: '/register?plan=growth', highlight: true },
    { name: 'Network', price: 399, desc: 'For multi-location senior-care networks.', features: ['Up to 10 locations', 'Up to 300 caregiver profiles', 'Everything in Growth', 'Shared caregiver pool', 'Advanced reporting', 'Priority support'], cta: 'Start free trial', href: '/register?plan=network', highlight: false }
  ],
  onboarding: {
    roleHeading: 'Create your senior-care account',
    roleSubtitle: 'Choose how you want to use the platform to get started.',
    centerSelectorLabel: 'I am a Senior Care Organization',
    centerSelectorDesc: 'I want to manage caregiver coverage and open shifts.',
    staffSelectorLabel: 'I am a Caregiver',
    staffSelectorDesc: 'I want to find approved shifts with local care organizations.',
    centerNameLabel: 'Organization Name',
    centerNamePlaceholder: 'Oak Ridge Senior Care',
    directorNameLabel: 'Your Name (Administrator/Director)',
    directorNamePlaceholder: 'Jane Doe',
    emailPlaceholder: 'admin@oakridgecare.org',
    defaultStaffRole: 'caregiver',
    complianceInfoTitle: 'Manage caregiver readiness with confidence.',
    complianceInfoDesc: 'Collect, review, and organize caregiver documents and training requirements in one secure place.'
  }
}

/**
 * Returns the domain key based on host/hostname.
 * Mapped to support development (ports 3000, 3001, and 3002) and production domains.
 */
export function getDomainKey(host: string): DomainKey {
  if (!host) return 'childcare'
  
  const hostLower = host.toLowerCase()
  if (
    hostLower.includes('carelocalsenior.com') ||
    hostLower.includes('senior.carelocal.co') ||
    hostLower.includes(':3002') ||
    hostLower.startsWith('3002')
  ) {
    return 'senior'
  }
  if (
    hostLower.includes('carelocal.net') ||
    hostLower.includes('carelocalhealth.com') ||
    hostLower.includes(':3001') ||
    hostLower.startsWith('3001')
  ) {
    return 'healthcare'
  }
  return 'childcare'
}

/**
 * Resolves the configuration for a given host or directly from a domain key.
 */
export function getDomainConfig(hostOrDomainKey: string): DomainConfig {
  if (hostOrDomainKey === 'childcare' || hostOrDomainKey === 'senior' || hostOrDomainKey === 'healthcare') {
    return DOMAIN_CONFIGS[hostOrDomainKey]
  }
  const key = getDomainKey(hostOrDomainKey)
  return DOMAIN_CONFIGS[key]
}

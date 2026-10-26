/**
 * The third-party services CareLocal depends on, for the Super Admin → System Settings dashboard.
 * Add a service here and it gets a card. Only environment variable NAMES live here; values are never read
 * into the page, only whether each one is set.
 *
 * stage: 'live'     in use today, so missing keys are a problem
 *        'building' being integrated, keys may be partly set
 *        'planned'  placeholder, nothing wired up yet
 */
export type IntegrationStage = 'live' | 'building' | 'planned'

export interface Integration {
  id: string
  name: string
  category: string
  description: string
  stage: IntegrationStage
  /** Must all be set for the service to work */
  env: string[]
  /** Nice to have; shown but never counted as a problem */
  optionalEnv?: string[]
  /** The service's own dashboard, for the Manage link */
  manageUrl?: string
}

export const INTEGRATIONS: Integration[] = [
  {
    id: 'supabase', name: 'Supabase', category: 'Database & sign-in', stage: 'live',
    description: 'Postgres database, sign-in and row-level security for every center, staff member and child record.',
    env: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    manageUrl: 'https://supabase.com/dashboard',
  },
  {
    id: 'r2', name: 'Cloudflare R2', category: 'File storage', stage: 'live',
    description: 'Private buckets for staff documents, center records and (separately) child records.',
    env: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_EMPLOYEE_BUCKET', 'R2_CENTER_BUCKET', 'R2_CENTER_BUCKET_INTERNAL'],
    optionalEnv: ['R2_CHILD_BUCKET', 'R2_RECEIPT_BUCKET'],
    manageUrl: 'https://dash.cloudflare.com',
  },
  {
    id: 'resend', name: 'Resend', category: 'Email', stage: 'live',
    description: 'Transactional email: invitations, reminders and contact-form messages.',
    env: ['RESEND_API_KEY'],
    manageUrl: 'https://resend.com/emails',
  },
  {
    id: 'stripe', name: 'Stripe', category: 'Payments & billing', stage: 'building',
    description: 'Subscriptions for the Starter, Growth and Network plans, plus the billing webhook.',
    env: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    optionalEnv: ['NEXT_PUBLIC_STRIPE_PRICE_STARTER', 'NEXT_PUBLIC_STRIPE_PRICE_GROWTH', 'NEXT_PUBLIC_STRIPE_PRICE_NETWORK'],
    manageUrl: 'https://dashboard.stripe.com',
  },
  {
    id: 'twilio', name: 'Twilio', category: 'SMS', stage: 'planned',
    description: 'Text messages for shift alerts and parent upload links, once carrier registration is approved.',
    env: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    manageUrl: 'https://console.twilio.com',
  },
  {
    id: 'groupme', name: 'GroupMe', category: 'Group messaging', stage: 'building',
    description: 'Posts new shifts to each center’s GroupMe group. CareLocal can create the group and bot for a center under its own GroupMe account.',
    env: ['GROUPME_ACCESS_TOKEN'],
    optionalEnv: ['GROUPME_CLIENT_ID'],
    manageUrl: 'https://dev.groupme.com',
  },
  {
    id: 'weather', name: 'Weather', category: 'Weather alerts', stage: 'planned',
    description: 'Closure and severe-weather notices for centers. Provider to be chosen.',
    env: [],
  },
]

/** Known Supabase projects, so the card can say which environment the server is pointed at */
const SUPABASE_PROJECTS: Record<string, string> = {
  kfjpsucszngvsnacjscq: 'Development',
  euwuynvcfrosoerhmyaj: 'Production',
}

export function supabaseEnvironment(url: string | undefined) {
  if (!url) return null
  try {
    const ref = new URL(url).hostname.split('.')[0]
    return SUPABASE_PROJECTS[ref] ?? 'Unknown project'
  } catch {
    return null
  }
}

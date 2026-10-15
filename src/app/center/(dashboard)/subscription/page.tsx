import { redirect } from 'next/navigation'

// Subscription now lives under About → Subscription; keep the old URL working.
export default function SubscriptionRedirect() {
  redirect('/center/about#subscription')
}

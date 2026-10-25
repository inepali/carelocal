import { redirect } from 'next/navigation'

// Plans moved into About → Subscription; keep old links (and Stripe return URLs) working.
export default function BillingRedirect() {
  redirect('/center/about#subscription')
}

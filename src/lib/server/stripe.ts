import Stripe from 'stripe'

let client: Stripe | null = null

/** Stripe client, created on first use. Throws when the key is missing instead of falling back to a placeholder. */
export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  return (client ??= new Stripe(key, { apiVersion: '2026-04-22.dahlia' }))
}

/** Webhook signing secret. Throws when missing so a known placeholder can never validate forged events. */
export function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set')
  return secret
}

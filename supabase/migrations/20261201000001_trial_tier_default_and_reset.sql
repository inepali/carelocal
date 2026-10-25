-- New centers join on the Free Trial tier for trial_months (3) with no subscription; they upgrade from
-- About → Subscription, which goes through Stripe checkout.
-- The trial runs from trial_started_at, so a trial can be restarted without touching created_at.
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS trial_started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.centers ALTER COLUMN subscription_tier SET DEFAULT 'trial';
ALTER TABLE public.centers ALTER COLUMN subscription_status SET DEFAULT 'trialing';

-- One-time reset (requested 2026-10-25): every existing center starts a fresh 3-month Free Trial today.
-- Stored Stripe customers and subscription rows are cleared; nothing is cancelled in Stripe itself.
UPDATE public.centers SET
  subscription_tier = 'trial',
  subscription_status = 'trialing',
  stripe_customer_id = NULL,
  trial_months = 3,
  trial_started_at = now();

DELETE FROM public.subscriptions;

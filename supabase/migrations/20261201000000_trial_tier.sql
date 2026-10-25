-- A tier for the free trial every new center starts on, before any Stripe subscription.
-- On its own: Postgres cannot use a new enum value in the transaction that adds it.
ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'trial' BEFORE 'starter';

-- Security: the "Service role has full access" policies used USING (true) with no TO clause,
-- which applies them to every role (anon and authenticated included). Any visitor holding the
-- public anon key could read or change every user's notifications, notification preferences,
-- web-push subscriptions and native push tokens.
--
-- The service role bypasses RLS entirely, so these policies were never needed. The per-user
-- policies ("own rows only") remain and are what the app relies on.
DROP POLICY IF EXISTS "Service role has full access to notifications" ON public.app_notifications;
DROP POLICY IF EXISTS "Service role has full access to notification_preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Service role has full access to push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Service role has full access to native push tokens" ON public.native_push_tokens;

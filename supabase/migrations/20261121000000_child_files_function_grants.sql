-- Child Files: helper functions must not be callable through the public API.
-- Postgres grants EXECUTE to everyone on a new function; the Supabase advisor flagged these six as
-- callable by anon and authenticated (via /rest/v1/rpc/...). They are trigger or internal helpers: the
-- triggers keep firing (a trigger's function is not re-checked against the caller's EXECUTE privilege).
REVOKE ALL ON FUNCTION public.guard_child_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.child_limit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_child_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_child_requirement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_child_file_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_child_change() FROM PUBLIC, anon, authenticated;

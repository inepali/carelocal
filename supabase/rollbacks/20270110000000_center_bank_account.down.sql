-- Rollback for 20270110000000_center_bank_account.sql: the center bank account, its history and event log go.
-- This deletes the stored (encrypted) account numbers. Export them first if they are needed.
DROP FUNCTION IF EXISTS public.center_bank_reveal(uuid);
DROP FUNCTION IF EXISTS public.center_bank_remove(uuid, text);
DROP FUNCTION IF EXISTS public.center_bank_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.center_bank_get(uuid);
DROP FUNCTION IF EXISTS public.center_bank_who(uuid);
DROP FUNCTION IF EXISTS public.center_bank_is_owner(uuid);
DROP TABLE IF EXISTS public.center_bank_account_events;
DROP TABLE IF EXISTS public.center_bank_accounts;

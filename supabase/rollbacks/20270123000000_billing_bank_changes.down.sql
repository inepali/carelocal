-- Rollback for 20270123000000_billing_bank_changes.sql: bank change requests go (open ones are lost; payer lines
-- already switched by an approval stay as they are).
DROP FUNCTION IF EXISTS public.billing_bank_changes_open(uuid);
DROP FUNCTION IF EXISTS public.billing_bank_change_center_staff(uuid);
DROP FUNCTION IF EXISTS public.billing_bank_change_form(uuid);
DROP FUNCTION IF EXISTS public.billing_bank_change_decline(uuid, text);
DROP FUNCTION IF EXISTS public.billing_bank_change_approve(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.billing_bank_changes_list(uuid);
DROP FUNCTION IF EXISTS public.parent_bank_changes(text);
DROP FUNCTION IF EXISTS public.parent_bank_change_cancel(text, uuid);
DROP FUNCTION IF EXISTS public.parent_bank_change_create(text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.billing_bank_change_log(public.billing_bank_changes, text);
DROP FUNCTION IF EXISTS public.billing_bank_change_children(uuid[]);
DROP TABLE IF EXISTS public.billing_bank_changes;

-- Rollback for 20270122000000_parent_billing.sql: the parent Billing tab, bill emails and the owner's switch go.
-- The record of bill emails already sent (billing_notices) is deleted.
DROP TRIGGER IF EXISTS trg_billing_notices_fill ON public.billing_runs;
DROP FUNCTION IF EXISTS public.billing_notice_result(uuid, boolean, text, text);
DROP FUNCTION IF EXISTS public.billing_notice_claim(uuid, integer);
DROP FUNCTION IF EXISTS public.billing_notice_payload(uuid);
DROP FUNCTION IF EXISTS public.billing_notices_fill();
DROP TABLE IF EXISTS public.billing_notices;
DROP FUNCTION IF EXISTS public.parent_billing_bill(text, uuid);
DROP FUNCTION IF EXISTS public.parent_billing_bills(text, date);
DROP FUNCTION IF EXISTS public.parent_billing_summary(text);
DROP FUNCTION IF EXISTS public.parent_billing_charge_json(public.billing_charges);
DROP FUNCTION IF EXISTS public.parent_billing_child_name(uuid);
DROP FUNCTION IF EXISTS public.parent_billing_guardians(text);
DROP FUNCTION IF EXISTS public.center_parent_billing_set(uuid, boolean);
DROP FUNCTION IF EXISTS public.center_parent_billing_get(uuid);
ALTER TABLE public.centers DROP COLUMN IF EXISTS parent_billing_enabled;

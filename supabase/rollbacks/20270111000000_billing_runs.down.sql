-- Rollback for 20270111000000_billing_runs.sql: removes Run Billing (runs, bills, charges, payments, ACH batches).
-- WARNING: deletes every billing run, bill, charge and recorded payment. Export what you need first.
DROP FUNCTION IF EXISTS public.billing_child_history(uuid, integer);
DROP FUNCTION IF EXISTS public.billing_run_get(uuid);
DROP FUNCTION IF EXISTS public.billing_runs_list(uuid, integer);
DROP FUNCTION IF EXISTS public.billing_run_summary(public.billing_runs);
DROP FUNCTION IF EXISTS public.billing_charge_json(public.billing_charges);
DROP FUNCTION IF EXISTS public.billing_run_void(uuid, text);
DROP FUNCTION IF EXISTS public.billing_charge_ach_return(uuid, text, text);
DROP FUNCTION IF EXISTS public.billing_ach_batch_mark(uuid, text);
DROP FUNCTION IF EXISTS public.billing_ach_export(uuid);
DROP FUNCTION IF EXISTS public.billing_payment_void(uuid, text);
DROP FUNCTION IF EXISTS public.billing_payment_record(uuid, jsonb);
DROP FUNCTION IF EXISTS public.billing_run_submit(uuid, text, date, numeric, date, text);
DROP FUNCTION IF EXISTS public.billing_preview(uuid, text, date);
DROP FUNCTION IF EXISTS public.billing_compute(uuid, text, date);
DROP FUNCTION IF EXISTS public.billing_charge_refresh(uuid);
DROP FUNCTION IF EXISTS public.billing_ach_problem(public.child_payment_payers);
DROP FUNCTION IF EXISTS public.billing_log(uuid, uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.billing_window_label(text, date);
DROP FUNCTION IF EXISTS public.billing_window(text, date);
DROP TABLE IF EXISTS public.billing_payments;
DROP TABLE IF EXISTS public.billing_charges;
DROP TABLE IF EXISTS public.billing_bill_lines;
DROP TABLE IF EXISTS public.billing_bills;
DROP TABLE IF EXISTS public.billing_ach_batches;
DROP TABLE IF EXISTS public.billing_runs;

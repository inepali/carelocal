-- Rollback for 20270109000000_tuition_fees.sql: rate card, children's fees, payers, the functions and the switch go.
-- This deletes every rate, fee assignment and payer line. Export them first if they are needed.
-- Activity log rows written by tuition stay (the audit trail is never edited).
DROP TRIGGER IF EXISTS trg_tuition_on_withdraw ON public.children;
DROP FUNCTION IF EXISTS public.tuition_on_withdraw();

DROP FUNCTION IF EXISTS public.tuition_fee_options(uuid, uuid);
DROP FUNCTION IF EXISTS public.child_tuition_get(uuid);
DROP FUNCTION IF EXISTS public.child_payment_plan_copy(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.tuition_siblings(uuid);
DROP FUNCTION IF EXISTS public.child_payment_plan_save(uuid, date, jsonb, text);
DROP FUNCTION IF EXISTS public.child_tuition_end(uuid, date, text);
DROP FUNCTION IF EXISTS public.child_tuition_change(uuid, date, jsonb, text);
DROP FUNCTION IF EXISTS public.child_tuition_add(uuid, jsonb);
DROP FUNCTION IF EXISTS public.tuition_check_discount(jsonb);
DROP FUNCTION IF EXISTS public.tuition_discount_label(text, numeric, text, numeric);
DROP FUNCTION IF EXISTS public.tuition_fee_label(uuid);
DROP FUNCTION IF EXISTS public.tuition_rate_delete(uuid, text);
DROP FUNCTION IF EXISTS public.tuition_rate_set(uuid, numeric, date, text);
DROP FUNCTION IF EXISTS public.tuition_fee_delete(uuid);
DROP FUNCTION IF EXISTS public.tuition_fee_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.tuition_fees_list(uuid);
DROP FUNCTION IF EXISTS public.child_payment_split(uuid, date);
DROP FUNCTION IF EXISTS public.child_tuition_on(uuid, date);
DROP FUNCTION IF EXISTS public.tuition_split(uuid, date);
DROP FUNCTION IF EXISTS public.tuition_lines(uuid, date);
DROP FUNCTION IF EXISTS public.tuition_rate_on(uuid, date);

DROP TABLE IF EXISTS public.child_payment_payers;
DROP TABLE IF EXISTS public.child_tuition;
DROP TABLE IF EXISTS public.tuition_fee_rates;
DROP TABLE IF EXISTS public.tuition_fees;

DROP FUNCTION IF EXISTS public.tuition_period(text, date, date);
DROP FUNCTION IF EXISTS public.tuition_money(numeric);
DROP FUNCTION IF EXISTS public.tuition_log(uuid, uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.tuition_require_past_ok(uuid, date, text);
DROP FUNCTION IF EXISTS public.tuition_require(uuid);
DROP FUNCTION IF EXISTS public.tuition_is_owner(uuid);
DROP FUNCTION IF EXISTS public.tuition_can_manage(uuid);

DROP TRIGGER IF EXISTS trg_guard_tuition_flag ON public.centers;
DROP FUNCTION IF EXISTS public.guard_tuition_flag();
ALTER TABLE public.centers DROP COLUMN IF EXISTS tuition_enabled;
-- btree_gist stays: other objects may use it, and it is harmless.

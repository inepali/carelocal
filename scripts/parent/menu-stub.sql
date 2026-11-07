-- Stand-ins for the menu planning tables the parent menu reads (see menu.test.sql)
ALTER TABLE public.centers ADD COLUMN menu_planning_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.centers ADD COLUMN menu_slots text[] NOT NULL DEFAULT ARRAY['breakfast', 'lunch', 'pm_snack'];
CREATE TABLE public.menu_months (center_id uuid, month date, status text, PRIMARY KEY (center_id, month));
CREATE TABLE public.menu_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid, service_date date, slot text,
  preset_name text NOT NULL DEFAULT '', items jsonb NOT NULL DEFAULT '[]', note text);
CREATE TABLE public.menu_closed_days (center_id uuid, service_date date, reason text, PRIMARY KEY (center_id, service_date));
GRANT SELECT ON public.menu_months, public.menu_entries, public.menu_closed_days TO service_role;

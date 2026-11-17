-- Minimal center_lookups for the allergies test (the real table lives in the app's earlier migrations)
CREATE TABLE IF NOT EXISTS public.center_lookups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), center_id uuid, group_name text NOT NULL,
  label text NOT NULL, value text NOT NULL, is_active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0, domain_key text);

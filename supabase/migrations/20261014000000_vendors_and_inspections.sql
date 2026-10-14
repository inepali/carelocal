-- Vendors + Inspections modules
-- Vendors: service providers a center works with (fire safety, pest control, HVAC, etc.)
-- Inspections: recurring inspections a center must stay current on, with interval,
--              last performed date, next due date, and an optional vendor.
-- Inspection logs: history of every time an inspection was performed.

-- ─────────────────────────────────────────────
-- 1. Vendors
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.center_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  service_type TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  address TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_center_vendors_center ON public.center_vendors(center_id);

-- ─────────────────────────────────────────────
-- 2. Inspections (one row per recurring inspection requirement)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.center_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  inspection_type TEXT NOT NULL,
  title TEXT,
  interval_value INTEGER CHECK (interval_value IS NULL OR interval_value > 0),
  interval_unit TEXT CHECK (interval_unit IS NULL OR interval_unit IN ('days', 'weeks', 'months', 'years')),
  last_inspection_date DATE,
  next_due_date DATE,
  last_result TEXT CHECK (last_result IS NULL OR last_result IN ('passed', 'passed_with_conditions', 'failed')),
  vendor_id UUID REFERENCES public.center_vendors(id) ON DELETE SET NULL,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT interval_both_or_neither CHECK ((interval_value IS NULL) = (interval_unit IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_center_inspections_center ON public.center_inspections(center_id);
CREATE INDEX IF NOT EXISTS idx_center_inspections_due ON public.center_inspections(center_id, next_due_date) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_center_inspections_vendor ON public.center_inspections(vendor_id);

-- ─────────────────────────────────────────────
-- 3. Inspection logs (history of performed inspections)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.center_inspection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES public.center_inspections(id) ON DELETE CASCADE,
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  performed_on DATE NOT NULL,
  result TEXT CHECK (result IS NULL OR result IN ('passed', 'passed_with_conditions', 'failed')),
  vendor_id UUID REFERENCES public.center_vendors(id) ON DELETE SET NULL,
  inspector_name TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_center_inspection_logs_inspection ON public.center_inspection_logs(inspection_id, performed_on DESC);

-- ─────────────────────────────────────────────
-- 4. Integrity: vendor and log must belong to the same center
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_inspection_center_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.vendor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.center_vendors v WHERE v.id = NEW.vendor_id AND v.center_id = NEW.center_id
  ) THEN
    RAISE EXCEPTION 'Vendor does not belong to this center';
  END IF;

  IF TG_TABLE_NAME = 'center_inspection_logs' AND NOT EXISTS (
    SELECT 1 FROM public.center_inspections i WHERE i.id = NEW.inspection_id AND i.center_id = NEW.center_id
  ) THEN
    RAISE EXCEPTION 'Inspection does not belong to this center';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_center_inspections_consistency ON public.center_inspections;
CREATE TRIGGER trg_center_inspections_consistency
  BEFORE INSERT OR UPDATE ON public.center_inspections
  FOR EACH ROW EXECUTE FUNCTION public.check_inspection_center_consistency();

DROP TRIGGER IF EXISTS trg_center_inspection_logs_consistency ON public.center_inspection_logs;
CREATE TRIGGER trg_center_inspection_logs_consistency
  BEFORE INSERT OR UPDATE ON public.center_inspection_logs
  FOR EACH ROW EXECUTE FUNCTION public.check_inspection_center_consistency();

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_center_vendors_updated_at ON public.center_vendors;
CREATE TRIGGER trg_center_vendors_updated_at
  BEFORE UPDATE ON public.center_vendors
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_center_inspections_updated_at ON public.center_inspections;
CREATE TRIGGER trg_center_inspections_updated_at
  BEFORE UPDATE ON public.center_inspections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─────────────────────────────────────────────
-- 5. RLS: center admins manage their own center's rows; super admins see all
-- ─────────────────────────────────────────────
ALTER TABLE public.center_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.center_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.center_inspection_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Center admins manage vendors" ON public.center_vendors;
CREATE POLICY "Center admins manage vendors"
  ON public.center_vendors FOR ALL
  USING (center_id IN (SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()))
  WITH CHECK (center_id IN (SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Center admins manage inspections" ON public.center_inspections;
CREATE POLICY "Center admins manage inspections"
  ON public.center_inspections FOR ALL
  USING (center_id IN (SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()))
  WITH CHECK (center_id IN (SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Center admins manage inspection logs" ON public.center_inspection_logs;
CREATE POLICY "Center admins manage inspection logs"
  ON public.center_inspection_logs FOR ALL
  USING (center_id IN (SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()))
  WITH CHECK (center_id IN (SELECT center_id FROM public.center_admins WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Super admins read vendors" ON public.center_vendors;
CREATE POLICY "Super admins read vendors"
  ON public.center_vendors FOR SELECT
  USING (((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true));

DROP POLICY IF EXISTS "Super admins read inspections" ON public.center_inspections;
CREATE POLICY "Super admins read inspections"
  ON public.center_inspections FOR SELECT
  USING (((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true));

DROP POLICY IF EXISTS "Super admins read inspection logs" ON public.center_inspection_logs;
CREATE POLICY "Super admins read inspection logs"
  ON public.center_inspection_logs FOR SELECT
  USING (((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true));

-- ─────────────────────────────────────────────
-- 6. Default inspection types (platform-level lookups, editable per center in Manage Data)
-- ─────────────────────────────────────────────
INSERT INTO public.center_lookups (center_id, group_name, label, value, is_active, sort_order, domain_key)
SELECT NULL, 'Inspection Type', t.label, t.value, true, t.sort_order, t.domain_key
FROM (VALUES
  ('Fire Marshal Inspection', 'fire_marshal', 1, 'childcare'),
  ('Fire Extinguisher Service', 'fire_extinguisher', 2, 'childcare'),
  ('Fire Alarm / Sprinkler Test', 'fire_alarm_sprinkler', 3, 'childcare'),
  ('Health / Sanitation Inspection', 'health_sanitation', 4, 'childcare'),
  ('State Licensing Visit', 'state_licensing', 5, 'childcare'),
  ('Playground Safety Inspection', 'playground_safety', 6, 'childcare'),
  ('Pest Control', 'pest_control', 7, 'childcare'),
  ('HVAC Service', 'hvac', 8, 'childcare'),
  ('Water Quality / Lead Testing', 'water_quality', 9, 'childcare'),
  ('Kitchen Hood Cleaning', 'kitchen_hood', 10, 'childcare'),
  ('Fire Marshal Inspection', 'fire_marshal', 1, 'healthcare'),
  ('Fire Extinguisher Service', 'fire_extinguisher', 2, 'healthcare'),
  ('Fire Alarm / Sprinkler Test', 'fire_alarm_sprinkler', 3, 'healthcare'),
  ('State Survey / Licensing Inspection', 'state_survey', 4, 'healthcare'),
  ('Health Department Inspection', 'health_department', 5, 'healthcare'),
  ('Medical Equipment Calibration', 'equipment_calibration', 6, 'healthcare'),
  ('Generator Load Test', 'generator', 7, 'healthcare'),
  ('Pest Control', 'pest_control', 8, 'healthcare'),
  ('HVAC Service', 'hvac', 9, 'healthcare'),
  ('Elevator Inspection', 'elevator', 10, 'healthcare')
) AS t(label, value, sort_order, domain_key)
WHERE NOT EXISTS (
  SELECT 1 FROM public.center_lookups cl
  WHERE cl.center_id IS NULL AND cl.group_name = 'Inspection Type'
    AND cl.value = t.value AND cl.domain_key = t.domain_key
);

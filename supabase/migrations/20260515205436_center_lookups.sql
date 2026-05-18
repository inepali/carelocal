CREATE TABLE IF NOT EXISTS center_lookups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  center_id uuid REFERENCES centers(id) ON DELETE CASCADE,
  group_name varchar NOT NULL, -- e.g., 'Role', 'Document Type'
  label varchar NOT NULL,
  value varchar,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE center_lookups ENABLE ROW LEVEL SECURITY;

-- Admins can manage their own center's lookups
CREATE POLICY "Admins can manage center lookups"
  ON center_lookups
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM center_admins
      WHERE center_admins.user_id = auth.uid()
      AND center_admins.center_id = center_lookups.center_id
    )
  );

-- Staff can view lookups
CREATE POLICY "Staff can view center lookups"
  ON center_lookups
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff_profiles
      WHERE staff_profiles.id = auth.uid()
    )
  );

-- Insert initial required lookups for existing centers (optional script you can run)
-- For example: 'Role' -> 'Teacher', 'Role' -> 'Floater', 'Role' -> 'Aide'

-- ============================================================
-- Migration: Database-driven staff role types
-- Replaces hardcoded StaffType enum in application code.
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_role_types (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   uuid        REFERENCES centers(id) ON DELETE CASCADE,
  -- NULL center_id = platform default (visible to all centers)
  value       text        NOT NULL,
  label       text        NOT NULL,
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE NULLS NOT DISTINCT (center_id, value),
  UNIQUE NULLS NOT DISTINCT (center_id, label)
);

-- ─── Platform defaults (seeded once, never code-deployed again) ───
INSERT INTO staff_role_types (center_id, value, label, sort_order) VALUES
  (NULL, 'teacher',   'Teacher',       1),
  (NULL, 'floater',   'Floater',       2),
  (NULL, 'support',   'Support Staff', 3),
  (NULL, 'cook',      'Cook',          4)
ON CONFLICT DO NOTHING;

-- ─── Row Level Security ───────────────────────────────────────────
ALTER TABLE staff_role_types ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read platform defaults (center_id IS NULL)
CREATE POLICY "read_platform_defaults"
  ON staff_role_types FOR SELECT
  USING (center_id IS NULL);

-- Center admins can read their own center's custom roles
CREATE POLICY "read_own_center_roles"
  ON staff_role_types FOR SELECT
  USING (
    center_id IN (
      SELECT center_id FROM center_admins WHERE user_id = auth.uid()
    )
  );

-- Center admins can insert custom roles for their own center
CREATE POLICY "insert_own_center_roles"
  ON staff_role_types FOR INSERT
  WITH CHECK (
    center_id IS NOT NULL AND
    center_id IN (
      SELECT center_id FROM center_admins WHERE user_id = auth.uid()
    )
  );

-- Center admins can update their own center's custom roles (not platform defaults)
CREATE POLICY "update_own_center_roles"
  ON staff_role_types FOR UPDATE
  USING (
    center_id IS NOT NULL AND
    center_id IN (
      SELECT center_id FROM center_admins WHERE user_id = auth.uid()
    )
  );

-- Center admins can delete their own center's custom roles
CREATE POLICY "delete_own_center_roles"
  ON staff_role_types FOR DELETE
  USING (
    center_id IS NOT NULL AND
    center_id IN (
      SELECT center_id FROM center_admins WHERE user_id = auth.uid()
    )
  );

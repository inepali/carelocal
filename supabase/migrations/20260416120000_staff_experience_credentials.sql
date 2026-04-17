-- =============================================================
-- Staff Profile Enhancement: Experience & Credentials
-- =============================================================

-- ── staff_experiences ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_experiences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  employer    text NOT NULL,
  role        text NOT NULL,
  age_group   text,             -- 'infant' | 'toddler' | 'preschool' | 'school_age' | 'mixed'
  start_month int,
  start_year  int,
  end_month   int,
  end_year    int,
  is_current  boolean NOT NULL DEFAULT false,
  description text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE staff_experiences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff own their experiences"
  ON staff_experiences FOR ALL TO authenticated
  USING (staff_id IN (
    SELECT id FROM staff_profiles WHERE user_id = auth.uid()
  ))
  WITH CHECK (staff_id IN (
    SELECT id FROM staff_profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Super admins can manage all staff experiences"
  ON staff_experiences FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true);


-- ── staff_credentials ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_credentials (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id            uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  credential_name     text NOT NULL,
  issuing_body        text,
  credential_number   text,
  issue_date          date,
  expiry_date         date,
  linked_document_id  uuid REFERENCES staff_documents(id) ON DELETE SET NULL,
  sort_order          int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE staff_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff own their credentials"
  ON staff_credentials FOR ALL TO authenticated
  USING (staff_id IN (
    SELECT id FROM staff_profiles WHERE user_id = auth.uid()
  ))
  WITH CHECK (staff_id IN (
    SELECT id FROM staff_profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Super admins can manage all staff credentials"
  ON staff_credentials FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean = true);


-- ── staff_profiles: availability columns ─────────────────────
ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS available_days      text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS available_from      time,
  ADD COLUMN IF NOT EXISTS available_to        time,
  ADD COLUMN IF NOT EXISTS availability_notes  text;

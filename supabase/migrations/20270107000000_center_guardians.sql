-- Parents and guardians list: one center-level record per person, picked when adding a contact to a child.
--
--  * center_guardians: the center's list of parents, guardians and other contacts. Owners and admins of the center
--    manage it, with Child Files switched on (same gate as every child table: can_use_child_files). No staff,
--    super-admin or parent policy, on purpose.
--  * child_guardians.center_guardian_id: which list entry a child's contact row came from. While linked, the
--    contact's name, phone and email always come from the list entry (copied by trigger on link, and pushed to
--    every linked row when the entry changes), so a phone number is fixed once for all siblings. Relationship,
--    pick-up authorization and the other flags stay per child: being Maya's authorized pick-up says nothing about Leo.
--  * Archiving hides an entry from the picker and keeps existing links. Deleting an entry unlinks its rows and
--    keeps them (the contact rows are the child's record, not the list's).
--  * Existing contacts with an email or phone are copied into the list once and linked (same center, name, email
--    and phone count as one person). Contacts with neither stay unlinked; a center can link them later.
-- Tested by scripts/guardians/center-guardians.test.sql (throwaway local Postgres only).

-- 1. The list ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.center_guardians (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id    uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  relationship text CHECK (relationship IS NULL OR char_length(relationship) <= 60),   -- default when picked, e.g. Mother
  phone        text CHECK (phone IS NULL OR char_length(phone) <= 30),
  email        text CHECK (email IS NULL OR char_length(email) <= 254),
  notes        text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  archived_at  timestamptz,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, center_id)
);
CREATE INDEX IF NOT EXISTS idx_center_guardians_center_name ON public.center_guardians (center_id, lower(name));

-- 2. The link from a child's contact row ----------------------------------------------------------------------------
ALTER TABLE public.child_guardians ADD COLUMN IF NOT EXISTS center_guardian_id uuid;
ALTER TABLE public.child_guardians DROP CONSTRAINT IF EXISTS child_guardians_center_guardian_fk;
ALTER TABLE public.child_guardians ADD CONSTRAINT child_guardians_center_guardian_fk
  FOREIGN KEY (center_guardian_id, center_id) REFERENCES public.center_guardians (id, center_id)
  ON DELETE SET NULL (center_guardian_id);            -- composite key: a contact can only link to its own center's list
CREATE UNIQUE INDEX IF NOT EXISTS child_guardians_child_center_guardian_uq
  ON public.child_guardians (child_id, center_guardian_id) WHERE center_guardian_id IS NOT NULL;   -- once per child

-- 3. Rules enforced in the database ----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_center_guardian()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.center_id <> OLD.center_id THEN
    RAISE EXCEPTION 'A parent or guardian cannot move to another center' USING ERRCODE = 'check_violation';
  END IF;
  NEW.name := btrim(NEW.name);
  NEW.relationship := NULLIF(btrim(NEW.relationship), '');
  NEW.phone := NULLIF(btrim(NEW.phone), '');
  NEW.email := NULLIF(btrim(NEW.email), '');
  NEW.notes := NULLIF(btrim(NEW.notes), '');
  IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_center_guardian() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_center_guardian ON public.center_guardians;
CREATE TRIGGER trg_guard_center_guardian BEFORE INSERT OR UPDATE ON public.center_guardians
  FOR EACH ROW EXECUTE FUNCTION public.guard_center_guardian();

-- Linking a contact copies the entry's details; while linked, they cannot drift from the list.
CREATE OR REPLACE FUNCTION public.fill_guardian_from_list()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g center_guardians%ROWTYPE;
BEGIN
  IF NEW.center_guardian_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO g FROM center_guardians WHERE id = NEW.center_guardian_id AND center_id = NEW.center_id;
  IF NOT FOUND THEN RETURN NEW; END IF;     -- the foreign key reports it
  NEW.name := g.name;
  NEW.phone := g.phone;
  NEW.email := g.email;
  IF TG_OP = 'INSERT' AND NULLIF(btrim(NEW.relationship), '') IS NULL THEN NEW.relationship := g.relationship; END IF;
  -- the daily report needs an email
  IF NEW.email IS NULL THEN NEW.daily_report := false; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fill_guardian_from_list() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fill_guardian_from_list ON public.child_guardians;
CREATE TRIGGER trg_fill_guardian_from_list BEFORE INSERT OR UPDATE ON public.child_guardians
  FOR EACH ROW EXECUTE FUNCTION public.fill_guardian_from_list();

-- A changed entry updates every linked contact (each change lands in that child's audit trail as usual).
CREATE OR REPLACE FUNCTION public.push_center_guardian_details()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE child_guardians cg
     SET name = NEW.name, phone = NEW.phone, email = NEW.email,
         daily_report = cg.daily_report AND NEW.email IS NOT NULL
   WHERE cg.center_guardian_id = NEW.id AND cg.center_id = NEW.center_id
     AND (cg.name, cg.phone, cg.email) IS DISTINCT FROM (NEW.name, NEW.phone, NEW.email);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.push_center_guardian_details() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_center_guardian_details ON public.center_guardians;
CREATE TRIGGER trg_push_center_guardian_details AFTER UPDATE OF name, phone, email ON public.center_guardians
  FOR EACH ROW WHEN ((OLD.name, OLD.phone, OLD.email) IS DISTINCT FROM (NEW.name, NEW.phone, NEW.email))
  EXECUTE FUNCTION public.push_center_guardian_details();

-- 4. Row-level security: owner and admin of the center, with Child Files on -----------------------------------------
ALTER TABLE public.center_guardians ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners and admins read center_guardians" ON public.center_guardians;
CREATE POLICY "Owners and admins read center_guardians" ON public.center_guardians
  FOR SELECT TO authenticated USING (public.can_use_child_files(center_id));
DROP POLICY IF EXISTS "Owners and admins add center_guardians" ON public.center_guardians;
CREATE POLICY "Owners and admins add center_guardians" ON public.center_guardians
  FOR INSERT TO authenticated WITH CHECK (public.can_use_child_files(center_id));
DROP POLICY IF EXISTS "Owners and admins change center_guardians" ON public.center_guardians;
CREATE POLICY "Owners and admins change center_guardians" ON public.center_guardians
  FOR UPDATE TO authenticated USING (public.can_use_child_files(center_id)) WITH CHECK (public.can_use_child_files(center_id));
DROP POLICY IF EXISTS "Owners and admins delete center_guardians" ON public.center_guardians;
CREATE POLICY "Owners and admins delete center_guardians" ON public.center_guardians
  FOR DELETE TO authenticated USING (public.can_use_child_files(center_id));

REVOKE ALL ON public.center_guardians FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.center_guardians TO authenticated;
GRANT ALL ON public.center_guardians TO service_role;

-- 5. One-time copy of existing contacts into the list --------------------------------------------------------------
-- Grouped per center by name, email and phone digits, so only rows that already agree (up to case and spacing)
-- share an entry and no contact's details change. The audit and fill triggers are paused for this step only: the
-- link adds no line to every child's history, and no visible detail is rewritten.
ALTER TABLE public.child_guardians DISABLE TRIGGER trg_audit_child_guardians;
ALTER TABLE public.child_guardians DISABLE TRIGGER trg_fill_guardian_from_list;

CREATE TEMP TABLE _guardian_groups AS
SELECT cg.id AS contact_id, cg.center_id, cg.child_id,
       lower(btrim(cg.name)) || '|' || COALESCE(lower(NULLIF(btrim(cg.email), '')), '')
         || '|' || regexp_replace(COALESCE(cg.phone, ''), '\D', '', 'g') AS key,
       cg.name, cg.relationship, NULLIF(btrim(cg.phone), '') AS phone, NULLIF(btrim(cg.email), '') AS email, cg.created_at
  FROM public.child_guardians cg
 WHERE cg.center_guardian_id IS NULL
   AND (NULLIF(btrim(cg.email), '') IS NOT NULL OR NULLIF(regexp_replace(COALESCE(cg.phone, ''), '\D', '', 'g'), '') IS NOT NULL);

CREATE TEMP TABLE _guardian_new AS
SELECT DISTINCT ON (center_id, key) gen_random_uuid() AS id, center_id, key, btrim(name) AS name, relationship, phone, email
  FROM _guardian_groups
 ORDER BY center_id, key, created_at DESC;

INSERT INTO public.center_guardians (id, center_id, name, relationship, phone, email)
SELECT id, center_id, name, relationship, phone, email FROM _guardian_new;

-- One link per child and entry (the same person listed twice on one child keeps the first row linked)
UPDATE public.child_guardians cg SET center_guardian_id = l.entry_id
  FROM (SELECT DISTINCT ON (g.child_id, n.id) g.contact_id, n.id AS entry_id
          FROM _guardian_groups g JOIN _guardian_new n ON n.center_id = g.center_id AND n.key = g.key
         ORDER BY g.child_id, n.id, g.created_at) l
 WHERE cg.id = l.contact_id;

ALTER TABLE public.child_guardians ENABLE TRIGGER trg_fill_guardian_from_list;
ALTER TABLE public.child_guardians ENABLE TRIGGER trg_audit_child_guardians;
DROP TABLE _guardian_new;
DROP TABLE _guardian_groups;

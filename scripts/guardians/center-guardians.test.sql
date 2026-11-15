-- Database tests for the parents and guardians list (20270107000000_center_guardians.sql), run on a throwaway local Postgres:
--   createdb cg && psql -d cg -f scripts/guardians/stub.sql \
--     -f supabase/migrations/20270107000000_center_guardians.sql -f scripts/guardians/center-guardians.test.sql
-- It prints ALL PASSED or stops at the first failed check. Never run it against a Supabase project.
\set ON_ERROR_STOP on

CREATE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', u, false) $$;

-- 1. One-time copy: siblings' Mom is one entry, grandpa one, neighbor none, center B separate; contacts unchanged; no audit lines
DO $$ DECLARE mom uuid; BEGIN
  ASSERT (SELECT count(*) FROM center_guardians WHERE center_id = '10000000-0000-0000-0000-000000000001') = 2, 'center A entries';
  ASSERT (SELECT count(*) FROM center_guardians WHERE center_id = '10000000-0000-0000-0000-000000000002') = 1, 'center B entries';
  SELECT center_guardian_id INTO mom FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000001';
  ASSERT mom IS NOT NULL, 'mom linked';
  ASSERT (SELECT center_guardian_id FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000002') = mom, 'sibling mom same entry';
  ASSERT (SELECT center_guardian_id FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000003') IS NOT NULL, 'grandpa linked';
  ASSERT (SELECT center_guardian_id FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000004') IS NULL, 'neighbor unlinked';
  ASSERT (SELECT center_guardian_id FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000009') <> mom, 'center B separate';
  ASSERT (SELECT name FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000002') = 'ana ruiz ', 'copy rewrote a contact';
  ASSERT (SELECT count(*) FROM child_audit_log) = 0, 'copy wrote audit lines';
END $$;
TRUNCATE child_audit_log;
SELECT set_config('t.b_entry', (SELECT id::text FROM center_guardians WHERE center_id = '10000000-0000-0000-0000-000000000002'), false);

-- 2. Access: staff and other centers see nothing; the owner sees only their own
SET ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM center_guardians) = 0, 'staff can read the list';
  BEGIN INSERT INTO center_guardians (center_id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'X');
    RAISE EXCEPTION 'staff insert should fail'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM center_guardians) = 1, 'B owner sees only B';
  UPDATE center_guardians SET name = 'hacked' WHERE center_id = '10000000-0000-0000-0000-000000000001';
  BEGIN INSERT INTO center_guardians (center_id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'X');
    RAISE EXCEPTION 'cross-center insert should fail'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO center_guardians (center_id, name) VALUES ('10000000-0000-0000-0000-000000000003', 'X');
    RAISE EXCEPTION 'insert with Child Files off should fail'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM center_guardians WHERE name = 'hacked'), 'cross-center update went through';
  ASSERT (SELECT count(*) FROM center_guardians) = 2, 'A owner sees A only';
END $$;

-- 3. Owner adds an entry (trimmed, created_by set) and picks it for a child: details copied, relationship defaulted
DO $$ DECLARE e uuid; c child_guardians%ROWTYPE; BEGIN
  INSERT INTO center_guardians (center_id, name, relationship, phone, email)
  VALUES ('10000000-0000-0000-0000-000000000001', '  Dan Ruiz ', 'Father', ' 704-555-0102 ', '') RETURNING id INTO e;
  ASSERT (SELECT name = 'Dan Ruiz' AND email IS NULL AND created_by = auth.uid() FROM center_guardians WHERE id = e), 'entry not cleaned';
  INSERT INTO child_guardians (center_id, child_id, center_guardian_id, name, daily_report)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', e, 'whatever the form sent', true)
  RETURNING * INTO c;
  ASSERT c.name = 'Dan Ruiz' AND c.phone = '704-555-0102' AND c.relationship = 'Father', 'details not copied: ' || row_to_json(c)::text;
  ASSERT NOT c.daily_report, 'daily report on without an email';
  ASSERT NOT c.can_pick_up, 'pick-up must stay off by default';
  -- not twice on the same child
  BEGIN INSERT INTO child_guardians (center_id, child_id, center_guardian_id, name)
        VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', e, 'x');
    RAISE EXCEPTION 'duplicate link should fail'; EXCEPTION WHEN unique_violation THEN NULL; END;
  -- linked details cannot drift
  UPDATE child_guardians SET phone = '000' WHERE id = c.id;
  ASSERT (SELECT phone FROM child_guardians WHERE id = c.id) = '704-555-0102', 'linked phone drifted';
  -- relationship stays per child
  UPDATE child_guardians SET relationship = 'Stepfather' WHERE id = c.id;
  ASSERT (SELECT relationship FROM child_guardians WHERE id = c.id) = 'Stepfather', 'relationship not per child';
END $$;

-- 4. A contact cannot link to another center's entry
DO $$ BEGIN
  INSERT INTO child_guardians (center_id, child_id, center_guardian_id, name)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
          current_setting('t.b_entry')::uuid, 'x');
  RAISE EXCEPTION 'cross-center link should fail';
EXCEPTION WHEN foreign_key_violation THEN NULL; END $$;

-- 5. Changing an entry updates every linked contact, keeps per-child flags, and is audited per child
DO $$ DECLARE mom uuid; BEGIN
  SELECT center_guardian_id INTO mom FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000001';
  UPDATE center_guardians SET phone = '980-555-0000' WHERE id = mom;
  ASSERT (SELECT count(*) FROM child_guardians WHERE center_guardian_id = mom AND phone = '980-555-0000') = 2, 'siblings not updated';
  ASSERT (SELECT can_pick_up FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000001')
     AND NOT (SELECT can_pick_up FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000002'), 'pick-up flags changed';
  ASSERT (SELECT count(*) FROM child_audit_log WHERE action = 'update' AND 'phone' = ANY (changed_fields)) = 2, 'not audited per child';
  -- removing the email turns the daily report off
  UPDATE center_guardians SET email = NULL WHERE id = mom;
  ASSERT NOT EXISTS (SELECT 1 FROM child_guardians WHERE center_guardian_id = mom AND daily_report), 'daily report kept without email';
END $$;

-- 6. Unlinking keeps the details; deleting an entry unlinks and keeps the contacts
DO $$ DECLARE gp uuid; BEGIN
  SELECT center_guardian_id INTO gp FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000003';
  DELETE FROM center_guardians WHERE id = gp;
  ASSERT (SELECT center_guardian_id IS NULL AND name = 'Joe Ruiz' AND center_id = '10000000-0000-0000-0000-000000000001'
            FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000003'), 'delete did not just unlink';
  UPDATE child_guardians SET center_guardian_id = NULL, phone = '111' WHERE id = '30000000-0000-0000-0000-000000000001';
  ASSERT (SELECT phone FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000001') = '111', 'unlinked row still locked';
  BEGIN UPDATE center_guardians SET center_id = '10000000-0000-0000-0000-000000000002' WHERE center_id = '10000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'move should fail'; EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- 7. Center B's Ana was never touched by center A's changes
DO $$ BEGIN
  ASSERT (SELECT email FROM child_guardians WHERE id = '30000000-0000-0000-0000-000000000009') = 'ana@x.com', 'other center changed';
END $$;

\echo ALL PASSED

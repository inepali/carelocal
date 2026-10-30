-- Test data for the Live Roster: 10 regular teachers (each with a home room) and 5 substitute teachers.
-- DEV ONLY. Run against the dev project:
--   npx supabase db query --linked -f scripts/roster/seed-test-staff.sql
--
-- staff_profiles.user_id is required, so each person gets a placeholder auth.users row with no password: they
-- cannot sign in. All seeded emails end in @seed.carelocal.test, which is how they are found and removed again.
-- Safe to re-run: anyone already seeded (same email) is skipped.
--
-- Regular teachers start the day "home" (not arrived); check them in on the board. Substitutes only show on the
-- board once they are placed (by checking in to a confirmed shift, or moved there by an admin).

DO $$
DECLARE
  v_center  uuid;
  v_user    uuid;
  v_staff   uuid;
  v_room    uuid;
  v_p       record;
BEGIN
  SELECT id INTO v_center FROM centers WHERE name = 'Kiddie Academy of Harrisburg' LIMIT 1;
  IF v_center IS NULL THEN RAISE EXCEPTION 'Center not found'; END IF;

  FOR v_p IN
    SELECT * FROM (VALUES
      -- email key,    first,      last,        class,        home room,     staff type
      ('teacher01', 'Hannah',    'Brooks',    'regular',    'Infant A',    'teacher'),
      ('teacher02', 'Marcus',    'Reed',      'regular',    'Infant A',    'teacher'),
      ('teacher03', 'Priya',     'Nair',      'regular',    'Infant B',    'teacher'),
      ('teacher04', 'Olivia',    'Grant',     'regular',    'Toddlers A',  'teacher'),
      ('teacher05', 'Daniel',    'Cruz',      'regular',    'Toddlers B',  'teacher'),
      ('teacher06', 'Aisha',     'Rahman',    'regular',    'Twos A',      'teacher'),
      ('teacher07', 'Ben',       'Foster',    'regular',    'Twos B',      'teacher'),
      ('teacher08', 'Camila',    'Ortiz',     'regular',    'Three A',     'teacher'),
      ('teacher09', 'Tyler',     'Bennett',   'regular',    'Three B',     'teacher'),
      ('teacher10', 'Grace',     'Whitfield', 'regular',    'Fours',       'teacher'),
      ('sub01',     'Nina',      'Alvarez',   'substitute', NULL,          'floater'),
      ('sub02',     'Omar',      'Haddad',    'substitute', NULL,          'floater'),
      ('sub03',     'Jenna',     'Park',      'substitute', NULL,          'teacher'),
      ('sub04',     'Victor',    'Lindqvist', 'substitute', NULL,          'teacher'),
      ('sub05',     'Tessa',     'Morgan',    'substitute', NULL,          'floater')
    ) AS t(key, first_name, last_name, class, room, staff_type)
  LOOP
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_p.key || '@seed.carelocal.test') THEN CONTINUE; END IF;

    v_room := NULL;
    IF v_p.room IS NOT NULL THEN
      SELECT id INTO v_room FROM work_areas WHERE center_id = v_center AND name = v_p.room AND is_active LIMIT 1;
      IF v_room IS NULL THEN RAISE EXCEPTION 'Room % not found', v_p.room; END IF;
    END IF;

    v_user := gen_random_uuid();
    INSERT INTO auth.users (instance_id, id, aud, role, email, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    VALUES ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
            v_p.key || '@seed.carelocal.test', now(),
            '{"provider":"email","providers":["email"]}', '{"seed":true}', now(), now(), '', '', '', '');

    INSERT INTO staff_profiles (user_id, first_name, last_name, email, phone, city, state, staff_type, domain_key)
    VALUES (v_user, v_p.first_name, v_p.last_name, v_p.key || '@seed.carelocal.test',
            '+1717555' || lpad((floor(random() * 10000))::text, 4, '0'), 'Harrisburg', 'NC', v_p.staff_type, 'childcare')
    RETURNING id INTO v_staff;

    INSERT INTO center_staff (center_id, staff_id, status, employment_class, employment_start_date, home_work_area_id)
    VALUES (v_center, v_staff, 'active', v_p.class, current_date - 90, v_room);
  END LOOP;
END $$;

-- Cleanup (run on its own when you are done; removes the profiles and center links with them):
-- DELETE FROM auth.users WHERE email LIKE '%@seed.carelocal.test';

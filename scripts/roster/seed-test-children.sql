-- Test data for the Live Roster: 60 enrolled children placed in the rooms whose age range fits them.
-- DEV ONLY. Run against the dev project:
--   npx supabase db query --linked -f scripts/roster/seed-test-children.sql
--
-- Every seeded child has " (Test)" at the end of the last name, so they are easy to spot in Child Files and
-- easy to remove again (see the cleanup at the bottom). Everyone starts "home" (not arrived): check them in
-- on the board to try ratios. Re-running adds another 60, so clean up first if you want a fresh set.

DO $$
DECLARE
  v_center  uuid;
  v_room    record;
  v_i       integer;
  v_age     integer;
  v_dob     date;
  v_firsts  text[] := ARRAY['Liam','Noah','Oliver','Elijah','James','Lucas','Mason','Ethan','Henry','Jack','Owen','Leo','Asher','Eli',
                            'Olivia','Emma','Ava','Sophia','Mia','Amelia','Harper','Ella','Aria','Chloe','Nora','Lily','Zoe','Ruby',
                            'Aarav','Ishaan','Anaya','Diya','Mateo','Sofia','Lucia','Yusuf','Amara','Kai','Mila','Theo'];
  v_lasts   text[] := ARRAY['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez',
                            'Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Patel','Sharma','Nguyen','Kim','Khan',
                            'Clark','Lewis','Walker','Hall','Young'];
BEGIN
  SELECT id INTO v_center FROM centers WHERE name = 'Kiddie Academy of Harrisburg' LIMIT 1;
  IF v_center IS NULL THEN RAISE EXCEPTION 'Center not found'; END IF;

  -- room name -> how many children to add (the room's own age range decides their ages)
  FOR v_room IN
    SELECT w.id, w.name, w.min_age_months AS mn, w.max_age_months AS mx, t.n
    FROM work_areas w
    JOIN (VALUES ('Infant A', 5), ('Infant B', 5), ('Toddlers A', 6), ('Toddlers B', 6), ('Twos A', 7),
                 ('Twos B', 7), ('Three A', 8), ('Three B', 6), ('Fours', 10)) AS t(name, n) ON t.name = w.name
    WHERE w.center_id = v_center AND w.is_active AND w.min_age_months IS NOT NULL AND w.max_age_months IS NOT NULL
  LOOP
    FOR v_i IN 1..v_room.n LOOP
      -- whole months inside [min, max), plus a random number of days so birthdays are spread out
      v_age := v_room.mn + floor(random() * (v_room.mx - v_room.mn))::integer;
      v_dob := (current_date - make_interval(months => v_age))::date - floor(random() * 27)::integer;
      INSERT INTO children (center_id, first_name, last_name, date_of_birth, classroom_id, status, enrolled_on, first_attended_on)
      VALUES (v_center,
              v_firsts[1 + floor(random() * array_length(v_firsts, 1))::integer],
              v_lasts[1 + floor(random() * array_length(v_lasts, 1))::integer] || ' (Test)',
              v_dob, v_room.id, 'enrolled', current_date - 60, current_date - 55);
    END LOOP;
  END LOOP;
END $$;

-- Cleanup (run on its own when you are done):
-- DELETE FROM children WHERE last_name LIKE '% (Test)';

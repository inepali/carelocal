-- ============================================================
-- Time Clock: staff punch in and out with a 4-digit Time Card PIN on the center's tablet, ask for time off, and
-- open My Room. Pay hours come only from these punches; the Live Roster keeps its own check-ins (where teachers
-- are, room moves) and is never used for pay.
--
--  - centers.timeclock_enabled: the module switch (super admin only, guard_timeclock_flag). Off by default.
--  - timeclock_settings: per center: pay period (weekly or every 2 weeks, counted from period_anchor), PTO year
--    (calendar or each person's work anniversary), how many unused PTO hours carry into the next year, and how
--    many hours a full day off is.
--  - staff_time_pins: one PIN per employee (center_staff row), set only by the center's owners and admins. Only
--    HMAC(center id + PIN, pepper) is stored, unique within the center, so the PIN alone picks the person at the
--    Time Clock. Staff cannot change their own PIN.
--  - timeclock_devices: a tablet an admin turned into the Time Clock. The browser keeps a random token in an
--    httpOnly cookie; only its SHA-256 is stored. PINs work only on a registered, not revoked device.
--  - timeclock_attempts: 5 wrong PINs per device per 15 minutes, 30 per center per hour, then a pause.
--  - time_entries: one row per work period (clock in, clock out), several a day are fine (lunch out/in). One open
--    period per person. A period left open for more than 16 hours is marked missed_out (forgot to clock out): the
--    person can clock in again and an admin fixes the missed one. Admin changes need a reason and are logged in
--    time_entry_log (append-only, with the row before and after).
--  - time_off_requests: PTO, Unpaid or Sick, full or half days, from the Time Clock, the staff portal, or entered by
--    an admin (approved right away). Hours count Monday to Friday. Owners and admins approve or deny.
--  - staff_pto_allowances: yearly PTO hours per employee. Balance = yearly hours + carry-over - approved PTO in the
--    PTO year (pending shown apart). Carry-over = unused hours of the previous PTO year, up to the center's cap,
--    only for people employed on the first day of that year (one level: it does not chain further back).
--  - Daily Schedule: an approved full-day time off marks the teacher off (schedule_absences, linked by
--    time_off_id) on days already opened and on days built later; cancelling it puts the fixed schedule back.
--  - Nobody reads or writes these tables directly except owners and admins reading entries and requests (RLS). The
--    tablet goes through the service role and the timeclock_* device functions; everything else through the
--    functions below.
-- Needs: center_staff, staff_profiles, can_view_confidential(), roster_today(), the staff schedule migrations.
-- Rollback: supabase/rollbacks/20270120000000_time_clock.down.sql
-- ============================================================

-- 1. Module switch ---------------------------------------------------------------------------------------------
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS timeclock_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_timeclock_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.timeclock_enabled IS NOT DISTINCT FROM OLD.timeclock_enabled THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) THEN RETURN NEW; END IF;
  NEW.timeclock_enabled := OLD.timeclock_enabled;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_timeclock_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_timeclock_flag ON public.centers;
CREATE TRIGGER trg_guard_timeclock_flag BEFORE UPDATE ON public.centers
  FOR EACH ROW EXECUTE FUNCTION public.guard_timeclock_flag();

-- 2. Tables ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timeclock_settings (
  center_id           uuid PRIMARY KEY REFERENCES public.centers(id) ON DELETE CASCADE,
  pay_period          text NOT NULL DEFAULT 'weekly' CHECK (pay_period IN ('weekly', 'biweekly')),
  period_anchor       date NOT NULL DEFAULT DATE '2026-01-05',       -- a first day of a pay period (a Monday by default)
  pto_year            text NOT NULL DEFAULT 'calendar' CHECK (pto_year IN ('calendar', 'anniversary')),
  carryover_max_hours numeric(6,2) NOT NULL DEFAULT 0 CHECK (carryover_max_hours >= 0 AND carryover_max_hours <= 2000),
  full_day_hours      numeric(4,2) NOT NULL DEFAULT 8 CHECK (full_day_hours > 0 AND full_day_hours <= 12),
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_time_pins (
  center_staff_id  uuid PRIMARY KEY REFERENCES public.center_staff(id) ON DELETE CASCADE,
  center_id        uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  pin_hash         text NOT NULL CHECK (pin_hash ~ '^[0-9a-f]{64}$'),   -- HMAC of center id + PIN
  set_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  set_at           timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz,
  CONSTRAINT staff_time_pins_unique UNIQUE (center_id, pin_hash)
);

CREATE TABLE IF NOT EXISTS public.timeclock_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id     uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS timeclock_devices_center_idx ON public.timeclock_devices (center_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.timeclock_attempts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id  uuid NOT NULL REFERENCES public.timeclock_devices(id) ON DELETE CASCADE,
  center_id  uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  ok         boolean NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS timeclock_attempts_device_idx ON public.timeclock_attempts (device_id, at DESC) WHERE NOT ok;
CREATE INDEX IF NOT EXISTS timeclock_attempts_center_idx ON public.timeclock_attempts (center_id, at DESC) WHERE NOT ok;
CREATE INDEX IF NOT EXISTS timeclock_attempts_at_idx ON public.timeclock_attempts (at);

CREATE TABLE IF NOT EXISTS public.time_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id        uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  center_staff_id  uuid NOT NULL REFERENCES public.center_staff(id) ON DELETE CASCADE,
  clock_in         timestamptz NOT NULL,
  clock_out        timestamptz,
  missed_out       boolean NOT NULL DEFAULT false,      -- left open over 16 hours; an admin sets the clock-out
  in_device_id     uuid REFERENCES public.timeclock_devices(id) ON DELETE SET NULL,
  out_device_id    uuid REFERENCES public.timeclock_devices(id) ON DELETE SET NULL,
  source           text NOT NULL DEFAULT 'clock' CHECK (source IN ('clock', 'admin')),
  edited           boolean NOT NULL DEFAULT false,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_entries_order CHECK (clock_out IS NULL OR clock_out > clock_in),
  CONSTRAINT time_entries_length CHECK (clock_out IS NULL OR clock_out - clock_in <= interval '24 hours'),
  CONSTRAINT time_entries_missed CHECK (NOT missed_out OR clock_out IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open ON public.time_entries (center_staff_id)
  WHERE clock_out IS NULL AND NOT missed_out;
CREATE INDEX IF NOT EXISTS time_entries_center_in_idx ON public.time_entries (center_id, clock_in);
CREATE INDEX IF NOT EXISTS time_entries_staff_in_idx ON public.time_entries (center_staff_id, clock_in DESC);

CREATE TABLE IF NOT EXISTS public.time_entry_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  center_id   uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  entry_id    uuid,                                     -- kept after the entry is deleted
  center_staff_id uuid,
  action      text NOT NULL CHECK (action IN ('clock_in', 'clock_out', 'missed_out', 'add', 'edit', 'delete')),
  before      jsonb,
  after       jsonb,
  reason      text CHECK (reason IS NULL OR char_length(reason) <= 300),
  by_user     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  by_device   uuid REFERENCES public.timeclock_devices(id) ON DELETE SET NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_entry_log_entry_idx ON public.time_entry_log (entry_id, at);
CREATE INDEX IF NOT EXISTS time_entry_log_center_idx ON public.time_entry_log (center_id, at DESC);

CREATE TABLE IF NOT EXISTS public.staff_pto_allowances (
  center_staff_id  uuid PRIMARY KEY REFERENCES public.center_staff(id) ON DELETE CASCADE,
  center_id        uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  yearly_hours     numeric(6,2) NOT NULL DEFAULT 0 CHECK (yearly_hours >= 0 AND yearly_hours <= 2000),
  updated_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.time_off_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id        uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  center_staff_id  uuid NOT NULL REFERENCES public.center_staff(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('pto', 'unpaid', 'sick')),
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  full_day         boolean NOT NULL DEFAULT true,
  hours            numeric(6,2) NOT NULL CHECK (hours >= 0 AND hours <= 500),
  reason           text CHECK (reason IS NULL OR char_length(reason) <= 300),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  via              text NOT NULL CHECK (via IN ('clock', 'portal', 'admin')),
  requested_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at       timestamptz,
  decision_note    text CHECK (decision_note IS NULL OR char_length(decision_note) <= 300),
  CONSTRAINT time_off_dates CHECK (end_date >= start_date AND end_date - start_date <= 30)
);
CREATE INDEX IF NOT EXISTS time_off_center_idx ON public.time_off_requests (center_id, status, start_date);
CREATE INDEX IF NOT EXISTS time_off_staff_idx ON public.time_off_requests (center_staff_id, start_date);

ALTER TABLE public.schedule_absences ADD COLUMN IF NOT EXISTS time_off_id uuid
  REFERENCES public.time_off_requests(id) ON DELETE SET NULL;

ALTER TABLE public.timeclock_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_time_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeclock_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeclock_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entry_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_pto_allowances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_off_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.timeclock_settings, public.staff_time_pins, public.timeclock_devices, public.timeclock_attempts,
  public.time_entries, public.time_entry_log, public.staff_pto_allowances, public.time_off_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.timeclock_settings, public.staff_time_pins, public.timeclock_devices, public.timeclock_attempts,
  public.time_entries, public.time_entry_log, public.staff_pto_allowances, public.time_off_requests TO service_role;

-- Owners and admins of a center with the Time Clock on may read its entries, their history and time off
CREATE OR REPLACE FUNCTION public.timeclock_admin_can(p_center_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_confidential(p_center_id)
     AND COALESCE((SELECT c.timeclock_enabled FROM centers c WHERE c.id = p_center_id), false);
$$;
REVOKE ALL ON FUNCTION public.timeclock_admin_can(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_admin_can(uuid) TO authenticated;
GRANT SELECT ON public.time_entries, public.time_entry_log, public.time_off_requests TO authenticated;
DROP POLICY IF EXISTS time_entries_admin_read ON public.time_entries;
CREATE POLICY time_entries_admin_read ON public.time_entries FOR SELECT TO authenticated
  USING (public.timeclock_admin_can(center_id));
DROP POLICY IF EXISTS time_entry_log_admin_read ON public.time_entry_log;
CREATE POLICY time_entry_log_admin_read ON public.time_entry_log FOR SELECT TO authenticated
  USING (public.timeclock_admin_can(center_id));
DROP POLICY IF EXISTS time_off_admin_read ON public.time_off_requests;
CREATE POLICY time_off_admin_read ON public.time_off_requests FOR SELECT TO authenticated
  USING (public.timeclock_admin_can(center_id));

-- 3. Helpers (internal) ------------------------------------------------------------------------------------------

-- The center's settings, with defaults when none are saved
CREATE OR REPLACE FUNCTION public.timeclock_cfg(p_center_id uuid)
RETURNS timeclock_settings LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s timeclock_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM timeclock_settings WHERE center_id = p_center_id;
  IF NOT FOUND THEN
    s.center_id := p_center_id; s.pay_period := 'weekly'; s.period_anchor := DATE '2026-01-05';
    s.pto_year := 'calendar'; s.carryover_max_hours := 0; s.full_day_hours := 8;
  END IF;
  RETURN s;
END $$;

-- "First Last" of an employee
CREATE OR REPLACE FUNCTION public.timeclock_name(p_center_staff_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT btrim(COALESCE(sp.first_name, '') || ' ' || COALESCE(sp.last_name, ''))
    FROM center_staff cs JOIN staff_profiles sp ON sp.id = cs.staff_id WHERE cs.id = p_center_staff_id;
$$;

-- The PTO year that holds p_on for this employee: [first day, first day of the next year)
CREATE OR REPLACE FUNCTION public.timeclock_pto_year(p_center_staff_id uuid, p_on date)
RETURNS daterange LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cs center_staff%ROWTYPE; v_mode text; v_start date; v_first date; v_next date; v_years integer;
BEGIN
  SELECT * INTO cs FROM center_staff WHERE id = p_center_staff_id;
  v_mode := (public.timeclock_cfg(cs.center_id)).pto_year;
  IF v_mode = 'anniversary' THEN
    v_start := COALESCE(cs.employment_start_date, cs.added_at::date);
  END IF;
  IF v_start IS NULL OR v_mode = 'calendar' THEN
    v_first := date_trunc('year', p_on)::date;
    RETURN daterange(v_first, (v_first + interval '1 year')::date, '[)');
  END IF;
  -- Anniversaries are counted from the start date each time (a Feb 29 start falls on Feb 28 in other years)
  v_years := extract(year FROM age(p_on, v_start))::integer;
  IF p_on < v_start THEN v_years := v_years - 1; END IF;   -- before the start date: the year that ends on it
  FOR i IN 1..3 LOOP
    v_first := (v_start + make_interval(years => v_years))::date;
    v_next := (v_start + make_interval(years => v_years + 1))::date;
    EXIT WHEN v_first <= p_on AND p_on < v_next;
    v_years := v_years + CASE WHEN p_on >= v_next THEN 1 ELSE -1 END;
  END LOOP;
  RETURN daterange(v_first, v_next, '[)');
END $$;

-- Approved (or pending) PTO hours that start inside a range
CREATE OR REPLACE FUNCTION public.timeclock_pto_sum(p_center_staff_id uuid, p_range daterange, p_status text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(hours), 0) FROM time_off_requests
   WHERE center_staff_id = p_center_staff_id AND kind = 'pto' AND status = p_status AND p_range @> start_date;
$$;

-- An employee's PTO for the PTO year holding p_on:
-- {year_start, year_end (last day), yearly, carry_over, used, pending, remaining}
CREATE OR REPLACE FUNCTION public.timeclock_pto_balance(p_center_staff_id uuid, p_on date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cs center_staff%ROWTYPE; v_year daterange; v_prev daterange; v_yearly numeric; v_cap numeric; v_carry numeric := 0;
  v_used numeric; v_pending numeric; v_start date;
BEGIN
  SELECT * INTO cs FROM center_staff WHERE id = p_center_staff_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_year := public.timeclock_pto_year(p_center_staff_id, p_on);
  v_prev := public.timeclock_pto_year(p_center_staff_id, lower(v_year) - 1);
  v_yearly := COALESCE((SELECT yearly_hours FROM staff_pto_allowances WHERE center_staff_id = p_center_staff_id), 0);
  v_cap := (public.timeclock_cfg(cs.center_id)).carryover_max_hours;
  v_start := COALESCE(cs.employment_start_date, cs.added_at::date);
  IF v_cap > 0 AND v_start IS NOT NULL AND v_start <= lower(v_prev) THEN
    v_carry := LEAST(v_cap, GREATEST(0, v_yearly - public.timeclock_pto_sum(p_center_staff_id, v_prev, 'approved')));
  END IF;
  v_used := public.timeclock_pto_sum(p_center_staff_id, v_year, 'approved');
  v_pending := public.timeclock_pto_sum(p_center_staff_id, v_year, 'pending');
  RETURN jsonb_build_object('year_start', lower(v_year), 'year_end', upper(v_year) - 1,
    'yearly', v_yearly, 'carry_over', v_carry, 'used', v_used, 'pending', v_pending,
    'remaining', v_yearly + v_carry - v_used - v_pending);
END $$;

-- Monday-to-Friday days in a range
CREATE OR REPLACE FUNCTION public.timeclock_weekdays(p_start date, p_end date)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT count(*)::integer FROM generate_series(p_start, p_end, interval '1 day') d WHERE extract(isodow FROM d) < 6;
$$;

-- Open periods over 16 hours old become missed_out (the person forgot to clock out)
CREATE OR REPLACE FUNCTION public.timeclock_close_stale(p_center_staff_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e time_entries%ROWTYPE;
BEGIN
  FOR e IN SELECT * FROM time_entries WHERE center_staff_id = p_center_staff_id AND clock_out IS NULL AND NOT missed_out
             AND clock_in < now() - interval '16 hours' FOR UPDATE LOOP
    UPDATE time_entries SET missed_out = true, updated_at = now() WHERE id = e.id;
    INSERT INTO time_entry_log (center_id, entry_id, center_staff_id, action, before)
    VALUES (e.center_id, e.id, e.center_staff_id, 'missed_out', to_jsonb(e));
  END LOOP;
END $$;

-- Mark an approved full-day time off on the Daily Schedule days that are already opened (the rest are marked when
-- they are built, see schedule_fill_fixed). Regular staff only, like call-outs.
CREATE OR REPLACE FUNCTION public.timeclock_schedule_mark(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r time_off_requests%ROWTYPE; cs center_staff%ROWTYPE; d schedule_days%ROWTYPE; x uuid;
BEGIN
  SELECT * INTO r FROM time_off_requests WHERE id = p_request_id;
  IF r.status <> 'approved' OR NOT r.full_day THEN RETURN; END IF;
  SELECT * INTO cs FROM center_staff WHERE id = r.center_staff_id AND status = 'active' AND employment_class = 'regular';
  IF NOT FOUND THEN RETURN; END IF;
  FOR d IN SELECT * FROM schedule_days WHERE center_id = r.center_id AND service_date BETWEEN r.start_date AND r.end_date FOR UPDATE LOOP
    INSERT INTO schedule_absences (day_id, center_id, service_date, center_staff_id, kind, note, recorded_by, time_off_id)
    VALUES (d.id, d.center_id, d.service_date, cs.id, CASE r.kind WHEN 'unpaid' THEN 'other' ELSE r.kind END,
            'Approved time off', r.decided_by, r.id)
    ON CONFLICT (day_id, center_staff_id) DO UPDATE
      SET kind = EXCLUDED.kind, start_time = NULL, end_time = NULL, note = EXCLUDED.note, time_off_id = EXCLUDED.time_off_id,
          recorded_by = EXCLUDED.recorded_by, recorded_at = now();
    FOR x IN SELECT id FROM schedule_blocks WHERE day_id = d.id AND center_staff_id = cs.id AND kind = 'cover' LOOP
      PERFORM public.schedule_cover_release(d, x, false);
    END LOOP;
    DELETE FROM schedule_blocks WHERE day_id = d.id AND center_staff_id = cs.id AND kind <> 'cover';
    PERFORM public.schedule_log(d, 'time_off', jsonb_build_object('staff_id', cs.staff_id, 'kind', r.kind));
    UPDATE schedule_days SET version = version + 1 WHERE id = d.id;
  END LOOP;
END $$;

-- A cancelled time off: its days on the schedule get the teacher's fixed schedule back
CREATE OR REPLACE FUNCTION public.timeclock_schedule_unmark(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a schedule_absences%ROWTYPE; d schedule_days%ROWTYPE; cs center_staff%ROWTYPE;
BEGIN
  FOR a IN SELECT * FROM schedule_absences WHERE time_off_id = p_request_id LOOP
    SELECT * INTO d FROM schedule_days WHERE id = a.day_id FOR UPDATE;
    SELECT * INTO cs FROM center_staff WHERE id = a.center_staff_id;
    DELETE FROM schedule_absences WHERE id = a.id;
    DELETE FROM schedule_blocks WHERE day_id = d.id AND center_staff_id = cs.id AND kind <> 'cover';
    IF cs.status = 'active' AND cs.employment_class = 'regular' THEN PERFORM public.schedule_fill_fixed(d, cs); END IF;
    PERFORM public.schedule_log(d, 'time_off_cancel', jsonb_build_object('staff_id', cs.staff_id));
    UPDATE schedule_days SET version = version + 1 WHERE id = d.id;
  END LOOP;
END $$;

-- Days built after the approval: the fixed schedule is skipped and the teacher is marked off
CREATE OR REPLACE FUNCTION public.schedule_fill_fixed(p_day schedule_days, p_cs center_staff)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f staff_fixed_schedules%ROWTYPE; w schedule_blocks%ROWTYPE; v_n integer := 0; r time_off_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM time_off_requests
   WHERE center_staff_id = p_cs.id AND status = 'approved' AND full_day
     AND p_day.service_date BETWEEN start_date AND end_date
   ORDER BY decided_at DESC LIMIT 1;
  IF FOUND THEN
    INSERT INTO schedule_absences (day_id, center_id, service_date, center_staff_id, kind, note, recorded_by, time_off_id)
    VALUES (p_day.id, p_day.center_id, p_day.service_date, p_cs.id, CASE r.kind WHEN 'unpaid' THEN 'other' ELSE r.kind END,
            'Approved time off', r.decided_by, r.id)
    ON CONFLICT (day_id, center_staff_id) DO NOTHING;
    RETURN 0;
  END IF;

  FOR f IN
    SELECT * FROM staff_fixed_schedules
    WHERE center_staff_id = p_cs.id AND weekday = extract(dow FROM p_day.service_date)::int AND kind = 'work'
      AND effective_from <= p_day.service_date AND (effective_to IS NULL OR effective_to >= p_day.service_date)
    ORDER BY start_time
  LOOP
    PERFORM public.schedule_add_trimmed(p_day, p_cs,
      CASE WHEN EXISTS (SELECT 1 FROM work_areas wa WHERE wa.id = f.work_area_id AND COALESCE(wa.is_active, true)) THEN f.work_area_id END,
      f.start_time, f.end_time, 'fixed', f.id, f.notes);
    v_n := v_n + 1;
  END LOOP;
  -- Usual breaks: cut out of the box they fall in (skipped if that time isn't a working box today)
  FOR f IN
    SELECT * FROM staff_fixed_schedules
    WHERE center_staff_id = p_cs.id AND weekday = extract(dow FROM p_day.service_date)::int AND kind = 'break'
      AND effective_from <= p_day.service_date AND (effective_to IS NULL OR effective_to >= p_day.service_date)
    ORDER BY start_time
  LOOP
    SELECT * INTO w FROM schedule_blocks
    WHERE day_id = p_day.id AND center_staff_id = p_cs.id AND kind = 'work' AND start_time <= f.start_time AND end_time >= f.end_time LIMIT 1;
    CONTINUE WHEN NOT FOUND;
    PERFORM public.schedule_carve(p_day.id, p_cs.staff_id, f.start_time, f.end_time, ARRAY['work'], false);
    INSERT INTO schedule_blocks (day_id, center_id, service_date, staff_id, center_staff_id, work_area_id, start_time, end_time, kind, source, fixed_schedule_id, updated_by)
    VALUES (p_day.id, p_day.center_id, p_day.service_date, p_cs.staff_id, p_cs.id, w.work_area_id, f.start_time, f.end_time, 'break', 'fixed', f.id, auth.uid());
  END LOOP;
  RETURN v_n;
END $$;

-- Create a time off request (all the checks in one place). p_hours NULL = weekdays x day hours.
-- p_check_balance: refuse PTO beyond what is left this PTO year (staff asking themselves).
CREATE OR REPLACE FUNCTION public.timeclock_off_create(
  p_center_staff_id uuid, p_kind text, p_start date, p_end date, p_full_day boolean, p_hours numeric,
  p_reason text, p_via text, p_status text, p_check_balance boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cs center_staff%ROWTYPE; cfg timeclock_settings%ROWTYPE; v_today date; v_days integer; v_hours numeric; v_id uuid;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), ''); v_left numeric;
BEGIN
  SELECT * INTO cs FROM center_staff WHERE id = p_center_staff_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'This person does not work at the center' USING ERRCODE = 'P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('time_off:' || cs.id::text));
  cfg := public.timeclock_cfg(cs.center_id);
  v_today := public.roster_today(cs.center_id);
  IF p_kind IS NULL OR p_kind NOT IN ('pto', 'unpaid', 'sick') THEN RAISE EXCEPTION 'Pick PTO, Unpaid or Sick' USING ERRCODE = '22023'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN RAISE EXCEPTION 'The last day has to be on or after the first day' USING ERRCODE = '22023'; END IF;
  IF p_end - p_start > 30 THEN RAISE EXCEPTION 'Ask for 31 days at most at a time' USING ERRCODE = '22023'; END IF;
  IF p_via <> 'admin' AND p_start < v_today - 7 THEN RAISE EXCEPTION 'The first day can be at most a week ago' USING ERRCODE = '22023'; END IF;
  IF p_start < v_today - 366 OR p_start > v_today + 366 THEN RAISE EXCEPTION 'Pick days within a year from today' USING ERRCODE = '22023'; END IF;
  IF char_length(v_reason) > 300 THEN RAISE EXCEPTION 'The note is 300 characters at most' USING ERRCODE = '22023'; END IF;
  v_days := public.timeclock_weekdays(p_start, p_end);
  IF v_days = 0 AND p_hours IS NULL THEN RAISE EXCEPTION 'Those days are a weekend. Pick at least one weekday' USING ERRCODE = '22023'; END IF;
  IF NOT COALESCE(p_full_day, true) AND p_start <> p_end THEN RAISE EXCEPTION 'A half day is one day' USING ERRCODE = '22023'; END IF;
  v_hours := COALESCE(p_hours, v_days * CASE WHEN COALESCE(p_full_day, true) THEN cfg.full_day_hours ELSE cfg.full_day_hours / 2 END);
  IF v_hours < 0 OR v_hours > 500 THEN RAISE EXCEPTION 'Hours have to be between 0 and 500' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM time_off_requests WHERE center_staff_id = cs.id AND status IN ('pending', 'approved')
              AND daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) THEN
    RAISE EXCEPTION 'There is already a time off request for some of those days' USING ERRCODE = '23505';
  END IF;
  IF p_check_balance AND p_kind = 'pto' THEN
    v_left := (public.timeclock_pto_balance(cs.id, p_start) ->> 'remaining')::numeric;
    IF v_hours > v_left THEN
      RAISE EXCEPTION 'That is % PTO hours and % are left this year. Ask for Unpaid time, or talk to the office',
        trim_scale(v_hours), trim_scale(GREATEST(v_left, 0)) USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO time_off_requests (center_id, center_staff_id, kind, start_date, end_date, full_day, hours, reason, status, via, requested_by,
                                 decided_by, decided_at)
  VALUES (cs.center_id, cs.id, p_kind, p_start, p_end, COALESCE(p_full_day, true), v_hours, v_reason, p_status, p_via, auth.uid(),
          CASE WHEN p_status = 'approved' THEN auth.uid() END, CASE WHEN p_status = 'approved' THEN now() END)
  RETURNING id INTO v_id;
  IF p_status = 'approved' THEN PERFORM public.timeclock_schedule_mark(v_id); END IF;
  RETURN v_id;
END $$;

-- Requests as the screens show them
CREATE OR REPLACE FUNCTION public.timeclock_off_json(r time_off_requests)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', r.id, 'center_staff_id', r.center_staff_id, 'name', public.timeclock_name(r.center_staff_id),
    'kind', r.kind, 'start_date', r.start_date, 'end_date', r.end_date, 'full_day', r.full_day, 'hours', r.hours,
    'reason', r.reason, 'status', r.status, 'via', r.via, 'created_at', r.created_at, 'decided_at', r.decided_at,
    'decision_note', r.decision_note);
$$;

REVOKE ALL ON FUNCTION public.timeclock_cfg(uuid), public.timeclock_name(uuid), public.timeclock_pto_year(uuid, date),
  public.timeclock_pto_sum(uuid, daterange, text), public.timeclock_pto_balance(uuid, date), public.timeclock_weekdays(date, date),
  public.timeclock_close_stale(uuid), public.timeclock_schedule_mark(uuid), public.timeclock_schedule_unmark(uuid),
  public.timeclock_off_create(uuid, text, date, date, boolean, numeric, text, text, text, boolean),
  public.timeclock_off_json(time_off_requests) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_fill_fixed(schedule_days, center_staff) FROM PUBLIC, anon, authenticated;

-- 4. The tablet (service role only) --------------------------------------------------------------------------------

-- The Time Clock this device is: {device_id, device_name, center: {id, name, timezone, today, roster}} or NULL
-- (unknown or revoked device, module off, center off). Notes when it was last seen.
CREATE OR REPLACE FUNCTION public.timeclock_device(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_id uuid;
BEGIN
  SELECT d.id, jsonb_build_object('device_id', d.id, 'device_name', d.name,
           'center', jsonb_build_object('id', c.id, 'name', c.name, 'timezone', COALESCE(NULLIF(c.timezone, ''), 'America/New_York'),
                                        'today', public.roster_today(c.id), 'roster', c.roster_enabled,
                                        'full_day_hours', (public.timeclock_cfg(c.id)).full_day_hours))
    INTO v_id, v
    FROM timeclock_devices d JOIN centers c ON c.id = d.center_id
   WHERE d.token_hash = p_token_hash AND d.revoked_at IS NULL AND c.timeclock_enabled AND c.is_active;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  UPDATE timeclock_devices SET last_seen_at = now() WHERE id = v_id AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes');
  RETURN v;
END $$;

-- Check a PIN on a device. {status: 'ok', device_id, center_id, center_staff_id} | {status: 'invalid', left}
-- | {status: 'locked', retry_after} (this device) | {status: 'paused', retry_after} (the center) | {status: 'no_device'}
CREATE OR REPLACE FUNCTION public.timeclock_auth(p_token_hash text, p_pin_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_window   constant interval := interval '15 minutes';
  c_max      constant integer := 5;
  c_center   constant integer := 30;
  d timeclock_devices%ROWTYPE; v_fails integer; v_oldest timestamptz; v_cs uuid;
BEGIN
  SELECT dv.* INTO d FROM timeclock_devices dv JOIN centers c ON c.id = dv.center_id
   WHERE dv.token_hash = p_token_hash AND dv.revoked_at IS NULL AND c.timeclock_enabled AND c.is_active;
  IF d.id IS NULL THEN RETURN jsonb_build_object('status', 'no_device'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('timeclock_auth:' || d.id::text));
  DELETE FROM timeclock_attempts WHERE at < now() - interval '1 day';

  SELECT count(*), min(at) INTO v_fails, v_oldest FROM timeclock_attempts WHERE device_id = d.id AND NOT ok AND at > now() - c_window;
  IF v_fails >= c_max THEN
    RETURN jsonb_build_object('status', 'locked', 'retry_after', GREATEST(30, ceil(extract(epoch FROM (v_oldest + c_window - now())))::integer));
  END IF;
  IF (SELECT count(*) FROM timeclock_attempts WHERE center_id = d.center_id AND NOT ok AND at > now() - interval '1 hour') >= c_center THEN
    RETURN jsonb_build_object('status', 'paused', 'retry_after', 3600);
  END IF;

  SELECT p.center_staff_id INTO v_cs
    FROM staff_time_pins p JOIN center_staff cs ON cs.id = p.center_staff_id
   WHERE p.center_id = d.center_id AND p.pin_hash = p_pin_hash AND cs.center_id = d.center_id AND cs.status = 'active';
  IF v_cs IS NULL THEN
    INSERT INTO timeclock_attempts (device_id, center_id, ok) VALUES (d.id, d.center_id, false);
    RETURN jsonb_build_object('status', 'invalid', 'left', c_max - v_fails - 1);
  END IF;
  UPDATE staff_time_pins SET last_used_at = now() WHERE center_staff_id = v_cs;
  RETURN jsonb_build_object('status', 'ok', 'device_id', d.id, 'center_id', d.center_id, 'center_staff_id', v_cs);
END $$;

-- What the screen shows after a PIN: the person, whether they are clocked in, their PTO and recent requests
CREATE OR REPLACE FUNCTION public.timeclock_person(p_center_staff_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cs center_staff%ROWTYPE; sp staff_profiles%ROWTYPE; e time_entries%ROWTYPE; v_today date; v_tz text;
BEGIN
  PERFORM public.timeclock_close_stale(p_center_staff_id);
  SELECT * INTO cs FROM center_staff WHERE id = p_center_staff_id;
  SELECT * INTO sp FROM staff_profiles WHERE id = cs.staff_id;
  SELECT * INTO e FROM time_entries WHERE center_staff_id = cs.id AND clock_out IS NULL AND NOT missed_out;
  v_today := public.roster_today(cs.center_id);
  v_tz := COALESCE(NULLIF((SELECT timezone FROM centers WHERE id = cs.center_id), ''), 'America/New_York');
  RETURN jsonb_build_object(
    'center_staff_id', cs.id,
    'first_name', sp.first_name,
    'name', btrim(COALESCE(sp.first_name, '') || ' ' || COALESCE(sp.last_name, '')),
    'avatar_url', sp.avatar_url,
    'clocked_in_at', e.clock_in,
    'missed', EXISTS (SELECT 1 FROM time_entries WHERE center_staff_id = cs.id AND missed_out),
    'today_minutes', COALESCE((
      SELECT round(sum(extract(epoch FROM (COALESCE(clock_out, now()) - clock_in)) / 60))::integer FROM time_entries
       WHERE center_staff_id = cs.id AND NOT missed_out AND (clock_in AT TIME ZONE v_tz)::date = v_today), 0),
    'room', cs.employment_class = 'regular' AND COALESCE((SELECT roster_enabled FROM centers WHERE id = cs.center_id), false),
    'pto', public.timeclock_pto_balance(cs.id, v_today),
    'requests', COALESCE((SELECT jsonb_agg(public.timeclock_off_json(r) ORDER BY r.start_date DESC)
                            FROM (SELECT * FROM time_off_requests WHERE center_staff_id = cs.id
                                   AND (end_date >= v_today - 30 OR status = 'pending') ORDER BY start_date DESC LIMIT 5) r), '[]'::jsonb));
END $$;

-- PIN typed: who it is (or why not)
CREATE OR REPLACE FUNCTION public.timeclock_identify(p_token_hash text, p_pin_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a jsonb;
BEGIN
  a := public.timeclock_auth(p_token_hash, p_pin_hash);
  IF a ->> 'status' <> 'ok' THEN RETURN a; END IF;
  RETURN jsonb_build_object('status', 'ok', 'person', public.timeclock_person((a ->> 'center_staff_id')::uuid));
END $$;

-- Clock in or out. {status: 'ok', action, at, minutes (of the period just closed), person}
-- | {status: 'already_in', since} | {status: 'not_in'} | the timeclock_auth failures
CREATE OR REPLACE FUNCTION public.timeclock_punch(p_token_hash text, p_pin_hash text, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a jsonb; v_cs uuid; v_dev uuid; v_center uuid; e time_entries%ROWTYPE; v_now timestamptz := now();
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('in', 'out') THEN RAISE EXCEPTION 'Bad punch' USING ERRCODE = '22023'; END IF;
  a := public.timeclock_auth(p_token_hash, p_pin_hash);
  IF a ->> 'status' <> 'ok' THEN RETURN a; END IF;
  v_cs := (a ->> 'center_staff_id')::uuid; v_dev := (a ->> 'device_id')::uuid; v_center := (a ->> 'center_id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtext('timeclock_punch:' || v_cs::text));
  PERFORM public.timeclock_close_stale(v_cs);
  SELECT * INTO e FROM time_entries WHERE center_staff_id = v_cs AND clock_out IS NULL AND NOT missed_out FOR UPDATE;

  IF p_action = 'in' THEN
    IF e.id IS NOT NULL THEN RETURN jsonb_build_object('status', 'already_in', 'since', e.clock_in); END IF;
    INSERT INTO time_entries (center_id, center_staff_id, clock_in, in_device_id, source)
    VALUES (v_center, v_cs, v_now, v_dev, 'clock') RETURNING * INTO e;
    INSERT INTO time_entry_log (center_id, entry_id, center_staff_id, action, after, by_device)
    VALUES (v_center, e.id, v_cs, 'clock_in', to_jsonb(e), v_dev);
    RETURN jsonb_build_object('status', 'ok', 'action', 'in', 'at', v_now, 'person', public.timeclock_person(v_cs));
  END IF;

  IF e.id IS NULL THEN RETURN jsonb_build_object('status', 'not_in'); END IF;
  IF v_now <= e.clock_in THEN v_now := e.clock_in + interval '1 second'; END IF;
  UPDATE time_entries SET clock_out = v_now, out_device_id = v_dev, updated_at = now() WHERE id = e.id;
  INSERT INTO time_entry_log (center_id, entry_id, center_staff_id, action, before, after, by_device)
  VALUES (v_center, e.id, v_cs, 'clock_out', to_jsonb(e), (SELECT to_jsonb(x) FROM time_entries x WHERE x.id = e.id), v_dev);
  RETURN jsonb_build_object('status', 'ok', 'action', 'out', 'at', v_now,
    'minutes', round(extract(epoch FROM (v_now - e.clock_in)) / 60)::integer, 'person', public.timeclock_person(v_cs));
END $$;

-- Ask for time off on the tablet: {status: 'ok', person} | the timeclock_auth failures. Errors are raised (22023).
CREATE OR REPLACE FUNCTION public.timeclock_request_off(
  p_token_hash text, p_pin_hash text, p_kind text, p_start date, p_end date, p_full_day boolean, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a jsonb; v_cs uuid;
BEGIN
  a := public.timeclock_auth(p_token_hash, p_pin_hash);
  IF a ->> 'status' <> 'ok' THEN RETURN a; END IF;
  v_cs := (a ->> 'center_staff_id')::uuid;
  PERFORM public.timeclock_off_create(v_cs, p_kind, p_start, p_end, p_full_day, NULL, p_reason, 'clock', 'pending', true);
  RETURN jsonb_build_object('status', 'ok', 'person', public.timeclock_person(v_cs));
END $$;

-- Cancel one's own pending request on the tablet
CREATE OR REPLACE FUNCTION public.timeclock_cancel_off(p_token_hash text, p_pin_hash text, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a jsonb; v_cs uuid;
BEGIN
  a := public.timeclock_auth(p_token_hash, p_pin_hash);
  IF a ->> 'status' <> 'ok' THEN RETURN a; END IF;
  v_cs := (a ->> 'center_staff_id')::uuid;
  UPDATE time_off_requests SET status = 'cancelled', decided_at = now(), decision_note = 'Cancelled by the employee'
   WHERE id = p_request_id AND center_staff_id = v_cs AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a request still waiting for an answer can be cancelled here' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('status', 'ok', 'person', public.timeclock_person(v_cs));
END $$;

-- My Room by PIN: the staff member's account, only for regular staff of a center with the Live Roster on.
-- {status: 'ok', user_id, email, center_id} | {status: 'no_room'} | the timeclock_auth failures
CREATE OR REPLACE FUNCTION public.timeclock_room_user(p_token_hash text, p_pin_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a jsonb; v_user uuid; v_email text; v_center uuid;
BEGIN
  a := public.timeclock_auth(p_token_hash, p_pin_hash);
  IF a ->> 'status' <> 'ok' THEN RETURN a; END IF;
  SELECT u.id, u.email, cs.center_id INTO v_user, v_email, v_center
    FROM center_staff cs JOIN staff_profiles sp ON sp.id = cs.staff_id JOIN auth.users u ON u.id = sp.user_id JOIN centers c ON c.id = cs.center_id
   WHERE cs.id = (a ->> 'center_staff_id')::uuid AND cs.status = 'active' AND cs.employment_class = 'regular' AND c.roster_enabled;
  IF v_user IS NULL OR v_email IS NULL THEN RETURN jsonb_build_object('status', 'no_room'); END IF;
  RETURN jsonb_build_object('status', 'ok', 'user_id', v_user, 'email', v_email, 'center_id', v_center);
END $$;

REVOKE ALL ON FUNCTION public.timeclock_device(text), public.timeclock_auth(text, text), public.timeclock_person(uuid),
  public.timeclock_identify(text, text), public.timeclock_punch(text, text, text),
  public.timeclock_request_off(text, text, text, date, date, boolean, text), public.timeclock_cancel_off(text, text, uuid),
  public.timeclock_room_user(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timeclock_device(text), public.timeclock_identify(text, text), public.timeclock_punch(text, text, text),
  public.timeclock_request_off(text, text, text, date, date, boolean, text), public.timeclock_cancel_off(text, text, uuid),
  public.timeclock_room_user(text, text) TO service_role;

-- 5. Owners and admins ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.timeclock_admin_check(p_center_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_confidential(p_center_id) THEN
    RAISE EXCEPTION 'Only the owner and administrators can manage the Time Clock.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM centers WHERE id = p_center_id AND timeclock_enabled) THEN
    RAISE EXCEPTION 'The Time Clock is not turned on for your center.' USING ERRCODE = '42501';
  END IF;
END $$;

-- Settings, staff (PIN set or not, PTO hours and balance), devices
CREATE OR REPLACE FUNCTION public.timeclock_overview(p_center_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg timeclock_settings%ROWTYPE; v_today date;
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  cfg := public.timeclock_cfg(p_center_id);
  v_today := public.roster_today(p_center_id);
  RETURN jsonb_build_object(
    'today', v_today,
    'timezone', COALESCE(NULLIF((SELECT timezone FROM centers WHERE id = p_center_id), ''), 'America/New_York'),
    'settings', jsonb_build_object('pay_period', cfg.pay_period, 'period_anchor', cfg.period_anchor, 'pto_year', cfg.pto_year,
                                   'carryover_max_hours', cfg.carryover_max_hours, 'full_day_hours', cfg.full_day_hours),
    'staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'center_staff_id', cs.id,
               'name', btrim(COALESCE(sp.first_name, '') || ' ' || COALESCE(sp.last_name, '')),
               'avatar_url', sp.avatar_url,
               'employment_class', cs.employment_class,
               'part_time', COALESCE(cs.part_time, false),
               'start_date', COALESCE(cs.employment_start_date, cs.added_at::date),
               'has_pin', p.center_staff_id IS NOT NULL,
               'pin_set_at', p.set_at,
               'pin_last_used_at', p.last_used_at,
               'pto', public.timeclock_pto_balance(cs.id, v_today))
             ORDER BY lower(sp.first_name), lower(sp.last_name))
        FROM center_staff cs JOIN staff_profiles sp ON sp.id = cs.staff_id
        LEFT JOIN staff_time_pins p ON p.center_staff_id = cs.id
       WHERE cs.center_id = p_center_id AND cs.status = 'active'), '[]'::jsonb),
    'devices', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'created_at', d.created_at, 'last_seen_at', d.last_seen_at)
             ORDER BY d.created_at)
        FROM timeclock_devices d WHERE d.center_id = p_center_id AND d.revoked_at IS NULL), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.timeclock_settings_save(
  p_center_id uuid, p_pay_period text, p_period_anchor date, p_pto_year text, p_carryover_max numeric, p_full_day_hours numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  IF p_pay_period NOT IN ('weekly', 'biweekly') THEN RAISE EXCEPTION 'Pay period is weekly or every 2 weeks' USING ERRCODE = '22023'; END IF;
  IF p_pto_year NOT IN ('calendar', 'anniversary') THEN RAISE EXCEPTION 'PTO year is the calendar year or the work anniversary' USING ERRCODE = '22023'; END IF;
  IF p_period_anchor IS NULL OR p_period_anchor < DATE '2000-01-01' OR p_period_anchor > DATE '2100-01-01' THEN
    RAISE EXCEPTION 'Pick the first day of a pay period' USING ERRCODE = '22023';
  END IF;
  IF p_carryover_max IS NULL OR p_carryover_max < 0 OR p_carryover_max > 2000 THEN RAISE EXCEPTION 'Carry-over is 0 to 2000 hours' USING ERRCODE = '22023'; END IF;
  IF p_full_day_hours IS NULL OR p_full_day_hours <= 0 OR p_full_day_hours > 12 THEN RAISE EXCEPTION 'A full day is 1 to 12 hours' USING ERRCODE = '22023'; END IF;
  INSERT INTO timeclock_settings (center_id, pay_period, period_anchor, pto_year, carryover_max_hours, full_day_hours, updated_by, updated_at)
  VALUES (p_center_id, p_pay_period, p_period_anchor, p_pto_year, p_carryover_max, p_full_day_hours, auth.uid(), now())
  ON CONFLICT (center_id) DO UPDATE SET pay_period = EXCLUDED.pay_period, period_anchor = EXCLUDED.period_anchor,
    pto_year = EXCLUDED.pto_year, carryover_max_hours = EXCLUDED.carryover_max_hours, full_day_hours = EXCLUDED.full_day_hours,
    updated_by = EXCLUDED.updated_by, updated_at = now();
END $$;

-- Set an employee's PIN (the app sends only its HMAC). Another employee here with the same PIN: SQLSTATE 23505.
CREATE OR REPLACE FUNCTION public.timeclock_pin_set(p_center_id uuid, p_center_staff_id uuid, p_pin_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  IF p_pin_hash IS NULL OR p_pin_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Bad PIN' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM center_staff WHERE id = p_center_staff_id AND center_id = p_center_id AND status = 'active') THEN
    RAISE EXCEPTION 'This person does not work at your center' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM staff_time_pins WHERE center_id = p_center_id AND pin_hash = p_pin_hash AND center_staff_id <> p_center_staff_id) THEN
    RAISE EXCEPTION 'Someone else at your center has that PIN. Pick a different one.' USING ERRCODE = '23505';
  END IF;
  INSERT INTO staff_time_pins (center_staff_id, center_id, pin_hash, set_by, set_at)
  VALUES (p_center_staff_id, p_center_id, p_pin_hash, auth.uid(), now())
  ON CONFLICT (center_staff_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, set_by = EXCLUDED.set_by, set_at = now(), last_used_at = NULL;
END $$;

CREATE OR REPLACE FUNCTION public.timeclock_pin_clear(p_center_id uuid, p_center_staff_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  DELETE FROM staff_time_pins WHERE center_id = p_center_id AND center_staff_id = p_center_staff_id;
END $$;

CREATE OR REPLACE FUNCTION public.timeclock_allowance_set(p_center_id uuid, p_center_staff_id uuid, p_hours numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  IF p_hours IS NULL OR p_hours < 0 OR p_hours > 2000 THEN RAISE EXCEPTION 'Yearly PTO is 0 to 2000 hours' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM center_staff WHERE id = p_center_staff_id AND center_id = p_center_id AND status = 'active') THEN
    RAISE EXCEPTION 'This person does not work at your center' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO staff_pto_allowances (center_staff_id, center_id, yearly_hours, updated_by, updated_at)
  VALUES (p_center_staff_id, p_center_id, p_hours, auth.uid(), now())
  ON CONFLICT (center_staff_id) DO UPDATE SET yearly_hours = EXCLUDED.yearly_hours, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN public.timeclock_pto_balance(p_center_staff_id, public.roster_today(p_center_id));
END $$;

-- Turn the browser the admin is using into a Time Clock (the app keeps the token; only its hash comes here)
CREATE OR REPLACE FUNCTION public.timeclock_device_register(p_center_id uuid, p_token_hash text, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Bad device token' USING ERRCODE = '22023'; END IF;
  IF v_name IS NULL OR char_length(v_name) > 60 THEN RAISE EXCEPTION 'Give the tablet a name (60 characters at most)' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM timeclock_devices WHERE center_id = p_center_id AND revoked_at IS NULL) >= 10 THEN
    RAISE EXCEPTION 'A center can have 10 Time Clock tablets. Remove one first.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO timeclock_devices (center_id, name, token_hash, created_by) VALUES (p_center_id, v_name, p_token_hash, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.timeclock_device_revoke(p_center_id uuid, p_device_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  UPDATE timeclock_devices SET revoked_at = now(), revoked_by = auth.uid()
   WHERE id = p_device_id AND center_id = p_center_id AND revoked_at IS NULL;
END $$;

-- Entries whose clock-in is between two days (center time), with names. Missed clock-outs of any date are included.
CREATE OR REPLACE FUNCTION public.timeclock_entries(p_center_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tz text;
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 62 THEN
    RAISE EXCEPTION 'Pick up to two months' USING ERRCODE = '22023';
  END IF;
  v_tz := COALESCE(NULLIF((SELECT timezone FROM centers WHERE id = p_center_id), ''), 'America/New_York');
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', e.id, 'center_staff_id', e.center_staff_id, 'name', public.timeclock_name(e.center_staff_id),
             'clock_in', e.clock_in, 'clock_out', e.clock_out, 'missed_out', e.missed_out, 'source', e.source, 'edited', e.edited,
             'day', (e.clock_in AT TIME ZONE v_tz)::date)
           ORDER BY e.clock_in)
      FROM time_entries e
     WHERE e.center_id = p_center_id
       AND (((e.clock_in AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to) OR e.missed_out)), '[]'::jsonb);
END $$;

-- Add (p_entry_id NULL) or change a period. Needs a reason; logged with the row before and after.
CREATE OR REPLACE FUNCTION public.timeclock_entry_save(
  p_center_id uuid, p_entry_id uuid, p_center_staff_id uuid, p_clock_in timestamptz, p_clock_out timestamptz, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e time_entries%ROWTYPE; v_new time_entries%ROWTYPE; v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), ''); v_cs uuid;
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  IF v_reason IS NULL OR char_length(v_reason) < 3 THEN RAISE EXCEPTION 'Say why (a few words)' USING ERRCODE = '22023'; END IF;
  IF char_length(v_reason) > 300 THEN RAISE EXCEPTION 'The reason is 300 characters at most' USING ERRCODE = '22023'; END IF;
  IF p_clock_in IS NULL THEN RAISE EXCEPTION 'Give the clock-in time' USING ERRCODE = '22023'; END IF;
  IF p_clock_in > now() + interval '5 minutes' OR p_clock_out > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Times cannot be in the future' USING ERRCODE = '22023';
  END IF;
  IF p_clock_out IS NOT NULL AND p_clock_out <= p_clock_in THEN RAISE EXCEPTION 'Clock-out has to be after clock-in' USING ERRCODE = '22023'; END IF;
  IF p_clock_out IS NOT NULL AND p_clock_out - p_clock_in > interval '24 hours' THEN RAISE EXCEPTION 'A period is 24 hours at most' USING ERRCODE = '22023'; END IF;

  IF p_entry_id IS NULL THEN
    v_cs := p_center_staff_id;
    IF NOT EXISTS (SELECT 1 FROM center_staff WHERE id = v_cs AND center_id = p_center_id) THEN
      RAISE EXCEPTION 'This person does not work at your center' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT * INTO e FROM time_entries WHERE id = p_entry_id AND center_id = p_center_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That time entry is gone. Reload the page' USING ERRCODE = 'P0002'; END IF;
    v_cs := e.center_staff_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('timeclock_punch:' || v_cs::text));
  IF EXISTS (SELECT 1 FROM time_entries x WHERE x.center_staff_id = v_cs AND x.id IS DISTINCT FROM p_entry_id AND NOT x.missed_out
              AND tstzrange(x.clock_in, COALESCE(x.clock_out, 'infinity')) && tstzrange(p_clock_in, COALESCE(p_clock_out, 'infinity'))) THEN
    RAISE EXCEPTION 'That overlaps another time entry of this person' USING ERRCODE = '23505';
  END IF;

  IF p_entry_id IS NULL THEN
    INSERT INTO time_entries (center_id, center_staff_id, clock_in, clock_out, source, edited, created_by)
    VALUES (p_center_id, v_cs, p_clock_in, p_clock_out, 'admin', true, auth.uid()) RETURNING * INTO v_new;
    INSERT INTO time_entry_log (center_id, entry_id, center_staff_id, action, after, reason, by_user)
    VALUES (p_center_id, v_new.id, v_cs, 'add', to_jsonb(v_new), v_reason, auth.uid());
  ELSE
    UPDATE time_entries SET clock_in = p_clock_in, clock_out = p_clock_out, missed_out = false, edited = true, updated_at = now()
     WHERE id = e.id RETURNING * INTO v_new;
    INSERT INTO time_entry_log (center_id, entry_id, center_staff_id, action, before, after, reason, by_user)
    VALUES (p_center_id, e.id, v_cs, 'edit', to_jsonb(e), to_jsonb(v_new), v_reason, auth.uid());
  END IF;
  RETURN v_new.id;
END $$;

CREATE OR REPLACE FUNCTION public.timeclock_entry_delete(p_center_id uuid, p_entry_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e time_entries%ROWTYPE; v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  IF v_reason IS NULL OR char_length(v_reason) < 3 THEN RAISE EXCEPTION 'Say why (a few words)' USING ERRCODE = '22023'; END IF;
  IF char_length(v_reason) > 300 THEN RAISE EXCEPTION 'The reason is 300 characters at most' USING ERRCODE = '22023'; END IF;
  SELECT * INTO e FROM time_entries WHERE id = p_entry_id AND center_id = p_center_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That time entry is gone. Reload the page' USING ERRCODE = 'P0002'; END IF;
  DELETE FROM time_entries WHERE id = e.id;
  INSERT INTO time_entry_log (center_id, entry_id, center_staff_id, action, before, reason, by_user)
  VALUES (p_center_id, e.id, e.center_staff_id, 'delete', to_jsonb(e), v_reason, auth.uid());
END $$;

-- Time off requests: waiting ones of any date, plus all that touch the range
CREATE OR REPLACE FUNCTION public.timeclock_off_list(p_center_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today date;
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  v_today := public.roster_today(p_center_id);
  RETURN COALESCE((
    SELECT jsonb_agg(public.timeclock_off_json(r) || jsonb_build_object('pto', CASE WHEN r.kind = 'pto' THEN public.timeclock_pto_balance(r.center_staff_id, r.start_date) END)
           ORDER BY (r.status = 'pending') DESC, r.start_date)
      FROM time_off_requests r
     WHERE r.center_id = p_center_id
       AND (r.status = 'pending' OR daterange(r.start_date, r.end_date, '[]') && daterange(p_from, p_to, '[]'))), '[]'::jsonb);
END $$;

-- An admin records time off for someone: approved right away (no balance check)
CREATE OR REPLACE FUNCTION public.timeclock_off_add(
  p_center_id uuid, p_center_staff_id uuid, p_kind text, p_start date, p_end date, p_full_day boolean, p_hours numeric, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  IF NOT EXISTS (SELECT 1 FROM center_staff WHERE id = p_center_staff_id AND center_id = p_center_id) THEN
    RAISE EXCEPTION 'This person does not work at your center' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.timeclock_off_create(p_center_staff_id, p_kind, p_start, p_end, p_full_day, p_hours, p_reason, 'admin', 'approved', false);
END $$;

-- Approve or deny a waiting request (approve may change the hours), or cancel an approved one
CREATE OR REPLACE FUNCTION public.timeclock_off_decide(p_center_id uuid, p_request_id uuid, p_decision text, p_hours numeric, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r time_off_requests%ROWTYPE; v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  PERFORM public.timeclock_admin_check(p_center_id);
  IF char_length(v_note) > 300 THEN RAISE EXCEPTION 'The note is 300 characters at most' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM time_off_requests WHERE id = p_request_id AND center_id = p_center_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That request is gone. Reload the page' USING ERRCODE = 'P0002'; END IF;
  IF p_decision = 'cancelled' THEN
    IF r.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'This request is already %', r.status USING ERRCODE = '22023'; END IF;
    UPDATE time_off_requests SET status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_note = v_note WHERE id = r.id;
    IF r.status = 'approved' THEN PERFORM public.timeclock_schedule_unmark(r.id); END IF;
    RETURN;
  END IF;
  IF p_decision NOT IN ('approved', 'denied') THEN RAISE EXCEPTION 'Approve or deny' USING ERRCODE = '22023'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request was already answered' USING ERRCODE = '22023'; END IF;
  IF p_hours IS NOT NULL AND (p_hours < 0 OR p_hours > 500) THEN RAISE EXCEPTION 'Hours have to be between 0 and 500' USING ERRCODE = '22023'; END IF;
  UPDATE time_off_requests SET status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = v_note,
         hours = CASE WHEN p_decision = 'approved' AND p_hours IS NOT NULL THEN p_hours ELSE hours END
   WHERE id = r.id;
  IF p_decision = 'approved' THEN PERFORM public.timeclock_schedule_mark(r.id); END IF;
END $$;

REVOKE ALL ON FUNCTION public.timeclock_admin_check(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.timeclock_overview(uuid), public.timeclock_settings_save(uuid, text, date, text, numeric, numeric),
  public.timeclock_pin_set(uuid, uuid, text), public.timeclock_pin_clear(uuid, uuid), public.timeclock_allowance_set(uuid, uuid, numeric),
  public.timeclock_device_register(uuid, text, text), public.timeclock_device_revoke(uuid, uuid), public.timeclock_entries(uuid, date, date),
  public.timeclock_entry_save(uuid, uuid, uuid, timestamptz, timestamptz, text), public.timeclock_entry_delete(uuid, uuid, text),
  public.timeclock_off_list(uuid, date, date), public.timeclock_off_add(uuid, uuid, text, date, date, boolean, numeric, text),
  public.timeclock_off_decide(uuid, uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_overview(uuid), public.timeclock_settings_save(uuid, text, date, text, numeric, numeric),
  public.timeclock_pin_set(uuid, uuid, text), public.timeclock_pin_clear(uuid, uuid), public.timeclock_allowance_set(uuid, uuid, numeric),
  public.timeclock_device_register(uuid, text, text), public.timeclock_device_revoke(uuid, uuid), public.timeclock_entries(uuid, date, date),
  public.timeclock_entry_save(uuid, uuid, uuid, timestamptz, timestamptz, text), public.timeclock_entry_delete(uuid, uuid, text),
  public.timeclock_off_list(uuid, date, date), public.timeclock_off_add(uuid, uuid, text, date, date, boolean, numeric, text),
  public.timeclock_off_decide(uuid, uuid, text, numeric, text) TO authenticated;

-- 6. Staff themselves (staff portal) -------------------------------------------------------------------------------

-- Each center with the Time Clock on where the caller works: PTO balance, requests, and entries since p_from
CREATE OR REPLACE FUNCTION public.timeclock_mine(p_from date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'center_id', c.id, 'center_name', c.name, 'center_staff_id', cs.id, 'today', public.roster_today(c.id),
             'timezone', COALESCE(NULLIF(c.timezone, ''), 'America/New_York'),
             'settings', (SELECT jsonb_build_object('pay_period', s.pay_period, 'period_anchor', s.period_anchor, 'full_day_hours', s.full_day_hours)
                            FROM public.timeclock_cfg(c.id) s),
             'pto', public.timeclock_pto_balance(cs.id, public.roster_today(c.id)),
             'requests', COALESCE((SELECT jsonb_agg(public.timeclock_off_json(r) ORDER BY r.start_date DESC)
                                     FROM (SELECT * FROM time_off_requests WHERE center_staff_id = cs.id
                                            ORDER BY start_date DESC LIMIT 30) r), '[]'::jsonb),
             'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'clock_in', e.clock_in, 'clock_out', e.clock_out,
                                                                      'missed_out', e.missed_out, 'edited', e.edited) ORDER BY e.clock_in DESC)
                                    FROM time_entries e WHERE e.center_staff_id = cs.id
                                     AND e.clock_in >= COALESCE(p_from, public.roster_today(c.id) - 31)::timestamp AT TIME ZONE COALESCE(NULLIF(c.timezone, ''), 'America/New_York')), '[]'::jsonb))
           ORDER BY c.name)
      FROM center_staff cs JOIN staff_profiles sp ON sp.id = cs.staff_id JOIN centers c ON c.id = cs.center_id
     WHERE sp.user_id = auth.uid() AND cs.status = 'active' AND c.timeclock_enabled AND c.is_active), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.timeclock_my_staff(p_center_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  SELECT cs.id INTO v FROM center_staff cs JOIN staff_profiles sp ON sp.id = cs.staff_id JOIN centers c ON c.id = cs.center_id
   WHERE sp.user_id = auth.uid() AND cs.center_id = p_center_id AND cs.status = 'active' AND c.timeclock_enabled AND c.is_active;
  IF v IS NULL THEN RAISE EXCEPTION 'The Time Clock is not turned on for you at this center' USING ERRCODE = '42501'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.timeclock_my_staff(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.timeclock_my_request(
  p_center_id uuid, p_kind text, p_start date, p_end date, p_full_day boolean, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.timeclock_off_create(public.timeclock_my_staff(p_center_id), p_kind, p_start, p_end, p_full_day, NULL, p_reason, 'portal', 'pending', true);
END $$;

CREATE OR REPLACE FUNCTION public.timeclock_my_cancel(p_center_id uuid, p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE time_off_requests SET status = 'cancelled', decided_at = now(), decision_note = 'Cancelled by the employee'
   WHERE id = p_request_id AND center_staff_id = public.timeclock_my_staff(p_center_id) AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a request still waiting for an answer can be cancelled. Ask the office for others' USING ERRCODE = '22023'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.timeclock_mine(date), public.timeclock_my_request(uuid, text, date, date, boolean, text),
  public.timeclock_my_cancel(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeclock_mine(date), public.timeclock_my_request(uuid, text, date, date, boolean, text),
  public.timeclock_my_cancel(uuid, uuid) TO authenticated;

-- 7. Someone leaving the center: their PIN stops working right away (timeclock_auth checks status = 'active');
--    their entries and requests stay for payroll records.

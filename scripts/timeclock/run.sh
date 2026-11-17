#!/bin/sh
# Database tests for the Time Clock on a throwaway local Postgres: sh scripts/timeclock/run.sh
set -e
DB=tc_test_$$
createdb "$DB"
trap 'dropdb "$DB"' EXIT
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" \
  -f scripts/schedule/stub.sql -f scripts/schedule/daily-stub.sql \
  -f supabase/migrations/20270101000000_staff_schedules.sql -f supabase/migrations/20270101010000_schedule_days.sql \
  -f supabase/migrations/20270101020000_schedule_teacher.sql -f supabase/migrations/20270101030000_fixed_schedule_window.sql \
  -f supabase/migrations/20270101040000_schedule_breaks.sql -f supabase/migrations/20270101050000_schedule_break_unpaid.sql \
  -f scripts/timeclock/stub.sql -f supabase/migrations/20270120000000_time_clock.sql \
  -f scripts/timeclock/timeclock.test.sql

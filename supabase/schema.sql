-- =============================================================
-- CareLocal Database Schema
-- Run this in Supabase SQL Editor to initialize the database
-- =============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- =============================================================
-- ENUMS
-- =============================================================
create type subscription_tier as enum ('starter', 'growth', 'network', 'enterprise');
create type subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'paused');
create type staff_type as enum ('teacher', 'floater', 'support', 'cook');
create type center_staff_status as enum ('invited', 'active', 'inactive', 'removed');
create type document_category as enum ('identity', 'certification', 'background', 'training', 'medical', 'other');
create type doc_review_status as enum ('missing', 'pending_review', 'accepted', 'rejected', 'expired');
create type shift_status as enum ('open', 'filled', 'cancelled');
create type claim_status as enum ('pending', 'confirmed', 'cancelled');
create type notification_channel as enum ('sms', 'email', 'push');
create type notification_status as enum ('sent', 'delivered', 'failed', 'bounced');

-- =============================================================
-- CENTERS (tenants)
-- =============================================================
create table centers (
  id uuid primary key default uuid_generate_v4(),
  slug text unique not null,
  name text not null,
  address text,
  city text not null default 'Charlotte',
  state text not null default 'NC',
  zip text,
  phone text,
  email text,
  director_name text,
  license_number text,
  max_capacity int,
  logo_url text,
  -- Subscription
  subscription_tier subscription_tier not null default 'starter',
  subscription_status subscription_status not null default 'trialing',
  stripe_customer_id text unique,
  trial_ends_at timestamptz,
  -- Meta
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================
-- SUBSCRIPTIONS
-- =============================================================
create table subscriptions (
  id uuid primary key default uuid_generate_v4(),
  center_id uuid not null references centers(id) on delete cascade,
  tier subscription_tier not null,
  status subscription_status not null,
  stripe_subscription_id text unique,
  stripe_price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================
-- STAFF PROFILES (free accounts — belong to the user, not a center)
-- =============================================================
create table staff_profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  first_name text not null,
  last_name text not null,
  phone text,
  email text not null,
  city text,
  state text,
  zip text,
  staff_type staff_type not null,
  bio text,
  -- Availability
  available_days text[] default '{}',   -- e.g. ['monday','tuesday','friday']
  available_from time,                  -- e.g. 07:00
  available_to time,                    -- e.g. 18:00
  -- Profile
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================
-- CENTER <-> STAFF RELATIONSHIP
-- =============================================================
create table center_staff (
  id uuid primary key default uuid_generate_v4(),
  center_id uuid not null references centers(id) on delete cascade,
  staff_id uuid not null references staff_profiles(id) on delete cascade,
  status center_staff_status not null default 'invited',
  is_preferred boolean default false,   -- center marks go-to people
  invite_token text unique,             -- used for invite-link flow
  invite_expires_at timestamptz,
  added_by uuid references auth.users(id),
  notes text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(center_id, staff_id)
);

-- =============================================================
-- STAFF DOCUMENTS (owned by staff, portable across centers)
-- =============================================================
create table staff_documents (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid not null references staff_profiles(id) on delete cascade,
  document_name text not null,           -- e.g. "CPR Certification"
  document_category document_category not null default 'other',
  issued_date date,
  expiry_date date,
  file_url text not null,                -- R2 signed URL
  file_name text,                        -- original filename
  file_size_bytes bigint,
  notes text,                            -- staff adds context
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================
-- CENTER DOCUMENT REQUIREMENTS (center-defined checklist)
-- =============================================================
create table center_document_requirements (
  id uuid primary key default uuid_generate_v4(),
  center_id uuid not null references centers(id) on delete cascade,
  document_name text not null,
  is_required boolean not null default true,
  applies_to staff_type[],              -- null = applies to all staff types
  notes text,                            -- center's internal note
  sort_order int default 0,
  created_at timestamptz not null default now()
);

-- =============================================================
-- CENTER STAFF DOCUMENT STATUS
-- Center's review of each staff member's documents
-- =============================================================
create table center_staff_document_status (
  id uuid primary key default uuid_generate_v4(),
  center_id uuid not null references centers(id) on delete cascade,
  staff_id uuid not null references staff_profiles(id) on delete cascade,
  requirement_id uuid not null references center_document_requirements(id) on delete cascade,
  matched_document_id uuid references staff_documents(id) on delete set null,
  status doc_review_status not null default 'missing',
  center_reviewed boolean default false,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text,
  updated_at timestamptz not null default now(),
  unique(center_id, staff_id, requirement_id)
);

-- =============================================================
-- CLASSROOMS
-- =============================================================
create table classrooms (
  id uuid primary key default uuid_generate_v4(),
  center_id uuid not null references centers(id) on delete cascade,
  name text not null,                    -- e.g. "Toddler Room A"
  age_group text,                        -- e.g. "2-3 years"
  capacity int,
  notes text,
  is_active boolean default true,
  created_at timestamptz not null default now()
);

-- =============================================================
-- SHIFTS
-- =============================================================
create table shifts (
  id uuid primary key default uuid_generate_v4(),
  center_id uuid not null references centers(id) on delete cascade,
  classroom_id uuid references classrooms(id) on delete set null,
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  staff_type_needed staff_type,          -- null = any type
  require_docs_complete boolean default false,
  status shift_status not null default 'open',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================
-- SHIFT CLAIMS
-- =============================================================
create table shift_claims (
  id uuid primary key default uuid_generate_v4(),
  shift_id uuid not null references shifts(id) on delete cascade,
  staff_id uuid not null references staff_profiles(id) on delete cascade,
  status claim_status not null default 'pending',
  claimed_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  unique(shift_id, staff_id)
);

-- =============================================================
-- NOTIFICATIONS LOG
-- =============================================================
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  center_id uuid references centers(id) on delete set null,
  shift_id uuid references shifts(id) on delete set null,
  staff_id uuid references staff_profiles(id) on delete set null,
  channel notification_channel not null,
  subject text,
  body text,
  status notification_status not null default 'sent',
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  error_message text
);

-- =============================================================
-- CENTER ADMINS (which auth users manage which centers)
-- =============================================================
create table center_admins (
  id uuid primary key default uuid_generate_v4(),
  center_id uuid not null references centers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin',    -- 'owner' | 'admin' | 'staff_admin'
  created_at timestamptz not null default now(),
  unique(center_id, user_id)
);

-- =============================================================
-- UPDATED_AT TRIGGER
-- =============================================================
create or replace function handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on centers
  for each row execute procedure handle_updated_at();
create trigger set_updated_at before update on subscriptions
  for each row execute procedure handle_updated_at();
create trigger set_updated_at before update on staff_profiles
  for each row execute procedure handle_updated_at();
create trigger set_updated_at before update on center_staff
  for each row execute procedure handle_updated_at();
create trigger set_updated_at before update on staff_documents
  for each row execute procedure handle_updated_at();
create trigger set_updated_at before update on center_staff_document_status
  for each row execute procedure handle_updated_at();
create trigger set_updated_at before update on shifts
  for each row execute procedure handle_updated_at();

-- =============================================================
-- ROW LEVEL SECURITY
-- =============================================================

-- Centers: only center admins can read/write their own center
alter table centers enable row level security;
create policy "Center admins can view their center"
  on centers for select
  using (
    id in (select center_id from center_admins where user_id = auth.uid())
  );
create policy "Center admins can update their center"
  on centers for update
  using (
    id in (select center_id from center_admins where user_id = auth.uid())
  );

-- Center admins table
alter table center_admins enable row level security;
create policy "Users can see their own admin records"
  on center_admins for select
  using (user_id = auth.uid());

-- Staff profiles: visible to the owner and any center they belong to
alter table staff_profiles enable row level security;
create policy "Staff can view and edit their own profile"
  on staff_profiles for all
  using (user_id = auth.uid());
create policy "Center admins can view their center's staff profiles"
  on staff_profiles for select
  using (
    id in (
      select cs.staff_id from center_staff cs
      join center_admins ca on ca.center_id = cs.center_id
      where ca.user_id = auth.uid() and cs.status = 'active'
    )
  );

-- Center staff relationship
alter table center_staff enable row level security;
create policy "Staff can see their own center relationships"
  on center_staff for select
  using (
    staff_id in (select id from staff_profiles where user_id = auth.uid())
  );
create policy "Center admins can manage center staff"
  on center_staff for all
  using (
    center_id in (select center_id from center_admins where user_id = auth.uid())
  );

-- Documents: staff owns, centers with active relationship can view
alter table staff_documents enable row level security;
create policy "Staff can manage their own documents"
  on staff_documents for all
  using (
    staff_id in (select id from staff_profiles where user_id = auth.uid())
  );
create policy "Center admins can view documents of their active staff"
  on staff_documents for select
  using (
    staff_id in (
      select cs.staff_id from center_staff cs
      join center_admins ca on ca.center_id = cs.center_id
      where ca.user_id = auth.uid() and cs.status = 'active'
    )
  );

-- Shifts: center admins read/write, active staff can read
alter table shifts enable row level security;
create policy "Center admins can manage shifts"
  on shifts for all
  using (
    center_id in (select center_id from center_admins where user_id = auth.uid())
  );
create policy "Active staff can read open shifts for their centers"
  on shifts for select
  using (
    center_id in (
      select cs.center_id from center_staff cs
      join staff_profiles sp on sp.id = cs.staff_id
      where sp.user_id = auth.uid() and cs.status = 'active'
    )
    and status = 'open'
  );

-- Shift claims
alter table shift_claims enable row level security;
create policy "Staff can manage their own claims"
  on shift_claims for all
  using (
    staff_id in (select id from staff_profiles where user_id = auth.uid())
  );
create policy "Center admins can view claims for their shifts"
  on shift_claims for select
  using (
    shift_id in (
      select id from shifts where center_id in (
        select center_id from center_admins where user_id = auth.uid()
      )
    )
  );
create policy "Center admins can confirm or cancel claims"
  on shift_claims for update
  using (
    shift_id in (
      select id from shifts where center_id in (
        select center_id from center_admins where user_id = auth.uid()
      )
    )
  );

-- =============================================================
-- INDEXES for performance
-- =============================================================
create index idx_center_staff_center on center_staff(center_id);
create index idx_center_staff_staff on center_staff(staff_id);
create index idx_shifts_center_date on shifts(center_id, shift_date);
create index idx_shifts_status on shifts(status);
create index idx_shift_claims_shift on shift_claims(shift_id);
create index idx_staff_docs_staff on staff_documents(staff_id);
create index idx_notifications_sent_at on notifications(sent_at desc);

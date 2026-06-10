-- Notifications table for in-app alerts
create table if not exists public.app_notifications (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users(id) on delete cascade not null,
    title text not null,
    message text not null,
    type text not null, -- e.g., 'shift_posted', 'shift_assigned'
    reference_id uuid, -- e.g. the shift_id
    is_read boolean default false not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Notification preferences table (defaulting to true for email/app, false for sms to save money unless opted in)
create table if not exists public.notification_preferences (
    user_id uuid references auth.users(id) on delete cascade primary key,
    email_enabled boolean default true not null,
    sms_enabled boolean default false not null,
    app_enabled boolean default true not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Function to automatically create preferences when a user signs up
create or replace function public.handle_new_user_preferences()
returns trigger as $$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to create preferences on user creation
create trigger on_auth_user_created_preferences
  after insert on auth.users
  for each row execute procedure public.handle_new_user_preferences();

-- RLS
alter table public.app_notifications enable row level security;
alter table public.notification_preferences enable row level security;

-- Users can read their own notifications
create policy "Users can view own notifications"
    on public.app_notifications for select
    using (auth.uid() = user_id);

-- Users can update (mark as read) their own notifications
create policy "Users can update own notifications"
    on public.app_notifications for update
    using (auth.uid() = user_id);

-- Users can view their own preferences
create policy "Users can view own preferences"
    on public.notification_preferences for select
    using (auth.uid() = user_id);

-- Users can update their own preferences
create policy "Users can update own preferences"
    on public.notification_preferences for update
    using (auth.uid() = user_id);

-- Service role can do anything
create policy "Service role has full access to notifications"
    on public.app_notifications for all
    using (true)
    with check (true);

create policy "Service role has full access to notification_preferences"
    on public.notification_preferences for all
    using (true)
    with check (true);

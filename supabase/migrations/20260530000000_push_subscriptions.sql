-- Create push subscriptions table
create table if not exists public.push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.push_subscriptions enable row level security;

-- Policies
drop policy if exists "Users can manage their own push subscriptions" on public.push_subscriptions;
create policy "Users can manage their own push subscriptions"
    on public.push_subscriptions for all
    using (auth.uid() = user_id);

drop policy if exists "Service role has full access to push subscriptions" on public.push_subscriptions;
create policy "Service role has full access to push subscriptions"
    on public.push_subscriptions for all
    using (true)
    with check (true);

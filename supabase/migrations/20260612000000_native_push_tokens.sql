-- Create native push tokens table
create table if not exists public.native_push_tokens (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  token text unique not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.native_push_tokens enable row level security;

-- Policies
drop policy if exists "Users can manage their own native push tokens" on public.native_push_tokens;
create policy "Users can manage their own native push tokens"
    on public.native_push_tokens for all
    using (auth.uid() = user_id);

drop policy if exists "Service role has full access to native push tokens" on public.native_push_tokens;
create policy "Service role has full access to native push tokens"
    on public.native_push_tokens for all
    using (true)
    with check (true);

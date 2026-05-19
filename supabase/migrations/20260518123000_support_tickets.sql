create table if not exists public.support_tickets (
    id uuid default gen_random_uuid() primary key,
    center_id uuid references public.centers(id) on delete cascade not null,
    created_by uuid references auth.users(id) on delete set null,
    subject text not null,
    description text not null,
    status text not null default 'open',
    priority text not null default 'medium',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS
alter table public.support_tickets enable row level security;

-- Center admins can view their own tickets
create policy "Center admins can view their center's tickets"
    on public.support_tickets for select
    using (center_id in (select center_id from public.center_admins where user_id = auth.uid()));

-- Center admins can create tickets for their center
create policy "Center admins can create tickets"
    on public.support_tickets for insert
    with check (center_id in (select center_id from public.center_admins where user_id = auth.uid()));

-- Super admins can view all tickets
create policy "Super admins can view all tickets"
    on public.support_tickets for select
    using (exists (select 1 from public.super_admins where user_id = auth.uid()));

-- Super admins can update tickets
create policy "Super admins can update tickets"
    on public.support_tickets for update
    using (exists (select 1 from public.super_admins where user_id = auth.uid()));

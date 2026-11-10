-- Run once in the Supabase SQL editor for Steam Ballot.
begin;

create table if not exists public.steamballot_bhof (
  app_id text primary key check (app_id ~ '^[0-9]+$'),
  title text not null,
  image_url text not null default '',
  hall_of_famed_on date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.steamballot_bhof enable row level security;

grant select, insert on public.steamballot_bhof to anon, authenticated;

drop policy if exists "BHOF is readable" on public.steamballot_bhof;
create policy "BHOF is readable" on public.steamballot_bhof
  for select to anon, authenticated using (true);

drop policy if exists "BHOF games can be added" on public.steamballot_bhof;
create policy "BHOF games can be added" on public.steamballot_bhof
  for insert to anon, authenticated with check (true);

commit;

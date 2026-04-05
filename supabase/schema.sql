-- Sprinttag App Schema + Policies
-- Im Supabase SQL Editor ausführen.

create table if not exists public.categories (
  id bigint generated always as identity primary key,
  name text not null,
  gender text not null check (gender in ('male', 'female')),
  min_birth_year integer,
  max_birth_year integer,
  distance integer not null check (distance in (60, 80, 100)),
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id bigint generated always as identity primary key,
  name text not null,
  gender text not null check (gender in ('male', 'female')),
  birth_year integer,
  start_number integer unique,
  category_id bigint references public.categories(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.blocked_start_numbers (
  id bigint generated always as identity primary key,
  number integer not null unique check (number > 0),
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.heats (
  id bigint generated always as identity primary key,
  category_id bigint not null references public.categories(id) on delete cascade,
  round_number integer not null default 1,
  round_name text not null default '1. Lauf',
  heat_number integer not null,
  created_at timestamptz not null default now(),
  unique(category_id, round_number, heat_number)
);

create table if not exists public.heat_entries (
  id bigint generated always as identity primary key,
  heat_id bigint not null references public.heats(id) on delete cascade,
  participant_id bigint not null references public.participants(id) on delete cascade,
  lane_or_position integer,
  unique(heat_id, participant_id)
);

create table if not exists public.results (
  id bigint generated always as identity primary key,
  heat_id bigint not null references public.heats(id) on delete cascade,
  participant_id bigint not null references public.participants(id) on delete cascade,
  time_value numeric(6,2) not null check (time_value > 0),
  created_at timestamptz not null default now(),
  unique(heat_id, participant_id)
);

-- Admin-Whitelist (Supabase Auth User IDs)
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

-- Startnummern automatisch vergeben und gesperrte Nummern überspringen
create or replace function public.assign_next_start_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate integer := 1;
begin
  if new.start_number is not null then
    return new;
  end if;

  loop
    exit when not exists (
      select 1 from public.participants p where p.start_number = candidate
    )
    and not exists (
      select 1 from public.blocked_start_numbers b where b.number = candidate
    );

    candidate := candidate + 1;
  end loop;

  new.start_number := candidate;
  return new;
end;
$$;

drop trigger if exists participants_assign_number on public.participants;
create trigger participants_assign_number
before insert on public.participants
for each row execute function public.assign_next_start_number();

alter table public.categories enable row level security;
alter table public.participants enable row level security;
alter table public.blocked_start_numbers enable row level security;
alter table public.heats enable row level security;
alter table public.heat_entries enable row level security;
alter table public.results enable row level security;
alter table public.admin_users enable row level security;

-- Participants: öffentliche Anmeldung erlaubt (nur neue Datensätze).
drop policy if exists participants_public_insert on public.participants;
create policy participants_public_insert
on public.participants
for insert
to anon, authenticated
with check (
  name is not null
  and gender in ('male', 'female')
  and category_id is null
  and start_number is null
);

-- Vollzugriff nur für Admins.
drop policy if exists participants_admin_select on public.participants;
create policy participants_admin_select on public.participants
for select using (public.is_admin());

drop policy if exists participants_admin_update on public.participants;
create policy participants_admin_update on public.participants
for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists participants_admin_delete on public.participants;
create policy participants_admin_delete on public.participants
for delete using (public.is_admin());

-- Alle restlichen Tabellen nur Admin.
drop policy if exists categories_admin_all on public.categories;
create policy categories_admin_all on public.categories
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists blocked_numbers_admin_all on public.blocked_start_numbers;
create policy blocked_numbers_admin_all on public.blocked_start_numbers
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists heats_admin_all on public.heats;
create policy heats_admin_all on public.heats
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists heat_entries_admin_all on public.heat_entries;
create policy heat_entries_admin_all on public.heat_entries
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists results_admin_all on public.results;
create policy results_admin_all on public.results
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_users_self_read on public.admin_users;
create policy admin_users_self_read on public.admin_users
for select using (public.is_admin());

-- Beispiel: ersten Admin nach Signup manuell setzen
-- insert into public.admin_users (user_id) values ('<SUPABASE_AUTH_USER_UUID>');

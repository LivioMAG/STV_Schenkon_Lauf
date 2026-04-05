-- Sprinttag App Schema + Policies
-- Im Supabase SQL Editor ausführen.

create table if not exists public.categories (
  id bigint generated always as identity primary key,
  name text not null,
  gender text not null check (gender in ('male', 'female')),
  min_age integer not null check (min_age >= 1),
  max_age integer not null check (max_age >= min_age),
  distance integer not null check (distance in (60, 80, 100)),
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id bigint generated always as identity primary key,
  last_name text not null,
  first_name text not null,
  gender text not null check (gender in ('male', 'female')),
  birth_year integer not null,
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
  category_id bigint references public.categories(id) on delete cascade,
  round_type text not null check (round_type in ('first_run', 'second_run', 'kings_run')),
  heat_number integer not null check (heat_number > 0),
  created_at timestamptz not null default now(),
  unique(category_id, round_type, heat_number)
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

-- Migrations for older schema versions
alter table public.categories add column if not exists min_age integer;
alter table public.categories add column if not exists max_age integer;

alter table public.participants add column if not exists last_name text;
alter table public.participants add column if not exists first_name text;

alter table public.heats add column if not exists round_type text;

do $$
begin
  -- Backfill from old birth-year based categories
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'categories'
      and column_name = 'max_birth_year'
  ) then
    execute $sql$
      update public.categories
      set min_age = greatest(1, extract(year from now())::int - max_birth_year)
      where min_age is null
        and max_birth_year is not null
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'categories'
      and column_name = 'min_birth_year'
  ) then
    execute $sql$
      update public.categories
      set max_age = greatest(1, extract(year from now())::int - min_birth_year)
      where max_age is null
        and min_birth_year is not null
    $sql$;
  end if;

  execute $sql$
    update public.categories
    set min_age = coalesce(min_age, 1),
        max_age = coalesce(max_age, greatest(coalesce(min_age, 1), 120))
  $sql$;

  -- Backfill first_name/last_name from legacy name field
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'participants'
      and column_name = 'name'
  ) then
    execute $sql$
      update public.participants
      set first_name = split_part(trim(name), ' ', 1)
      where first_name is null
    $sql$;

    execute $sql$
      update public.participants
      set last_name = nullif(trim(regexp_replace(trim(name), '^\S+\s*', '')), '')
      where last_name is null
    $sql$;
  end if;

  execute $sql$
    update public.participants
    set last_name = coalesce(last_name, first_name, 'Unbekannt'),
        first_name = coalesce(first_name, 'Unbekannt')
    where last_name is null
       or first_name is null
  $sql$;

  -- Round migration from legacy schema
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'heats'
      and column_name = 'round_number'
  ) then
    execute $sql$
      update public.heats
      set round_type = case
        when round_number = 1 then 'first_run'
        when round_number = 2 then 'second_run'
        when round_number = 99 then 'kings_run'
        else 'first_run'
      end
      where round_type is null
    $sql$;
  end if;
end $$;

-- Ensure constraints exist after migration
alter table public.categories alter column min_age set not null;
alter table public.categories alter column max_age set not null;

alter table public.categories drop constraint if exists categories_min_age_check;
alter table public.categories add constraint categories_min_age_check check (min_age >= 1);
alter table public.categories drop constraint if exists categories_max_age_check;
alter table public.categories add constraint categories_max_age_check check (max_age >= min_age);

alter table public.participants alter column last_name set not null;
alter table public.participants alter column first_name set not null;
alter table public.participants alter column birth_year set not null;

alter table public.heats alter column round_type set not null;
alter table public.heats drop constraint if exists heats_round_type_check;
alter table public.heats add constraint heats_round_type_check check (round_type in ('first_run', 'second_run', 'kings_run'));

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'categories'
      and column_name = 'min_birth_year'
  ) then
    alter table public.categories drop column min_birth_year;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'categories'
      and column_name = 'max_birth_year'
  ) then
    alter table public.categories drop column max_birth_year;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'participants'
      and column_name = 'name'
  ) then
    alter table public.participants drop column name;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'heats'
      and column_name = 'round_number'
  ) then
    alter table public.heats drop column round_number;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'heats'
      and column_name = 'round_name'
  ) then
    alter table public.heats drop column round_name;
  end if;
end $$;

create unique index if not exists heats_unique_round
on public.heats (coalesce(category_id, -1), round_type, heat_number);

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
    if exists (select 1 from public.blocked_start_numbers b where b.number = new.start_number) then
      raise exception 'Startnummer % ist gesperrt.', new.start_number;
    end if;
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

-- Allow authenticated users to read auth role info through the secure function only.
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- Explicit grants prevent "permission denied for public schema" before RLS evaluation.
grant usage on schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

grant select, insert, update, delete on public.participants to authenticated;
grant insert (last_name, first_name, gender, birth_year) on public.participants to anon;

grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.blocked_start_numbers to authenticated;
grant select, insert, update, delete on public.heats to authenticated;
grant select, insert, update, delete on public.heat_entries to authenticated;
grant select, insert, update, delete on public.results to authenticated;
grant select on public.admin_users to authenticated;

alter table public.categories enable row level security;
alter table public.participants enable row level security;
alter table public.blocked_start_numbers enable row level security;
alter table public.heats enable row level security;
alter table public.heat_entries enable row level security;
alter table public.results enable row level security;
alter table public.admin_users enable row level security;

-- Participants: öffentliche Anmeldung erlaubt (ohne Login)
drop policy if exists participants_public_insert on public.participants;
create policy participants_public_insert
on public.participants
for insert
to anon, authenticated
with check (
  last_name is not null
  and first_name is not null
  and gender in ('male', 'female')
  and birth_year between 1900 and extract(year from now())::int
  and category_id is null
);

-- Admin can perform all participant operations.
drop policy if exists participants_admin_select on public.participants;
create policy participants_admin_select on public.participants
for select using (public.is_admin());

drop policy if exists participants_admin_insert on public.participants;
create policy participants_admin_insert on public.participants
for insert with check (public.is_admin());

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

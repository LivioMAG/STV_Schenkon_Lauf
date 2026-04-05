-- STV Schenkon Lauf - Vollständiges Schema OHNE RLS-Policies
-- Basierend auf schema.sql, aber mit deaktivierter Row Level Security.

-- Sprinttag App Schema ohne RLS
-- Im Supabase SQL Editor ausführen.

create table if not exists public.categories (
  id bigint generated always as identity primary key,
  name text not null,
  gender_mode text not null default 'male' check (gender_mode in ('male', 'female', 'mixed')),
  min_age integer not null check (min_age >= 1),
  max_age integer not null check (max_age >= min_age),
  distance integer not null check (distance in (60, 80, 100)),
  has_run_1 boolean not null default true,
  has_run_2 boolean not null default true,
  has_kings_run boolean not null default true,
  created_at timestamptz not null default now(),
  constraint categories_runs_valid check (has_run_1 = true and (not has_kings_run or has_run_2))
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
alter table public.categories add column if not exists gender_mode text;
alter table public.categories add column if not exists has_run_1 boolean;
alter table public.categories add column if not exists has_run_2 boolean;
alter table public.categories add column if not exists has_kings_run boolean;

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
        max_age = coalesce(max_age, greatest(coalesce(min_age, 1), 120)),
        gender_mode = coalesce(gender_mode, (to_jsonb(categories)->>'gender'), 'male'),
        has_run_1 = coalesce(has_run_1, true),
        has_run_2 = coalesce(has_run_2, true),
        has_kings_run = coalesce(has_kings_run, true)
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
alter table public.categories alter column gender_mode set not null;
alter table public.categories alter column has_run_1 set not null;
alter table public.categories alter column has_run_2 set not null;
alter table public.categories alter column has_kings_run set not null;
alter table public.categories alter column gender_mode set default 'male';
alter table public.categories alter column has_run_1 set default true;
alter table public.categories alter column has_run_2 set default true;
alter table public.categories alter column has_kings_run set default true;

alter table public.categories drop constraint if exists categories_min_age_check;
alter table public.categories add constraint categories_min_age_check check (min_age >= 1);
alter table public.categories drop constraint if exists categories_max_age_check;
alter table public.categories add constraint categories_max_age_check check (max_age >= min_age);
alter table public.categories drop constraint if exists categories_gender_mode_check;
alter table public.categories add constraint categories_gender_mode_check check (gender_mode in ('male', 'female', 'mixed'));
alter table public.categories drop constraint if exists categories_runs_valid;
alter table public.categories add constraint categories_runs_valid check (has_run_1 = true and (not has_kings_run or has_run_2));

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
      and table_name = 'categories'
      and column_name = 'gender'
  ) then
    alter table public.categories drop column gender;
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


create or replace function public.validate_result_round_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  category_record record;
  heat_round text;
begin
  select h.round_type, c.has_run_1, c.has_run_2, c.has_kings_run
    into heat_round, category_record.has_run_1, category_record.has_run_2, category_record.has_kings_run
  from public.heats h
  join public.categories c on c.id = h.category_id
  where h.id = new.heat_id;

  if heat_round is null then
    raise exception 'Heat % hat keine gültige Kategorie.', new.heat_id;
  end if;

  if (heat_round = 'first_run' and not category_record.has_run_1)
     or (heat_round = 'second_run' and not category_record.has_run_2)
     or (heat_round = 'kings_run' and not category_record.has_kings_run) then
    raise exception 'Lauf % ist für diese Kategorie deaktiviert.', heat_round;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_result_round_allowed on public.results;
create trigger trg_validate_result_round_allowed
before insert or update on public.results
for each row
execute function public.validate_result_round_allowed();

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

alter table public.categories disable row level security;
alter table public.participants disable row level security;
alter table public.blocked_start_numbers disable row level security;
alter table public.heats disable row level security;
alter table public.heat_entries disable row level security;
alter table public.results disable row level security;
alter table public.admin_users disable row level security;

alter table public.categories no force row level security;
alter table public.participants no force row level security;
alter table public.blocked_start_numbers no force row level security;
alter table public.heats no force row level security;
alter table public.heat_entries no force row level security;
alter table public.results no force row level security;
alter table public.admin_users no force row level security;

-- Beispiel: ersten Admin nach Signup manuell setzen
-- insert into public.admin_users (user_id) values ('<SUPABASE_AUTH_USER_UUID>');

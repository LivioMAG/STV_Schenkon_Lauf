-- STV Schenkon Lauf - Update/Migration Script
-- Für bestehende Projekte im Supabase SQL Editor ausführen.

-- 1) Admin-Funktion auf strikte Whitelist über admin_users setzen
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

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 1b) Teilnehmer um separates Alter-Feld ergänzen (falls noch nicht vorhanden)
alter table public.participants add column if not exists age integer;

update public.participants
set age = greatest(1, extract(year from now())::int - birth_year)
where age is null
  and birth_year is not null;

alter table public.participants alter column age set not null;
alter table public.participants drop constraint if exists participants_age_check;
alter table public.participants add constraint participants_age_check check (age between 1 and 120);

-- 2) Tabellenrechte und RLS-Policies für Admin-Tabellen sicherstellen
grant usage on schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

grant select, insert, update, delete on public.participants to anon, authenticated;

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

drop policy if exists participants_public_insert on public.participants;
create policy participants_public_insert
on public.participants
for insert
to anon, authenticated
with check (
  last_name is not null
  and first_name is not null
  and gender in ('male', 'female')
  and age between 1 and 120
  and birth_year between 1900 and extract(year from now())::int
  and category_id is null
);

drop policy if exists participants_public_select on public.participants;
create policy participants_public_select
on public.participants
for select
to anon, authenticated
using (true);

drop policy if exists participants_public_update on public.participants;
create policy participants_public_update
on public.participants
for update
to anon, authenticated
using (true)
with check (
  last_name is not null
  and first_name is not null
  and gender in ('male', 'female')
  and age between 1 and 120
  and birth_year between 1900 and extract(year from now())::int
);

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

-- 3) WICHTIG: mindestens einen Admin in Whitelist eintragen
-- E-Mail anpassen und ausführen:
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'admin@example.com'
-- on conflict (user_id) do nothing;

-- STV Schenkon Lauf - RLS komplett deaktivieren
-- Im Supabase SQL Editor ausführen.

-- Optional: vorhandene Policies entfernen, damit das Setup klar bleibt.
drop policy if exists participants_public_insert on public.participants;
drop policy if exists participants_admin_select on public.participants;
drop policy if exists participants_admin_insert on public.participants;
drop policy if exists participants_admin_update on public.participants;
drop policy if exists participants_admin_delete on public.participants;

drop policy if exists categories_admin_all on public.categories;
drop policy if exists blocked_numbers_admin_all on public.blocked_start_numbers;
drop policy if exists heats_admin_all on public.heats;
drop policy if exists heat_entries_admin_all on public.heat_entries;
drop policy if exists results_admin_all on public.results;
drop policy if exists admin_users_self_read on public.admin_users;

-- RLS auf allen relevanten Tabellen deaktivieren.
alter table public.categories disable row level security;
alter table public.participants disable row level security;
alter table public.blocked_start_numbers disable row level security;
alter table public.heats disable row level security;
alter table public.heat_entries disable row level security;
alter table public.results disable row level security;
alter table public.admin_users disable row level security;

-- Falls force row level security gesetzt wurde, ebenfalls ausschalten.
alter table public.categories no force row level security;
alter table public.participants no force row level security;
alter table public.blocked_start_numbers no force row level security;
alter table public.heats no force row level security;
alter table public.heat_entries no force row level security;
alter table public.results no force row level security;
alter table public.admin_users no force row level security;

-- Wichtig: Ohne RLS gelten nur noch GRANT/REVOKE-Rechte.

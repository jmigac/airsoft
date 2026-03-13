alter table public.games
add column if not exists name text not null default 'Untitled Game',
add column if not exists description text,
add column if not exists status text not null default 'active',
add column if not exists map_reference text,
add column if not exists creation_metadata jsonb not null default '{}'::jsonb;

alter table public.games
drop constraint if exists games_status_check;

alter table public.games
add constraint games_status_check
check (status in ('draft', 'scheduled', 'active', 'paused', 'completed', 'archived'));

create index if not exists idx_games_status_created_at on public.games(status, created_at desc);

alter table public.map_markers
add column if not exists description text,
add column if not exists icon text,
add column if not exists updated_at timestamptz not null default timezone('utc', now()),
add column if not exists visibility_scope text not null default 'all',
add column if not exists visibility_teams text[];

alter table public.map_markers
drop constraint if exists map_markers_type_check;

alter table public.map_markers
add constraint map_markers_type_check
check (
  type is null or type in (
    'village',
    'north_spawn',
    'south_spawn',
    'house',
    'objective',
    'checkpoint',
    'spawn_point',
    'extraction_point',
    'danger_zone',
    'custom'
  )
);

alter table public.map_markers
drop constraint if exists map_markers_visibility_scope_check;

alter table public.map_markers
add constraint map_markers_visibility_scope_check
check (visibility_scope in ('all', 'admins', 'selected_teams'));

create or replace function public.set_map_markers_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_map_markers_updated_at on public.map_markers;
create trigger trg_map_markers_updated_at
before update on public.map_markers
for each row
execute function public.set_map_markers_updated_at();

create table if not exists public.admin_audit_log (
  id text primary key,
  action text not null,
  entity_type text not null,
  entity_id text,
  game_code text references public.games(code) on delete set null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_admin_audit_log_created_at on public.admin_audit_log(created_at desc);
create index if not exists idx_admin_audit_log_game_code on public.admin_audit_log(game_code, created_at desc);

grant select, insert, update, delete on table public.admin_audit_log to service_role;

alter table public.admin_audit_log enable row level security;

drop policy if exists "admin_audit_log_service_role_all" on public.admin_audit_log;
create policy "admin_audit_log_service_role_all"
on public.admin_audit_log
for all
to service_role
using (true)
with check (true);

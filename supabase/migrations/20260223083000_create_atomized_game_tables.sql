create table if not exists public.games (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  default_map_center_lat double precision,
  default_map_center_lng double precision,
  version bigint not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_games_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_games_updated_at on public.games;
create trigger trg_games_updated_at
before update on public.games
for each row
execute function public.set_games_updated_at();

create table if not exists public.missions (
  id text primary key,
  game_code text not null references public.games(code) on delete cascade,
  name text not null,
  qr_code text not null,
  map_center_lat double precision,
  map_center_lng double precision,
  time_window_starts_at_cet text,
  time_window_ends_at_cet text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (game_code, qr_code)
);

create table if not exists public.mission_locations (
  id text primary key,
  game_code text not null references public.games(code) on delete cascade,
  mission_id text not null references public.missions(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  radius double precision not null check (radius > 0),
  sort_order integer not null default 0
);

create table if not exists public.completions (
  id text primary key,
  game_code text not null references public.games(code) on delete cascade,
  mission_id text not null references public.missions(id) on delete cascade,
  team text not null check (team in ('red', 'blue')),
  qr_code text not null,
  completed_at timestamptz not null,
  unique (game_code, mission_id, team)
);

create table if not exists public.players (
  id text primary key,
  game_code text not null references public.games(code) on delete cascade,
  session_id text not null,
  nickname text not null,
  nickname_key text not null,
  team text not null check (team in ('red', 'blue')),
  joined_at timestamptz not null,
  last_seen_at timestamptz not null,
  location_lat double precision,
  location_lng double precision,
  location_accuracy double precision,
  location_updated_at timestamptz,
  unique (game_code, session_id),
  unique (game_code, nickname_key)
);

create table if not exists public.map_markers (
  id text primary key,
  game_code text not null references public.games(code) on delete cascade,
  type text,
  name text not null,
  color text not null,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default timezone('utc', now()),
  check (type is null or type in ('village', 'north_spawn', 'south_spawn', 'house'))
);

create table if not exists public.map_shapes (
  id text primary key,
  game_code text not null references public.games(code) on delete cascade,
  label text not null,
  color text not null,
  opacity double precision not null check (opacity >= 0 and opacity <= 1),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.map_shape_points (
  shape_id text not null references public.map_shapes(id) on delete cascade,
  game_code text not null references public.games(code) on delete cascade,
  point_index integer not null,
  lat double precision not null,
  lng double precision not null,
  primary key (shape_id, point_index)
);

create table if not exists public.map_signals (
  id text primary key,
  game_code text not null references public.games(code) on delete cascade,
  type text not null check (type in ('info', 'danger', 'intel')),
  team text not null check (team in ('red', 'blue')),
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists idx_missions_game_code on public.missions(game_code);
create index if not exists idx_mission_locations_game_code_mission on public.mission_locations(game_code, mission_id, sort_order);
create index if not exists idx_completions_game_code on public.completions(game_code, completed_at);
create index if not exists idx_players_game_code on public.players(game_code, last_seen_at);
create index if not exists idx_map_markers_game_code on public.map_markers(game_code, created_at);
create index if not exists idx_map_shapes_game_code on public.map_shapes(game_code, created_at);
create index if not exists idx_map_shape_points_game_code_shape on public.map_shape_points(game_code, shape_id, point_index);
create index if not exists idx_map_signals_game_code_expires on public.map_signals(game_code, expires_at);

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.games to service_role;
grant select, insert, update, delete on table public.missions to service_role;
grant select, insert, update, delete on table public.mission_locations to service_role;
grant select, insert, update, delete on table public.completions to service_role;
grant select, insert, update, delete on table public.players to service_role;
grant select, insert, update, delete on table public.map_markers to service_role;
grant select, insert, update, delete on table public.map_shapes to service_role;
grant select, insert, update, delete on table public.map_shape_points to service_role;
grant select, insert, update, delete on table public.map_signals to service_role;

alter table public.games enable row level security;
alter table public.missions enable row level security;
alter table public.mission_locations enable row level security;
alter table public.completions enable row level security;
alter table public.players enable row level security;
alter table public.map_markers enable row level security;
alter table public.map_shapes enable row level security;
alter table public.map_shape_points enable row level security;
alter table public.map_signals enable row level security;

drop policy if exists "games_service_role_all" on public.games;
create policy "games_service_role_all"
on public.games
for all
to service_role
using (true)
with check (true);

drop policy if exists "missions_service_role_all" on public.missions;
create policy "missions_service_role_all"
on public.missions
for all
to service_role
using (true)
with check (true);

drop policy if exists "mission_locations_service_role_all" on public.mission_locations;
create policy "mission_locations_service_role_all"
on public.mission_locations
for all
to service_role
using (true)
with check (true);

drop policy if exists "completions_service_role_all" on public.completions;
create policy "completions_service_role_all"
on public.completions
for all
to service_role
using (true)
with check (true);

drop policy if exists "players_service_role_all" on public.players;
create policy "players_service_role_all"
on public.players
for all
to service_role
using (true)
with check (true);

drop policy if exists "map_markers_service_role_all" on public.map_markers;
create policy "map_markers_service_role_all"
on public.map_markers
for all
to service_role
using (true)
with check (true);

drop policy if exists "map_shapes_service_role_all" on public.map_shapes;
create policy "map_shapes_service_role_all"
on public.map_shapes
for all
to service_role
using (true)
with check (true);

drop policy if exists "map_shape_points_service_role_all" on public.map_shape_points;
create policy "map_shape_points_service_role_all"
on public.map_shape_points
for all
to service_role
using (true)
with check (true);

drop policy if exists "map_signals_service_role_all" on public.map_signals;
create policy "map_signals_service_role_all"
on public.map_signals
for all
to service_role
using (true)
with check (true);

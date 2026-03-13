begin;

alter table public.missions
add column if not exists type text not null default 'qr_payload';

alter table public.missions
drop constraint if exists missions_type_check;

alter table public.missions
add constraint missions_type_check
check (type in ('qr_payload', 'intel_recovery'));

alter table public.missions
alter column qr_code drop not null;

alter table public.completions
add column if not exists method text not null default 'qr_payload';

alter table public.completions
drop constraint if exists completions_method_check;

alter table public.completions
add constraint completions_method_check
check (method in ('qr_payload', 'intel_recovery'));

alter table public.completions
alter column qr_code drop not null;

create table if not exists public.mission_intel_uploads (
  id text primary key,
  game_code text not null references public.games(code) on delete cascade,
  mission_id text not null references public.missions(id) on delete cascade,
  team text not null check (team in ('red', 'blue')),
  filename text not null,
  content_type text not null,
  data_url text not null,
  uploaded_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_mission_intel_uploads_game_code on public.mission_intel_uploads(game_code, uploaded_at);

grant select, insert, update, delete on table public.mission_intel_uploads to service_role;

alter table public.mission_intel_uploads enable row level security;

drop policy if exists "mission_intel_uploads_service_role_all" on public.mission_intel_uploads;
create policy "mission_intel_uploads_service_role_all"
on public.mission_intel_uploads
for all
to service_role
using (true)
with check (true);

commit;

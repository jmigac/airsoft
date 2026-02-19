create table if not exists public.game_state (
  id bigint primary key check (id = 1),
  state jsonb not null default '{"missions":[],"completions":[]}'::jsonb,
  version bigint not null default 1,
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_game_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_game_state_updated_at on public.game_state;
create trigger trg_game_state_updated_at
before update on public.game_state
for each row
execute function public.set_game_state_updated_at();

insert into public.game_state (id, state, version)
values (1, '{"missions":[],"completions":[]}'::jsonb, 1)
on conflict (id) do nothing;

alter table public.game_state enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.game_state to service_role;

drop policy if exists "game_state_service_role_all" on public.game_state;
create policy "game_state_service_role_all"
on public.game_state
for all
to service_role
using (true)
with check (true);

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  email text not null unique,
  role text not null default 'global_admin',
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.admin_users
drop constraint if exists admin_users_role_check;

alter table public.admin_users
add constraint admin_users_role_check
check (role in ('global_admin'));

create or replace function public.set_admin_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_admin_users_updated_at on public.admin_users;
create trigger trg_admin_users_updated_at
before update on public.admin_users
for each row
execute function public.set_admin_users_updated_at();

create index if not exists idx_admin_users_active on public.admin_users(active, role);

grant select, insert, update, delete on table public.admin_users to service_role;

alter table public.admin_users enable row level security;

drop policy if exists "admin_users_service_role_all" on public.admin_users;
create policy "admin_users_service_role_all"
on public.admin_users
for all
to service_role
using (true)
with check (true);

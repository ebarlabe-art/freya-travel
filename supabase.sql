create extension if not exists pgcrypto;

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10)),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  text text not null check (char_length(trim(text)) between 1 and 300),
  done boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.checklist_items enable row level security;

-- Helper functions run as the owner and avoid recursive RLS checks.
create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = auth.uid()
  );
$$;

revoke all on function public.is_trip_member(uuid) from public;
grant execute on function public.is_trip_member(uuid) to authenticated;

drop policy if exists "members can view trips" on public.trips;
create policy "members can view trips"
on public.trips for select to authenticated
using (public.is_trip_member(id));

drop policy if exists "members can view memberships" on public.trip_members;
create policy "members can view memberships"
on public.trip_members for select to authenticated
using (user_id = auth.uid() or public.is_trip_member(trip_id));

drop policy if exists "members can manage checklist" on public.checklist_items;
create policy "members can manage checklist"
on public.checklist_items for all to authenticated
using (public.is_trip_member(trip_id))
with check (public.is_trip_member(trip_id) and created_by = auth.uid());

create or replace function public.create_trip(p_name text)
returns table(id uuid, name text, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  if auth.uid() is null then raise exception 'Cal iniciar sessió'; end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'Escriu un nom per al viatge'; end if;
  if exists (select 1 from public.trip_members where user_id = auth.uid()) then
    raise exception 'Ja formes part d’un viatge';
  end if;

  insert into public.trips(name, owner_id)
  values (trim(p_name), auth.uid())
  returning * into v_trip;

  insert into public.trip_members(trip_id, user_id)
  values (v_trip.id, auth.uid());

  return query select v_trip.id, v_trip.name, v_trip.invite_code;
end;
$$;

create or replace function public.join_trip(p_invite_code text)
returns table(id uuid, name text, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  if auth.uid() is null then raise exception 'Cal iniciar sessió'; end if;
  if exists (select 1 from public.trip_members where user_id = auth.uid()) then
    raise exception 'Ja formes part d’un viatge';
  end if;

  select * into v_trip
  from public.trips
  where invite_code = upper(trim(p_invite_code));

  if v_trip.id is null then raise exception 'Codi incorrecte'; end if;

  insert into public.trip_members(trip_id, user_id)
  values (v_trip.id, auth.uid());

  return query select v_trip.id, v_trip.name, v_trip.invite_code;
end;
$$;

create or replace function public.get_my_trip()
returns table(id uuid, name text, invite_code text)
language sql
security definer
set search_path = public
as $$
  select t.id, t.name, t.invite_code
  from public.trips t
  join public.trip_members m on m.trip_id = t.id
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;
$$;

revoke all on function public.create_trip(text) from public;
revoke all on function public.join_trip(text) from public;
revoke all on function public.get_my_trip() from public;
grant execute on function public.create_trip(text) to authenticated;
grant execute on function public.join_trip(text) to authenticated;
grant execute on function public.get_my_trip() to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'checklist_items'
  ) then
    alter publication supabase_realtime add table public.checklist_items;
  end if;
end $$;

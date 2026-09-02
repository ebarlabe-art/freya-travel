-- LOCAL DEVELOPMENT ONLY.
-- Apply only with:
--   npx --yes supabase db query --local --file supabase/local/bootstrap_push_subscriptions.sql
-- This is deliberately not a migration and must never be applied to production.

begin;

do $$
declare
  local_user_id uuid;
  local_trip_id uuid;
  policy_record record;
begin
  if to_regclass('public.push_subscriptions') is null then
    raise exception 'local push_subscriptions table does not exist';
  end if;

  alter table public.push_subscriptions
    add column if not exists user_id uuid,
    add column if not exists trip_id uuid,
    add column if not exists created_at timestamptz,
    add column if not exists updated_at timestamptz;

  if exists (select 1 from public.push_subscriptions) then
    select trip.id, trip.owner_id
    into local_trip_id, local_user_id
    from public.trips as trip
    order by trip.created_at, trip.id
    limit 1;

    if local_trip_id is null then
      select users.id
      into local_user_id
      from auth.users as users
      order by users.created_at, users.id
      limit 1;

      if local_user_id is null then
        local_user_id := '00000000-0000-4000-8000-000000000101';

        insert into auth.users (
          instance_id,
          id,
          aud,
          role,
          email,
          encrypted_password,
          email_confirmed_at,
          raw_app_meta_data,
          raw_user_meta_data,
          created_at,
          updated_at
        ) values (
          '00000000-0000-0000-0000-000000000000',
          local_user_id,
          'authenticated',
          'authenticated',
          'local-push-bootstrap@example.invalid',
          '',
          statement_timestamp(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{}'::jsonb,
          statement_timestamp(),
          statement_timestamp()
        )
        on conflict (id) do nothing;
      end if;

      local_trip_id := '00000000-0000-4000-8000-000000000102';

      insert into public.trips (id, name, owner_id, time_zone)
      values (
        local_trip_id,
        'Local push notification test',
        local_user_id,
        'Europe/London'
      )
      on conflict (id) do nothing;

      select trip.owner_id
      into local_user_id
      from public.trips as trip
      where trip.id = local_trip_id;
    end if;

    insert into public.trip_members (trip_id, user_id)
    values (local_trip_id, local_user_id)
    on conflict (trip_id, user_id) do nothing;

    update public.push_subscriptions
    set
      user_id = coalesce(user_id, local_user_id),
      trip_id = coalesce(trip_id, local_trip_id),
      created_at = coalesce(created_at, statement_timestamp()),
      updated_at = coalesce(updated_at, statement_timestamp());
  end if;

  if exists (
    select 1
    from public.push_subscriptions
    where id is null
       or user_id is null
       or trip_id is null
       or endpoint is null
       or p256dh is null
       or auth is null
       or active is null
       or created_at is null
       or updated_at is null
  ) then
    raise exception 'local push_subscriptions contains invalid required data';
  end if;

  if exists (
    select endpoint
    from public.push_subscriptions
    group by endpoint
    having count(*) > 1
  ) then
    raise exception 'local push_subscriptions contains duplicate endpoints';
  end if;

  alter table public.push_subscriptions
    alter column id set default gen_random_uuid(),
    alter column user_id set not null,
    alter column trip_id set not null,
    alter column endpoint set not null,
    alter column p256dh set not null,
    alter column auth set not null,
    alter column active set default true,
    alter column active set not null,
    alter column created_at set default now(),
    alter column created_at set not null,
    alter column updated_at set default now(),
    alter column updated_at set not null;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.push_subscriptions'::regclass
      and contype = 'p'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_pkey primary key (id);
  end if;

  if not exists (
    select 1
    from pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.push_subscriptions'::regclass
      and constraint_record.contype = 'u'
      and constraint_record.conkey = array[
        (
          select attribute.attnum
          from pg_attribute as attribute
          where attribute.attrelid = 'public.push_subscriptions'::regclass
            and attribute.attname = 'endpoint'
        )
      ]::smallint[]
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_endpoint_key unique (endpoint);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.push_subscriptions'::regclass
      and conname = 'push_subscriptions_user_id_fkey'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.push_subscriptions'::regclass
      and conname = 'push_subscriptions_trip_id_fkey'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_trip_id_fkey
      foreign key (trip_id) references public.trips(id) on delete cascade;
  end if;

  for policy_record in
    select policy.polname
    from pg_policy as policy
    where policy.polrelid = 'public.push_subscriptions'::regclass
  loop
    execute format(
      'drop policy %I on public.push_subscriptions',
      policy_record.polname
    );
  end loop;
end;
$$;

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

create policy "users can view their push subscriptions"
on public.push_subscriptions
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can create their push subscriptions"
on public.push_subscriptions
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and public.is_trip_member(trip_id)
);

create policy "users can update their push subscriptions"
on public.push_subscriptions
for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and public.is_trip_member(trip_id)
);

create policy "users can delete their push subscriptions"
on public.push_subscriptions
for delete
to authenticated
using ((select auth.uid()) = user_id);

commit;

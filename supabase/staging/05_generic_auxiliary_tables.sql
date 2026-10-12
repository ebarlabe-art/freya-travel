-- STAGING ONLY: missing legacy bootstrap tables used by generic-trip UI.
-- Reconstructed from read-only production *schema metadata*, not exported data.
-- travel_expenses intentionally excluded: London-specific until universalized.

create table public.travel_parking(
 trip_id uuid primary key references public.trips(id) on delete cascade,
 parking_name text,reservation_code text,entry_at timestamptz,exit_at timestamptz,
 address text,floor text,zone text,spot text,notes text,
 latitude double precision,longitude double precision,photo_path text,
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now(),
 constraint staging_parking_latitude check(latitude is null or latitude between -90 and 90),
 constraint staging_parking_longitude check(longitude is null or longitude between -180 and 180)
);
alter table public.travel_parking enable row level security;
revoke all on public.travel_parking from public,anon,authenticated;
grant select,insert,update,delete on public.travel_parking to authenticated;
create policy staging_parking_read on public.travel_parking for select to authenticated
 using(public.is_trip_member(trip_id));
create policy staging_parking_create on public.travel_parking for insert to authenticated
 with check(public.is_trip_member(trip_id) and updated_by=(select auth.uid()));
create policy staging_parking_edit on public.travel_parking for update to authenticated
 using(public.is_trip_member(trip_id))
 with check(public.is_trip_member(trip_id) and updated_by=(select auth.uid()));
create policy staging_parking_delete on public.travel_parking for delete to authenticated
 using(public.is_trip_member(trip_id));

create table public.push_subscriptions(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 trip_id uuid not null references public.trips(id) on delete cascade,
 endpoint text not null,
 p256dh text not null,
 auth text not null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(endpoint,trip_id),
 constraint staging_push_endpoint_not_empty check(length(btrim(endpoint)) between 1 and 4000)
);
create index staging_push_user_active_idx on public.push_subscriptions(user_id,active);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public,anon,authenticated;
grant select,insert,update,delete on public.push_subscriptions to authenticated;
create policy staging_push_read on public.push_subscriptions for select to authenticated
 using(user_id=(select auth.uid()));
create policy staging_push_create on public.push_subscriptions for insert to authenticated
 with check(user_id=(select auth.uid()) and public.is_trip_member(trip_id));
create policy staging_push_edit on public.push_subscriptions for update to authenticated
 using(user_id=(select auth.uid()) and public.is_trip_member(trip_id))
 with check(user_id=(select auth.uid()) and public.is_trip_member(trip_id));
create policy staging_push_delete on public.push_subscriptions for delete to authenticated
 using(user_id=(select auth.uid()));

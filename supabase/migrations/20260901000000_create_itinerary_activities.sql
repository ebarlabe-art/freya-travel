alter table public.trips
  add column if not exists time_zone text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trips_time_zone_not_blank'
      and conrelid = 'public.trips'::regclass
  ) then
    alter table public.trips
      add constraint trips_time_zone_not_blank
      check (
        time_zone is null
        or (
          time_zone = btrim(time_zone)
          and char_length(time_zone) between 1 and 100
        )
      );
  end if;
end
$$;

create table public.itinerary_activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  stable_activity_id text not null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  time_zone text,
  booked boolean not null default false,
  notifications_enabled boolean not null default true,
  notify_before_minutes smallint not null default 60,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint itinerary_activities_trip_stable_activity_key
    unique (trip_id, stable_activity_id),
  constraint itinerary_activities_stable_activity_id_not_blank
    check (
      stable_activity_id = btrim(stable_activity_id)
      and char_length(stable_activity_id) between 1 and 200
    ),
  constraint itinerary_activities_title_not_blank
    check (
      title = btrim(title)
      and char_length(title) between 1 and 200
    ),
  constraint itinerary_activities_description_length
    check (
      description is null
      or char_length(description) between 1 and 2000
    ),
  constraint itinerary_activities_time_zone_not_blank
    check (
      time_zone is null
      or (
        time_zone = btrim(time_zone)
        and char_length(time_zone) between 1 and 100
      )
    ),
  constraint itinerary_activities_notify_before_minutes_range
    check (notify_before_minutes between 1 and 10080)
);

create index itinerary_activities_notifications_starts_at_idx
  on public.itinerary_activities (starts_at)
  where notifications_enabled = true;

alter table public.itinerary_activities enable row level security;

revoke all on table public.itinerary_activities from anon, authenticated;
grant select on table public.itinerary_activities to authenticated;

create policy "members can view itinerary activities"
on public.itinerary_activities
for select
to authenticated
using (public.is_trip_member(trip_id));

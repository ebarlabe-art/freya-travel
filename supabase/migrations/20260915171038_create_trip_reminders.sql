create table public.trip_reminders (
  id uuid primary key default gen_random_uuid(),

  trip_id uuid not null
    references public.trips(id)
    on delete cascade,

  source_kind text not null,
  source_id uuid not null,
  reminder_kind text not null,

  title text not null,
  event_at timestamptz not null,

  default_notify_before_minutes integer not null,

  scheduled_for timestamptz not null,

  enabled boolean not null default true,

  source_updated_at timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trip_reminders_source_kind_check
    check (
      source_kind in (
        'flight',
        'accommodation',
        'activity',
        'itinerary_item'
      )
    ),

  constraint trip_reminders_kind_check
    check (
      reminder_kind in (
        'flight_departure',
        'accommodation_check_in',
        'accommodation_check_out',
        'activity_start',
        'itinerary_exact'
      )
    ),

  constraint trip_reminders_source_kind_match_check
    check (
      (source_kind = 'flight'
        and reminder_kind = 'flight_departure')
      or
      (source_kind = 'accommodation'
        and reminder_kind in (
          'accommodation_check_in',
          'accommodation_check_out'
        ))
      or
      (source_kind = 'activity'
        and reminder_kind = 'activity_start')
      or
      (source_kind = 'itinerary_item'
        and reminder_kind = 'itinerary_exact')
    ),

  constraint trip_reminders_title_check
    check (
      title = btrim(title)
      and char_length(title) between 1 and 300
    ),

  constraint trip_reminders_notify_before_check
    check (
      default_notify_before_minutes between 1 and 10080
    ),

  constraint trip_reminders_schedule_check
    check (
      scheduled_for <= event_at
    ),

  constraint trip_reminders_source_unique
    unique (
      trip_id,
      source_kind,
      source_id,
      reminder_kind
    )
);

create index trip_reminders_trip_schedule_idx
  on public.trip_reminders (
    trip_id,
    scheduled_for asc,
    id
  )
  where enabled;

create index trip_reminders_due_idx
  on public.trip_reminders (
    scheduled_for asc,
    id
  )
  where enabled;

alter table public.trip_reminders
  enable row level security;

revoke all
  on table public.trip_reminders
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.trip_reminders
  to service_role;


create or replace function public.sync_trip_reminders()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_count integer := 0;
  affected_count integer := 0;
begin

  -- ------------------------------------------------------------
  -- Flights: departure -> 5 hours
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    flight.trip_id,
    'flight',
    flight.id,
    'flight_departure',
    coalesce(
      nullif(
        pg_catalog.concat_ws(
          ' ',
          nullif(pg_catalog.btrim(flight.airline), ''),
          nullif(pg_catalog.btrim(flight.flight_number), '')
        ),
        ''
      ),
      nullif(
        pg_catalog.concat_ws(
          ' → ',
          nullif(pg_catalog.btrim(flight.departure_city), ''),
          nullif(pg_catalog.btrim(flight.arrival_city), '')
        ),
        ''
      ),
      'Vol'
    ),
    flight.departure_at,
    300,
    flight.departure_at - interval '300 minutes',
    true,
    flight.updated_at
  from public.trip_flights as flight
  where flight.departure_at is not null
    and flight.departure_at > statement_timestamp()
    and flight.flight_status <> 'cancelled'
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Accommodation: check-in -> 2 hours
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    accommodation.trip_id,
    'accommodation',
    accommodation.id,
    'accommodation_check_in',
    accommodation.name,
    accommodation.check_in_at,
    120,
    accommodation.check_in_at - interval '120 minutes',
    true,
    accommodation.updated_at
  from public.trip_accommodations as accommodation
  where accommodation.check_in_at is not null
    and accommodation.check_in_at > statement_timestamp()
    and accommodation.reservation_status <> 'cancelled'
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Accommodation: check-out -> 2 hours
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    accommodation.trip_id,
    'accommodation',
    accommodation.id,
    'accommodation_check_out',
    accommodation.name,
    accommodation.check_out_at,
    120,
    accommodation.check_out_at - interval '120 minutes',
    true,
    accommodation.updated_at
  from public.trip_accommodations as accommodation
  where accommodation.check_out_at is not null
    and accommodation.check_out_at > statement_timestamp()
    and accommodation.reservation_status <> 'cancelled'
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Activities / restaurants: start -> 1 hour
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    activity.trip_id,
    'activity',
    activity.id,
    'activity_start',
    activity.title,
    activity.start_at,
    60,
    activity.start_at - interval '60 minutes',
    true,
    activity.updated_at
  from public.trip_activities as activity
  where activity.start_at is not null
    and activity.start_at > statement_timestamp()
    and activity.reservation_status <> 'cancelled'
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Manual itinerary: exact only -> 1 hour
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    item.trip_id,
    'itinerary_item',
    item.id,
    'itinerary_exact',
    item.title,
    item.starts_at,
    60,
    item.starts_at - interval '60 minutes',
    true,
    item.updated_at
  from public.trip_itinerary_items as item
  where item.timing_kind = 'exact'
    and item.starts_at is not null
    and item.starts_at > statement_timestamp()
    and item.status = 'planned'
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Disable reminders whose canonical source is no longer eligible.
  -- We keep the row for audit/stability instead of deleting it.
  -- ------------------------------------------------------------

  update public.trip_reminders as reminder
  set
    enabled = false,
    updated_at = statement_timestamp()
  where reminder.enabled
    and (
      (
        reminder.source_kind = 'flight'
        and reminder.reminder_kind = 'flight_departure'
        and not exists (
          select 1
          from public.trip_flights as flight
          where flight.id = reminder.source_id
            and flight.trip_id = reminder.trip_id
            and flight.departure_at is not null
            and flight.departure_at > statement_timestamp()
            and flight.flight_status <> 'cancelled'
        )
      )

      or (
        reminder.source_kind = 'accommodation'
        and reminder.reminder_kind = 'accommodation_check_in'
        and not exists (
          select 1
          from public.trip_accommodations as accommodation
          where accommodation.id = reminder.source_id
            and accommodation.trip_id = reminder.trip_id
            and accommodation.check_in_at is not null
            and accommodation.check_in_at > statement_timestamp()
            and accommodation.reservation_status <> 'cancelled'
        )
      )

      or (
        reminder.source_kind = 'accommodation'
        and reminder.reminder_kind = 'accommodation_check_out'
        and not exists (
          select 1
          from public.trip_accommodations as accommodation
          where accommodation.id = reminder.source_id
            and accommodation.trip_id = reminder.trip_id
            and accommodation.check_out_at is not null
            and accommodation.check_out_at > statement_timestamp()
            and accommodation.reservation_status <> 'cancelled'
        )
      )

      or (
        reminder.source_kind = 'activity'
        and reminder.reminder_kind = 'activity_start'
        and not exists (
          select 1
          from public.trip_activities as activity
          where activity.id = reminder.source_id
            and activity.trip_id = reminder.trip_id
            and activity.start_at is not null
            and activity.start_at > statement_timestamp()
            and activity.reservation_status <> 'cancelled'
        )
      )

      or (
        reminder.source_kind = 'itinerary_item'
        and reminder.reminder_kind = 'itinerary_exact'
        and not exists (
          select 1
          from public.trip_itinerary_items as item
          where item.id = reminder.source_id
            and item.trip_id = reminder.trip_id
            and item.timing_kind = 'exact'
            and item.starts_at is not null
            and item.starts_at > statement_timestamp()
            and item.status = 'planned'
        )
      )
    );

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  return changed_count;
end;
$$;

revoke all
  on function public.sync_trip_reminders()
  from public, anon, authenticated;

grant execute
  on function public.sync_trip_reminders()
  to service_role;


comment on table public.trip_reminders is
  'Server-managed normalized reminder layer derived from canonical trip sources.';

comment on column public.trip_reminders.source_id is
  'UUID of the canonical source row; interpreted together with source_kind.';

comment on column public.trip_reminders.default_notify_before_minutes is
  'Default lead time. Per-user overrides may be layered on later.';

comment on column public.trip_reminders.scheduled_for is
  'Automatically calculated from event_at and the default reminder lead time.';

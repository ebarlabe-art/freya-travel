-- Additive: no backfill, no reinterpretation of reservations or manual statuses.
alter table public.trip_activities add column completed_at timestamptz;
alter table public.trip_flights add column completed_at timestamptz;
alter table public.trip_accommodations
  add column check_in_completed_at timestamptz,
  add column check_out_completed_at timestamptz;

-- Keep progress timestamps server-owned even for a direct member UPDATE.
-- The zz prefix runs after the existing integrity/audit BEFORE triggers.
create function public.enforce_trip_progress_integrity()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  previous jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  incoming jsonb := to_jsonb(new);
  field_name text;
  fields text[];
  changed boolean := false;
  stamp timestamptz := clock_timestamp();
begin
  fields := case tg_table_name
    when 'trip_accommodations' then array['check_in_completed_at','check_out_completed_at']
    when 'trip_itinerary_items' then array['status']
    else array['completed_at'] end;
  foreach field_name in array fields loop
    if field_name = 'status' then
      if (incoming->>'status' = 'completed') is not distinct from (coalesce(previous->>'status','planned') = 'completed') then continue; end if;
      if incoming->>'status' = 'completed' and previous->>'status' = 'cancelled' then
        raise exception 'Reactiva el planning cancellat abans de marcar-lo fet' using errcode = '22023';
      end if;
    elsif coalesce(incoming->field_name,'null'::jsonb) is not distinct from coalesce(previous->field_name,'null'::jsonb) then
      continue;
    end if;
    changed := true;
    if auth.uid() is null or not public.is_trip_member(new.trip_id)
       or not exists (select 1 from public.trips t where t.id = new.trip_id and t.experience_key is distinct from 'london-2026') then
      raise exception 'Progres no disponible per a aquest viatge' using errcode = '42501';
    end if;
    if field_name <> 'status' and incoming->>field_name is not null then
      if coalesce(incoming->>'reservation_status',incoming->>'flight_status') = 'cancelled' then
        raise exception 'Un element cancellat no es pot marcar fet' using errcode = '22023';
      end if;
      -- Preserve an existing mark; never accept a client-supplied time.
      incoming := jsonb_set(incoming,array[field_name],to_jsonb(coalesce((previous->>field_name)::timestamptz,stamp)));
    end if;
  end loop;
  if changed then
    incoming := jsonb_set(incoming,'{updated_at}',to_jsonb(greatest(stamp,coalesce((previous->>'updated_at')::timestamptz,stamp)+interval '1 microsecond')));
    new := jsonb_populate_record(new,incoming);
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_trip_progress_integrity() from public, anon, authenticated;
create trigger zz_trip_progress_integrity before insert or update on public.trip_activities
  for each row execute function public.enforce_trip_progress_integrity();
create trigger zz_trip_progress_integrity before insert or update on public.trip_flights
  for each row execute function public.enforce_trip_progress_integrity();
create trigger zz_trip_progress_integrity before insert or update on public.trip_accommodations
  for each row execute function public.enforce_trip_progress_integrity();
create trigger zz_trip_progress_integrity before insert or update on public.trip_itinerary_items
  for each row execute function public.enforce_trip_progress_integrity();

create function public.set_trip_event_completed(
  p_trip_id uuid, p_source_type text, p_source_id uuid, p_source_event text,
  p_completed boolean, p_expected_updated_at timestamptz
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  table_name text;
  progress_column text;
  current_row jsonb;
  current_completed boolean;
  cancelled boolean;
begin
  if auth.uid() is null or not public.is_trip_member(p_trip_id)
     or not exists (select 1 from public.trips t where t.id=p_trip_id and t.experience_key is distinct from 'london-2026') then
    raise exception 'No tens acces al progres d aquest viatge' using errcode='42501';
  end if;
  if p_completed is null or p_expected_updated_at is null or p_source_id is null then
    raise exception 'Falten el valor explicit o la versio esperada' using errcode='22023';
  end if;
  case
    when p_source_type='activity' and p_source_event='start' then table_name:='trip_activities';progress_column:='completed_at';
    when p_source_type='flight' and p_source_event='departure' then table_name:='trip_flights';progress_column:='completed_at';
    when p_source_type='accommodation' and p_source_event='check_in' then table_name:='trip_accommodations';progress_column:='check_in_completed_at';
    when p_source_type='accommodation' and p_source_event='check_out' then table_name:='trip_accommodations';progress_column:='check_out_completed_at';
    when p_source_type='manual' and p_source_event='manual' then table_name:='trip_itinerary_items';progress_column:='status';
    else raise exception 'Font o esdeveniment no admès' using errcode='22023';
  end case;
  -- Identifiers come exclusively from the closed mapping above, never the caller.
  execute format('select to_jsonb(s) from public.%I s where s.trip_id=$1 and s.id=$2 for update',table_name)
    into current_row using p_trip_id,p_source_id;
  if current_row is null then raise exception 'L element ja no existeix o no es accessible' using errcode='P0002'; end if;
  current_completed := case when progress_column='status' then current_row->>'status'='completed' else current_row->>progress_column is not null end;
  cancelled := coalesce(current_row->>'reservation_status',current_row->>'flight_status',current_row->>'status')='cancelled';
  if p_completed and cancelled then raise exception 'Un element cancellat no es pot marcar fet' using errcode='22023'; end if;
  -- Same desired state is idempotent, even after another member already set it.
  -- A stale opposing command must never silently overwrite the latest state.
  if current_completed is distinct from p_completed then
    if (current_row->>'updated_at')::timestamptz is distinct from p_expected_updated_at then
      raise exception 'Conflicte: el registre ha canviat. Recarrega abans de tornar-ho a provar.' using errcode='40001';
    end if;
    if progress_column='status' then
      execute format('update public.%I s set status=$3 where s.trip_id=$1 and s.id=$2 returning to_jsonb(s)',table_name)
        into current_row using p_trip_id,p_source_id,case when p_completed then 'completed' else 'planned' end;
    else
      execute format('update public.%I s set %I=$3 where s.trip_id=$1 and s.id=$2 returning to_jsonb(s)',table_name,progress_column)
        into current_row using p_trip_id,p_source_id,case when p_completed then clock_timestamp() else null::timestamptz end;
    end if;
    if current_row is null then raise exception 'No s ha pogut actualitzar el registre' using errcode='42501'; end if;
  end if;
  return jsonb_build_object('trip_id',p_trip_id,'source_type',p_source_type,'source_id',p_source_id,'source_event',p_source_event,
    'is_completed',case when progress_column='status' then current_row->>'status'='completed' else current_row->>progress_column is not null end,
    'completed_at',case when progress_column='status' then null else current_row->>progress_column end,
    'updated_at',current_row->>'updated_at','row',current_row);
end;
$$;
revoke all on function public.set_trip_event_completed(uuid,text,uuid,text,boolean,timestamptz) from public, anon;
grant execute on function public.set_trip_event_completed(uuid,text,uuid,text,boolean,timestamptz) to authenticated;

-- Universal reminder projection follows below. The legacy London path and
-- sync_notification_deliveries() are unchanged; the latter already calls this
-- projection and retires pending/retry deliveries whose reminder is disabled.
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
    and flight.completed_at is null
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
    and accommodation.check_in_completed_at is null
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
    and accommodation.check_out_completed_at is null
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
    and activity.completed_at is null
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
    and flight.completed_at is null
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
    and accommodation.check_in_completed_at is null
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
    and accommodation.check_out_completed_at is null
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
    and activity.completed_at is null
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

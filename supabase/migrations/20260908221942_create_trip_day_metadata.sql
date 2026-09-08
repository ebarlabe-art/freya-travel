create table public.trip_day_metadata (
  id uuid default gen_random_uuid(),
  trip_id uuid not null,
  local_date date not null,
  title text,
  summary text,
  created_by uuid default auth.uid(),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trip_day_metadata_pkey primary key (id),
  constraint trip_day_metadata_trip_fkey
    foreign key (trip_id) references public.trips(id) on delete cascade,
  constraint trip_day_metadata_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  constraint trip_day_metadata_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null,
  constraint trip_day_metadata_trip_date_key unique (trip_id, local_date),
  constraint trip_day_metadata_title_check check (
    title is null
    or (
      title = btrim(title)
      and char_length(title) between 1 and 160
    )
  ),
  constraint trip_day_metadata_summary_check check (
    summary is null
    or (
      summary = btrim(summary)
      and char_length(summary) between 1 and 1000
    )
  )
);

comment on table public.trip_day_metadata is
  'Optional editorial title and summary for one trip-local calendar day.';

create function public.enforce_trip_day_metadata_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  new.title := nullif(btrim(new.title), '');
  new.summary := nullif(btrim(new.summary), '');

  if exists (
    select 1
    from public.trips as trip
    where trip.id = new.trip_id
      and trip.start_date is not null
      and trip.end_date is not null
      and new.local_date not between trip.start_date and trip.end_date
  ) then
    raise exception 'La data editorial queda fora del viatge'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.updated_by := null;
    new.created_at := statement_timestamp();
    new.updated_at := new.created_at;
  else
    if new.id is distinct from old.id
       or new.trip_id is distinct from old.trip_id
       or new.local_date is distinct from old.local_date
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'No es poden modificar els camps immutables de la capcalera del dia'
        using errcode = '42501';
    end if;

    new.updated_by := auth.uid();
    new.updated_at := statement_timestamp();
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_trip_day_metadata_integrity()
  from public, anon, authenticated;

create trigger enforce_trip_day_metadata_integrity_trigger
before insert or update on public.trip_day_metadata
for each row execute function public.enforce_trip_day_metadata_integrity();

alter table public.trip_day_metadata enable row level security;

revoke all on table public.trip_day_metadata
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.trip_day_metadata
  to authenticated;

create policy "members can view trip day metadata"
on public.trip_day_metadata
for select
to authenticated
using (public.is_trip_member(trip_id));

create policy "members can add trip day metadata"
on public.trip_day_metadata
for insert
to authenticated
with check (
  public.is_trip_member(trip_id)
  and created_by = (select auth.uid())
);

create policy "members can update trip day metadata"
on public.trip_day_metadata
for update
to authenticated
using (public.is_trip_member(trip_id))
with check (public.is_trip_member(trip_id));

create policy "members can delete trip day metadata"
on public.trip_day_metadata
for delete
to authenticated
using (public.is_trip_member(trip_id));

alter table public.trip_day_metadata replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_day_metadata'
  ) then
    alter publication supabase_realtime
      add table public.trip_day_metadata;
  end if;
end;
$$;

-- C2.1. Short original recordings and their metadata commit together.
-- Sharing will require a separate, explicitly authorized contract.
create table public.trip_journal_entries (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  local_day date not null,
  captured_at timestamptz not null,
  body text not null default '' check (char_length(body) <= 12000),
  audio_base64 text,
  audio_mime text,
  duration_ms integer,
  visibility text not null default 'private' check (visibility = 'private'),
  operation_id uuid not null,
  deleted boolean not null default false,
  check (
    (audio_base64 is null and audio_mime is null and duration_ms is null and (deleted or btrim(body) <> ''))
    or
    (audio_base64 is not null and octet_length(audio_base64) between 4 and 5592408
      and octet_length(audio_base64) % 4 = 0
      and audio_base64 ~ '^[A-Za-z0-9+/]+={0,2}$'
      and audio_mime is not null and audio_mime in ('audio/mp4', 'audio/webm', 'audio/ogg')
      and duration_ms is not null and duration_ms between 1 and 150000 and not deleted)
  )
);

create index trip_journal_author_trip_day
  on public.trip_journal_entries (author_id, trip_id, local_day desc, captured_at desc, id);

alter table public.trip_journal_entries enable row level security;
revoke all on public.trip_journal_entries from public, anon, authenticated;
grant select, insert on public.trip_journal_entries to authenticated;
grant update (body, operation_id, deleted) on public.trip_journal_entries to authenticated;

create policy trip_journal_author_read on public.trip_journal_entries
  for select to authenticated
  using (author_id = (select auth.uid()) and public.is_trip_member(trip_id));
create policy trip_journal_author_insert on public.trip_journal_entries
  for insert to authenticated
  with check (author_id = (select auth.uid()) and public.is_trip_member(trip_id));
create policy trip_journal_author_update on public.trip_journal_entries
  for update to authenticated
  using (author_id = (select auth.uid()) and public.is_trip_member(trip_id))
  with check (author_id = (select auth.uid()) and public.is_trip_member(trip_id));

create function public.save_trip_journal_v1(
  p_id uuid, p_trip_id uuid, p_author uuid, p_operation uuid, p_base uuid,
  p_day date, p_captured_at timestamptz, p_body text, p_audio text,
  p_mime text, p_duration integer, p_deleted boolean
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  entry public.trip_journal_entries%rowtype;
  accepted uuid;
begin
  if actor is null or actor is distinct from p_author or not public.is_trip_member(p_trip_id) then
    raise exception 'journal_access' using errcode = '42501';
  end if;
  if p_base is null and not p_deleted then
    insert into public.trip_journal_entries
      (id, trip_id, author_id, local_day, captured_at, body, audio_base64, audio_mime, duration_ms, operation_id)
    values (p_id, p_trip_id, actor, p_day, p_captured_at, p_body, p_audio, p_mime, p_duration, p_operation)
    on conflict (id) do nothing
    returning operation_id into accepted;
    if accepted is not null then return accepted; end if;
  end if;

  select * into entry from public.trip_journal_entries
    where id = p_id and trip_id = p_trip_id and author_id = actor for update;
  if not found then raise exception 'journal_conflict' using errcode = '40001'; end if;
  if entry.operation_id = p_operation then return p_operation; end if;
  if entry.operation_id is distinct from p_base or entry.deleted or entry.audio_mime is not null then
    raise exception 'journal_conflict' using errcode = '40001';
  end if;
  update public.trip_journal_entries
    set body = case when p_deleted then '' else p_body end, operation_id = p_operation, deleted = p_deleted
    where id = p_id;
  return p_operation;
end;
$$;
revoke all on function public.save_trip_journal_v1(uuid,uuid,uuid,uuid,uuid,date,timestamptz,text,text,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.save_trip_journal_v1(uuid,uuid,uuid,uuid,uuid,date,timestamptz,text,text,text,integer,boolean) to authenticated;

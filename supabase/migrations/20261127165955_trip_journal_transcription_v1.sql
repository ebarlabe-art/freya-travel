-- C2.2 extends the existing private journal record. The provider result and
-- the author's corrections are independent. C2.1 clients still use v1.
alter table public.trip_journal_entries
  add column transcript_original text check (char_length(transcript_original) between 1 and 12000),
  add column transcript_edit text check (char_length(transcript_edit) between 1 and 12000),
  add column transcript_language text check (transcript_language ~ '^[a-z]{2,3}$'),
  add column transcript_epoch uuid,
  add column transcript_request_id uuid;

-- Keep the audio limits and permit a transcript to be the remaining content.
alter table public.trip_journal_entries
  drop constraint trip_journal_entries_check1,
  add constraint trip_journal_entry_content check (
    (audio_base64 is null and audio_mime is null and duration_ms is null
      and (deleted or btrim(body) <> '' or transcript_original is not null))
    or
    (audio_base64 is not null and octet_length(audio_base64) between 4 and 5592408
      and octet_length(audio_base64) % 4 = 0
      and audio_base64 ~ '^[A-Za-z0-9+/]+={0,2}$'
      and audio_mime is not null and audio_mime in ('audio/mp4', 'audio/webm', 'audio/ogg')
      and duration_ms is not null and duration_ms between 1 and 150000 and not deleted)
  );

-- The v1 table-level INSERT grant would otherwise cover the new columns.
revoke insert on public.trip_journal_entries from authenticated;
grant insert (id,trip_id,author_id,local_day,captured_at,body,audio_base64,audio_mime,duration_ms,visibility,operation_id,deleted)
  on public.trip_journal_entries to authenticated;
grant select,update on public.trip_journal_entries to service_role;

create or replace function public.clear_deleted_trip_journal_content_v1() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if old.deleted then
    raise exception 'journal_conflict' using errcode = '40001';
  end if;
  if new.deleted then
    new.body := '';
    new.audio_base64 := null;
    new.audio_mime := null;
    new.duration_ms := null;
    new.transcript_original := null;
    new.transcript_edit := null;
    new.transcript_language := null;
    new.transcript_request_id := null;
  end if;
  return new;
end;
$$;

-- Only the Edge Function can claim work. No audio or text in the ledger.
create table public.trip_journal_transcription_jobs (
  id uuid primary key,
  entry_id uuid not null references public.trip_journal_entries(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  epoch uuid,
  started_at timestamptz not null default now(),
  status text not null default 'running' check (status in ('running','done','failed','gone'))
);
create index trip_journal_transcription_started on public.trip_journal_transcription_jobs (started_at);
create index trip_journal_transcription_author_started on public.trip_journal_transcription_jobs (author_id,started_at);
create index trip_journal_transcription_entry on public.trip_journal_transcription_jobs (entry_id);
alter table public.trip_journal_transcription_jobs enable row level security;
revoke all on public.trip_journal_transcription_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.trip_journal_transcription_jobs to service_role;

create function public.trip_journal_transcription_access_v1(p_actor uuid,p_trip uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists(select 1 from public.trip_members m join public.trips t on t.id=m.trip_id
    where m.trip_id=p_trip and m.user_id=p_actor and t.discarded_at is null);
$$;

create function public.claim_trip_journal_transcription_v1(
  p_actor uuid,p_trip uuid,p_entry uuid,p_request uuid,p_epoch uuid,p_requested_at timestamptz
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  entry public.trip_journal_entries%rowtype;
  job public.trip_journal_transcription_jobs%rowtype;
begin
  if not public.trip_journal_transcription_access_v1(p_actor,p_trip) then return '{"status":"gone"}'; end if;
  if p_requested_at is null or p_requested_at < now()-interval '7 days' or p_requested_at > now()+interval '5 minutes' then
    return '{"status":"failed"}';
  end if;

  -- Short transaction only. Serialize claims across instances for the global
  -- daily cap, and lock the entry while checking its deletion barrier.
  perform pg_catalog.pg_advisory_xact_lock(9159601);
  select * into entry from public.trip_journal_entries
    where id=p_entry and trip_id=p_trip and author_id=p_actor for update;
  if not found or entry.deleted or entry.audio_mime is null or entry.transcript_epoch is distinct from p_epoch then
    return '{"status":"gone"}';
  end if;
  select * into job from public.trip_journal_transcription_jobs where id=p_request;
  if found then
    if job.entry_id<>p_entry or job.author_id<>p_actor or job.epoch is distinct from p_epoch then return '{"status":"gone"}'; end if;
    if job.status='running' and job.started_at < now()-interval '90 seconds' then return '{"status":"failed"}'; end if;
    return jsonb_build_object('status',job.status);
  end if;
  if exists(select 1 from public.trip_journal_transcription_jobs
    where author_id=p_actor and status='running' and started_at >= now()-interval '90 seconds') then
    return '{"status":"busy"}';
  end if;
  if (select count(*) from public.trip_journal_transcription_jobs where author_id=p_actor and started_at >= now()-interval '1 day') >= 20
    or (select count(*) from public.trip_journal_transcription_jobs where started_at >= now()-interval '1 day') >= 500 then
    return '{"status":"limit"}';
  end if;
  delete from public.trip_journal_transcription_jobs where started_at < now()-interval '30 days';
  insert into public.trip_journal_transcription_jobs(id,entry_id,author_id,epoch) values(p_request,p_entry,p_actor,p_epoch);
  return jsonb_build_object('status','claimed','audio',entry.audio_base64,'mime',entry.audio_mime,'duration',entry.duration_ms);
end;
$$;

create function public.finish_trip_journal_transcription_v1(
  p_actor uuid,p_trip uuid,p_entry uuid,p_request uuid,p_text text,p_language text
) returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  job public.trip_journal_transcription_jobs%rowtype;
  result text := 'gone';
begin
  -- Take locks in the same order as the claim so a delete cannot be undone.
  perform 1 from public.trip_journal_entries where id=p_entry and trip_id=p_trip and author_id=p_actor for update;
  if not found then return result; end if;
  select * into job from public.trip_journal_transcription_jobs
    where id=p_request and entry_id=p_entry and author_id=p_actor for update;
  if not found then return result; end if;
  if job.status<>'running' then return job.status; end if;
  if job.started_at >= now()-interval '90 seconds' and public.trip_journal_transcription_access_v1(p_actor,p_trip) then
    if p_text is null then
      result := 'failed';
    else
      update public.trip_journal_entries set
        transcript_original=p_text,transcript_language=p_language,transcript_request_id=p_request
        where id=p_entry and not deleted and audio_mime is not null and transcript_epoch is not distinct from job.epoch;
      if found then result := 'done'; end if;
    end if;
  end if;
  update public.trip_journal_transcription_jobs set status=result where id=p_request;
  return result;
end;
$$;

create function public.mutate_trip_journal_transcript_v1(
  p_actor uuid,p_trip uuid,p_entry uuid,p_operation uuid,p_base uuid,p_action text,p_text text
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  entry public.trip_journal_entries%rowtype;
begin
  if not public.trip_journal_transcription_access_v1(p_actor,p_trip) then
    raise exception 'journal_access' using errcode='42501';
  end if;
  select * into entry from public.trip_journal_entries
    where id=p_entry and trip_id=p_trip and author_id=p_actor for update;
  if not found or entry.deleted then raise exception 'journal_conflict' using errcode='40001'; end if;
  if entry.operation_id=p_operation then return p_operation; end if;
  if entry.operation_id is distinct from p_base then raise exception 'journal_conflict' using errcode='40001'; end if;

  if p_action='edit' and entry.transcript_original is not null and btrim(p_text)<>'' then
    update public.trip_journal_entries set transcript_edit=p_text,operation_id=p_operation where id=p_entry;
  elsif p_action='remove_audio' and entry.audio_mime is not null and (entry.transcript_original is not null or btrim(entry.body)<>'') then
    update public.trip_journal_entries set audio_base64=null,audio_mime=null,duration_ms=null,
      transcript_epoch=p_operation,operation_id=p_operation where id=p_entry;
  elsif p_action='remove_transcript' and (entry.audio_mime is not null or btrim(entry.body)<>'') then
    update public.trip_journal_entries set transcript_original=null,transcript_edit=null,transcript_language=null,
      transcript_request_id=null,transcript_epoch=p_operation,operation_id=p_operation where id=p_entry;
  else
    raise exception 'journal_invalid_action' using errcode='22023';
  end if;
  return p_operation;
end;
$$;

revoke all on function public.trip_journal_transcription_access_v1(uuid,uuid),
  public.claim_trip_journal_transcription_v1(uuid,uuid,uuid,uuid,uuid,timestamptz),
  public.finish_trip_journal_transcription_v1(uuid,uuid,uuid,uuid,text,text),
  public.mutate_trip_journal_transcript_v1(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.trip_journal_transcription_access_v1(uuid,uuid),
  public.claim_trip_journal_transcription_v1(uuid,uuid,uuid,uuid,uuid,timestamptz),
  public.finish_trip_journal_transcription_v1(uuid,uuid,uuid,uuid,text,text),
  public.mutate_trip_journal_transcript_v1(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;

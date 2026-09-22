-- Optional context only. Existing travel_documents (including London) are untouched.
create table public.trip_photo_metadata (
  document_id uuid primary key,
  trip_id uuid not null,
  local_date date,
  activity_id uuid,
  itinerary_item_id uuid,
  upload_batch_id uuid,
  selection_index integer,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint photo_one_source check (num_nonnulls(activity_id,itinerary_item_id)<=1),
  constraint photo_batch_pair check ((upload_batch_id is null and selection_index is null) or
    (upload_batch_id is not null and selection_index is not null and selection_index between 0 and 19)),
  foreign key (trip_id,document_id) references public.travel_documents(trip_id,id) on delete cascade,
  foreign key (trip_id,activity_id) references public.trip_activities(trip_id,id) on delete set null (activity_id),
  foreign key (trip_id,itinerary_item_id) references public.trip_itinerary_items(trip_id,id) on delete set null (itinerary_item_id),
  unique (trip_id,upload_batch_id,selection_index)
);
create index trip_photo_metadata_day on public.trip_photo_metadata(trip_id,local_date);
create index trip_photo_metadata_activity on public.trip_photo_metadata(trip_id,activity_id) where activity_id is not null;
create index trip_photo_metadata_planning on public.trip_photo_metadata(trip_id,itinerary_item_id) where itinerary_item_id is not null;
alter table public.trip_photo_metadata enable row level security;
revoke all on public.trip_photo_metadata from public,anon,authenticated;
grant select on public.trip_photo_metadata to authenticated;
create policy photo_metadata_member_read on public.trip_photo_metadata for select to authenticated
  using (public.is_trip_member(trip_id));

-- All writes use the two narrowly scoped RPCs below; direct writes cannot bypass CAS.
create function public.audit_trip_photo_metadata() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    -- Allow auth.users ON DELETE SET NULL; do not restore the departing user ID.
    if new.updated_by is null and old.updated_by is not null and
      (new.document_id,new.trip_id,new.local_date,new.activity_id,new.itinerary_item_id,new.upload_batch_id,new.selection_index)
      is not distinct from (old.document_id,old.trip_id,old.local_date,old.activity_id,old.itinerary_item_id,old.upload_batch_id,old.selection_index) then
      return new;
    end if;
    if (new.document_id,new.trip_id,new.upload_batch_id,new.selection_index) is distinct from
       (old.document_id,old.trip_id,old.upload_batch_id,old.selection_index) then
      raise exception 'Identitat de foto immutable' using errcode='22023';
    end if;
    new.created_at:=old.created_at;
    new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  else
    new.created_at:=clock_timestamp();new.updated_at:=new.created_at;
  end if;
  new.updated_by:=auth.uid();
  return new;
end; $$;
revoke all on function public.audit_trip_photo_metadata() from public,anon,authenticated;
create trigger photo_metadata_audit before insert or update on public.trip_photo_metadata
  for each row execute function public.audit_trip_photo_metadata();

create function public.protect_contextual_photo_document() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (new.trip_id,new.id,new.category) is distinct from (old.trip_id,old.id,old.category)
     and exists(select 1 from public.trip_photo_metadata where document_id=old.id) then
    raise exception 'Una foto contextual no es pot moure ni reclassificar' using errcode='22023';
  end if;
  return new;
end; $$;
revoke all on function public.protect_contextual_photo_document() from public,anon,authenticated;
create trigger protect_contextual_photo before update on public.travel_documents
  for each row execute function public.protect_contextual_photo_document();

create function public.finalize_trip_photo(
  p_trip_id uuid,p_document_id uuid,p_title text,p_file_name text,p_mime_type text,
  p_upload_batch_id uuid,p_selection_index integer,p_local_date date,
  p_activity_id uuid,p_itinerary_item_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.travel_documents; m public.trip_photo_metadata; ext text; path text; uid uuid:=auth.uid();
begin
  if uid is null or not public.is_trip_member(p_trip_id) or not exists
    (select 1 from public.trips where id=p_trip_id and experience_key is distinct from 'london-2026') then
    raise exception 'No tens acces a les fotos contextuals' using errcode='42501';
  end if;
  ext:=case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if p_document_id is null or p_upload_batch_id is null or p_selection_index is null or p_selection_index not between 0 and 19
    or ext is null or nullif(btrim(p_title),'') is null or length(p_title)>160
    or nullif(btrim(p_file_name),'') is null or length(p_file_name)>1024 then
    raise exception 'Dades de foto no valides' using errcode='22023';
  end if;
  path:=p_trip_id::text||'/photos/'||uid::text||'/'||p_document_id::text||'.'||ext;
  -- Serializes retry / legacy context creation even before a metadata row exists.
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text,0));
  select * into d from public.travel_documents where id=p_document_id for update;
  if found then
    select * into m from public.trip_photo_metadata where document_id=d.id;
    if d.trip_id<>p_trip_id or d.created_by<>uid or d.category<>'Foto' or d.file_path<>path
      or d.file_name<>p_file_name or m.document_id is null
      or m.upload_batch_id is distinct from p_upload_batch_id or m.selection_index is distinct from p_selection_index then
      raise exception 'Identitat de pujada incompatible' using errcode='22023';
    end if;
    -- A retry never rewrites a context which may already have been edited remotely.
    return jsonb_build_object('document',to_jsonb(d),'metadata',to_jsonb(m));
  end if;
  insert into public.travel_documents(id,trip_id,title,category,file_name,file_path,mime_type,created_by)
    values(p_document_id,p_trip_id,btrim(p_title),'Foto',p_file_name,path,p_mime_type,uid) returning * into d;
  insert into public.trip_photo_metadata(document_id,trip_id,local_date,activity_id,itinerary_item_id,upload_batch_id,selection_index)
    values(d.id,p_trip_id,p_local_date,p_activity_id,p_itinerary_item_id,p_upload_batch_id,p_selection_index) returning * into m;
  return jsonb_build_object('document',to_jsonb(d),'metadata',to_jsonb(m));
end; $$;
revoke all on function public.finalize_trip_photo(uuid,uuid,text,text,text,uuid,integer,date,uuid,uuid) from public,anon;
grant execute on function public.finalize_trip_photo(uuid,uuid,text,text,text,uuid,integer,date,uuid,uuid) to authenticated;

create function public.set_trip_photo_context(
  p_trip_id uuid,p_document_id uuid,p_expected_updated_at timestamptz,
  p_local_date date,p_activity_id uuid,p_itinerary_item_id uuid
) returns public.trip_photo_metadata language plpgsql security definer set search_path='' as $$
declare m public.trip_photo_metadata;
begin
  if auth.uid() is null or not public.is_trip_member(p_trip_id) or not exists
    (select 1 from public.trips where id=p_trip_id and experience_key is distinct from 'london-2026') then
    raise exception 'No tens acces a les fotos contextuals' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text,0));
  perform 1 from public.travel_documents where id=p_document_id and trip_id=p_trip_id and category='Foto' for update;
  if not found then raise exception 'Foto no disponible' using errcode='P0002'; end if;
  select * into m from public.trip_photo_metadata where document_id=p_document_id for update;
  if m.updated_at is distinct from p_expected_updated_at then
    raise exception 'El context ha canviat. Reobre el formulari abans de desar.' using errcode='40001';
  end if;
  if m.document_id is null then
    insert into public.trip_photo_metadata(document_id,trip_id,local_date,activity_id,itinerary_item_id)
      values(p_document_id,p_trip_id,p_local_date,p_activity_id,p_itinerary_item_id) returning * into m;
  else
    update public.trip_photo_metadata set local_date=p_local_date,activity_id=p_activity_id,itinerary_item_id=p_itinerary_item_id
      where document_id=p_document_id and trip_id=p_trip_id returning * into m;
  end if;
  return m;
end; $$;
revoke all on function public.set_trip_photo_context(uuid,uuid,timestamptz,date,uuid,uuid) from public,anon;
grant execute on function public.set_trip_photo_context(uuid,uuid,timestamptz,date,uuid,uuid) to authenticated;

alter publication supabase_realtime add table public.trip_photo_metadata;

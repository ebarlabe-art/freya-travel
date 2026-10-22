-- Additive, trip-scoped cultural content. No backfill and no operational row changes.
begin;
create function public.valid_cultural_guide_document_v1(doc jsonb, place_key text)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare part jsonb; src jsonb; evidence jsonb; matched jsonb; section text; seen text[]:='{}';
begin
 if coalesce((doc is null or jsonb_typeof(doc)<>'object' or octet_length(doc::text)>180000 or doc->'version' is distinct from '1'::jsonb or doc->>'language'<>'ca' or doc->>'place_key' is distinct from place_key or (select count(*) from jsonb_object_keys(doc))<>5 or jsonb_typeof(doc->'sections')<>'object' or (select count(*) from jsonb_object_keys(doc->'sections'))<>6 or jsonb_typeof(doc->'sources')<>'array' or jsonb_array_length(doc->'sources')>8),true) then return false;end if;
 for src in select value from jsonb_array_elements(doc->'sources') loop
  if coalesce((jsonb_typeof(src)<>'object' or (select count(*) from jsonb_object_keys(src))<>5 or jsonb_typeof(src->'id')<>'string' or jsonb_typeof(src->'title')<>'string' or jsonb_typeof(src->'url')<>'string' or jsonb_typeof(src->'license')<>'string' or length(src->>'id') not between 1 and 120 or src->>'id'=any(seen) or length(src->>'title') not between 1 and 300 or length(src->>'license') not between 1 and 200 or jsonb_typeof(src->'excerpt')<>'string' or length(src->>'excerpt')>18000 or src->>'url' !~ '^https://(ca|it|en)\.wikipedia\.org/w/index\.php\?oldid=[0-9]+$' or not(src ?& array['id','title','url','excerpt','license'])),true) then return false;end if;
  seen:=array_append(seen,src->>'id');
 end loop;
 foreach section in array array['history','context','curiosities','highlights','practical','suggestions'] loop
  part:=doc->'sections'->section;
  if coalesce((part is null or jsonb_typeof(part)<>'object' or (select count(*) from jsonb_object_keys(part))<>3 or jsonb_typeof(part->'text')<>'string' or length(part->>'text')>4000 or part->>'origin' not in ('source','proposal','user') or jsonb_typeof(part->'evidence')<>'array' or jsonb_array_length(part->'evidence')>8),true) then return false;end if;
  if part->>'origin'<>'user' and length(btrim(part->>'text'))>0 and jsonb_array_length(part->'evidence')=0 then return false;end if;
  for evidence in select value from jsonb_array_elements(part->'evidence') loop
   if coalesce((jsonb_typeof(evidence)<>'object' or (select count(*) from jsonb_object_keys(evidence))<>2 or not(evidence ?& array['source_id','quote']) or jsonb_typeof(evidence->'quote')<>'string' or length(btrim(evidence->>'quote'))=0),true) then return false;end if;
   select value into matched from jsonb_array_elements(doc->'sources') where value->>'id'=evidence->>'source_id';
   if matched is null or strpos(matched->>'excerpt',evidence->>'quote')=0 then return false;end if;
   if part->>'origin'='source' and length(btrim(part->>'text'))>0 and strpos(matched->>'excerpt',part->>'text')=0 then return false;end if;
  end loop;
 end loop;
 return true;
exception when others then return false;
end $$;
-- Pure validation only; no data access or privilege elevation.
revoke all on function public.valid_cultural_guide_document_v1(jsonb,text) from public,anon;
grant execute on function public.valid_cultural_guide_document_v1(jsonb,text) to authenticated;
create table public.trip_cultural_guides(
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.trips(id) on delete cascade,
 place_key text not null,
 place jsonb not null,
 document jsonb not null,
 revision bigint not null default 1 check(revision>0),
 created_by uuid default auth.uid() references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(trip_id,place_key),
 constraint cultural_place_identity_v1 check(coalesce(
 jsonb_typeof(place)='object' and (place - array['provider','provider_place_id','canonical_name','latitude','longitude','country_code','locality','kind','coordinate_role','attribution'])='{}'::jsonb and octet_length(place::text)<=8192 and
 place->>'provider'='geoapify' and jsonb_typeof(place->'provider_place_id')='string' and jsonb_typeof(place->'canonical_name')='string' and jsonb_typeof(place->'attribution')='string' and place_key='geoapify:'||(place->>'provider_place_id') and length(place->>'provider_place_id') between 1 and 500 and
 length(place->>'canonical_name') between 1 and 200 and place->>'country_code' ~ '^[A-Z]{2}$' and
 place->>'coordinate_role' in('exact_location','representative_point') and length(place->>'attribution') between 1 and 2000 and
 jsonb_typeof(place->'latitude')='number' and (place->>'latitude')::numeric between -90 and 90 and
 jsonb_typeof(place->'longitude')='number' and (place->>'longitude')::numeric between -180 and 180,false)),
 constraint cultural_document_v1 check(public.valid_cultural_guide_document_v1(document,place_key))
);
create index cultural_guides_created_by_idx on public.trip_cultural_guides(created_by) where created_by is not null;
create index cultural_guides_updated_by_idx on public.trip_cultural_guides(updated_by) where updated_by is not null;
create function public.guard_cultural_guide_v1() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and pg_trigger_depth()>1 then return new;end if;
 if auth.uid() is null then raise exception 'Cal iniciar sessió' using errcode='42501';end if;
 if tg_op='UPDATE' then
  if new.id is distinct from old.id or new.trip_id is distinct from old.trip_id or new.place_key is distinct from old.place_key or new.place is distinct from old.place or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then raise exception 'No es pot canviar la identitat de la fitxa cultural' using errcode='42501';end if;
  new.revision:=old.revision+1;new.created_at:=old.created_at;new.created_by:=old.created_by;
 else new.revision:=1;new.created_by:=auth.uid();new.created_at:=clock_timestamp();end if;
 new.updated_by:=auth.uid();new.updated_at:=clock_timestamp();return new;
end $$;
revoke all on function public.guard_cultural_guide_v1() from public,anon,authenticated;
create trigger guard_cultural_guide_v1 before insert or update on public.trip_cultural_guides for each row execute function public.guard_cultural_guide_v1();
alter table public.trip_cultural_guides enable row level security;
revoke all on public.trip_cultural_guides from public,anon,authenticated;
grant select,insert,update,delete on public.trip_cultural_guides to authenticated;
create policy "members read cultural guides" on public.trip_cultural_guides for select to authenticated using(public.is_trip_member(trip_id));
create policy "members create cultural guides" on public.trip_cultural_guides for insert to authenticated with check(public.is_trip_member(trip_id) and created_by=auth.uid());
create policy "members edit cultural guides" on public.trip_cultural_guides for update to authenticated using(public.is_trip_member(trip_id)) with check(public.is_trip_member(trip_id));
create policy "members delete cultural guides" on public.trip_cultural_guides for delete to authenticated using(public.is_trip_member(trip_id));
alter table public.trip_cultural_guides replica identity full;
do $$begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.trip_cultural_guides;end if;end $$;
comment on table public.trip_cultural_guides is 'Trip-scoped, revisioned cultural text and cited public sources. No bookings/files. One identity per public place; manual edits are not automatically verified. Editorial snapshots require explicit selection.';
commit;

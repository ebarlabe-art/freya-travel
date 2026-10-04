-- ALB-02 sole mutation boundary. Public invoker facades, private privileged commands.
-- All locks are transaction-scoped. Never perform network I/O while holding them.
create function app_private.travel_book_access_v1(p_trip uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 perform 1 from public.trips where id=p_trip and discarded_at is null and experience_key is distinct from 'london-2026' for share;
 if not found then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 perform 1 from public.trip_members where trip_id=p_trip and user_id=auth.uid() for share;
 if not found or not public.is_trip_member(p_trip) then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
end $$;
create function app_private.travel_book_begin_v1(p_trip uuid,p_book uuid,p_edition uuid,p_operation uuid,p_type text,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.travel_book_operations;
begin
 if auth.uid() is null then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 if p_trip is null or p_book is null or p_operation is null or p_request is null or octet_length(p_request::text)>1048576 then raise exception 'ALB_INVALID_DOCUMENT' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('alb02-operation:'||auth.uid()::text||':'||p_operation::text,0));
 perform app_private.travel_book_access_v1(p_trip);
 select * into r from public.travel_book_operations where actor_id=auth.uid() and operation_id=p_operation;
 if found then
   if r.request is distinct from p_request or r.operation_type<>p_type or r.trip_id<>p_trip or r.book_id<>p_book or r.edition_id is distinct from p_edition then
     raise exception 'ALB_OPERATION_REUSED' using errcode='22023';end if;
   return r.result||jsonb_build_object('replayed',true);
 end if;
 if p_type<>'create_book' and not exists(select 1 from public.travel_books where trip_id=p_trip and id=p_book) then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
 return null;
end $$;
create function app_private.travel_book_finish_v1(p_trip uuid,p_book uuid,p_edition uuid,p_operation uuid,p_type text,p_request jsonb,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 insert into public.travel_book_operations(actor_id,operation_id,trip_id,book_id,edition_id,operation_type,request,result)
 values(auth.uid(),p_operation,p_trip,p_book,p_edition,p_type,p_request,p_result);
 return p_result||jsonb_build_object('replayed',false);
end $$;
create function app_private.create_travel_book_v1(p_trip_id uuid,p_book_id uuid,p_title text,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare req jsonb; replay jsonb; result jsonb;
begin
 req:=jsonb_build_object('trip_id',p_trip_id,'book_id',p_book_id,'title',p_title);
 replay:=app_private.travel_book_begin_v1(p_trip_id,p_book_id,null,p_operation_id,'create_book',req);if replay is not null then return replay;end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 160 then raise exception 'ALB_INVALID_DOCUMENT' using errcode='22023';end if;
 insert into public.travel_books(id,trip_id,title,created_by) values(p_book_id,p_trip_id,btrim(p_title),auth.uid());
 result:=jsonb_build_object('book_id',p_book_id,'trip_id',p_trip_id);
 return app_private.travel_book_finish_v1(p_trip_id,p_book_id,null,p_operation_id,'create_book',req,result);
end $$;
create function app_private.create_travel_book_edition_v1(p_trip_id uuid,p_book_id uuid,p_edition_id uuid,p_title text,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare req jsonb; replay jsonb;
begin
 req:=jsonb_build_object('trip_id',p_trip_id,'book_id',p_book_id,'edition_id',p_edition_id,'title',p_title);
 replay:=app_private.travel_book_begin_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'create_edition',req);if replay is not null then return replay;end if;
 if p_edition_id is null or p_title is null or length(btrim(p_title)) not between 1 and 160 then raise exception 'ALB_INVALID_DOCUMENT' using errcode='22023';end if;
 insert into public.travel_book_editions(id,trip_id,book_id,title,created_by,updated_by) values(p_edition_id,p_trip_id,p_book_id,btrim(p_title),auth.uid(),auth.uid());
 return app_private.travel_book_finish_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'create_edition',req,jsonb_build_object('edition_id',p_edition_id,'structure_version',1));
end $$;
create function app_private.change_travel_book_structure_v1(
 p_trip_id uuid,p_book_id uuid,p_edition_id uuid,p_operation_id uuid,p_expected_structure_version bigint,
 p_add jsonb,p_remove uuid[],p_order uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare req jsonb; replay jsonb; ed public.travel_book_editions; a jsonb; cid uuid; pid uuid; pages uuid[]; i integer; pos integer:=0; d jsonb;
begin
 req:=jsonb_build_object('trip_id',p_trip_id,'book_id',p_book_id,'edition_id',p_edition_id,'expected_structure_version',p_expected_structure_version,'add',p_add,'remove',p_remove,'order',p_order);
 replay:=app_private.travel_book_begin_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'structure',req);if replay is not null then return replay;end if;
 if p_expected_structure_version is null or p_expected_structure_version<1 or p_add is null or jsonb_typeof(p_add)<>'array' or jsonb_array_length(p_add)>100
   or p_remove is null or p_order is null or array_position(p_remove,null) is not null or array_position(p_order,null) is not null
   or cardinality(p_order)>1000 or cardinality(p_remove)>1000
   or cardinality(p_remove)<>(select count(distinct x) from unnest(p_remove) x)
   or cardinality(p_order)<>(select count(distinct x) from unnest(p_order) x) then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
 select * into ed from public.travel_book_editions where id=p_edition_id and book_id=p_book_id and trip_id=p_trip_id for update;
 if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
 if ed.structure_version<>p_expected_structure_version then raise exception 'ALB_STRUCTURE_CONFLICT' using errcode='40001',detail=jsonb_build_object('current_version',ed.structure_version)::text;end if;
 if exists(select 1 from unnest(p_remove) x where not exists(select 1 from public.travel_book_compositions c where c.id=x and c.edition_id=p_edition_id and c.removed_at is null)) then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
 update public.travel_book_compositions set removed_at=clock_timestamp(),removed_by=auth.uid(),updated_at=clock_timestamp(),updated_by=auth.uid() where edition_id=p_edition_id and id=any(p_remove);
 update public.travel_book_pages set position=null where edition_id=p_edition_id and composition_id=any(p_remove);
 for a in select value from jsonb_array_elements(p_add) loop
   if jsonb_typeof(a)<>'object' or a-'id'-'page_ids'<>'{}'::jsonb or not (a ?& array['id','page_ids']) or jsonb_typeof(a->'page_ids')<>'array' or jsonb_array_length(a->'page_ids') not between 1 and 2 then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
   cid:=(a->>'id')::uuid;
   select array_agg(value::uuid order by ordinality) into pages from jsonb_array_elements_text(a->'page_ids') with ordinality;
   if cid is null or array_position(pages,null) is not null or cardinality(pages)<>(select count(distinct x) from unnest(pages) x) then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
   insert into public.travel_book_compositions(id,trip_id,book_id,edition_id,kind,created_by,updated_by)
   values(cid,p_trip_id,p_book_id,p_edition_id,case cardinality(pages) when 1 then 'page' else 'spread' end,auth.uid(),auth.uid());
   i:=0;foreach pid in array pages loop
     insert into public.travel_book_pages(id,trip_id,book_id,edition_id,composition_id,slot,position,created_by) values(pid,p_trip_id,p_book_id,p_edition_id,cid,i,null,auth.uid());i:=i+1;
   end loop;
   d:=jsonb_build_object('schema_version',1,'composition_id',cid,'kind',case cardinality(pages) when 1 then 'page' else 'spread' end,'page_ids',to_jsonb(pages),'canvas',jsonb_build_object('unit','mm','width',null,'height',null),'elements','[]'::jsonb,'locks',jsonb_build_object('layout',false),'metadata',jsonb_build_object('label',null));
   insert into public.travel_book_composition_versions(composition_id,version,trip_id,book_id,edition_id,document,created_by) values(cid,1,p_trip_id,p_book_id,p_edition_id,d,auth.uid());
 end loop;
 if cardinality(p_order)<>(select count(*) from public.travel_book_compositions where edition_id=p_edition_id and removed_at is null)
 or exists(select 1 from unnest(p_order) x where not exists(select 1 from public.travel_book_compositions where id=x and edition_id=p_edition_id and removed_at is null)) then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
 foreach cid in array p_order loop
   for pid in select id from public.travel_book_pages where composition_id=cid order by slot loop
     update public.travel_book_pages set position=pos where id=pid;pos:=pos+1;
   end loop;
 end loop;
 update public.travel_book_editions set structure_version=structure_version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_edition_id returning * into ed;
 return app_private.travel_book_finish_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'structure',req,jsonb_build_object('edition_id',p_edition_id,'structure_version',ed.structure_version,'composition_order',p_order));
end $$;

create function app_private.travel_book_refs_v1(d jsonb)
returns table(ref_key text,element_id uuid,resource_kind text,asset_id uuid,source_snapshot_id uuid,usage text)
language sql immutable set search_path='' as $$
 select (e->>'id')||':image',(e->>'id')::uuid,'asset',(e->>'asset_id')::uuid,null::uuid,'image'
 from jsonb_array_elements(d->'elements') e where e->>'type'='image'
 union all
 select (e->>'id')||':source:'||s.value,(e->>'id')::uuid,'source_snapshot',null::uuid,s.value::uuid,'text_source'
 from jsonb_array_elements(d->'elements') e cross join lateral jsonb_array_elements_text(coalesce(e->'source_snapshot_ids','[]')) s where e->>'type'='text'
$$;
create function app_private.save_travel_book_compositions_v1(p_trip_id uuid,p_book_id uuid,p_edition_id uuid,p_operation_id uuid,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare req jsonb; replay jsonb; item jsonb; d jsonb; c public.travel_book_compositions; old public.travel_book_composition_versions; expected bigint; pages jsonb; results jsonb:='[]';
begin
 req:=jsonb_build_object('trip_id',p_trip_id,'book_id',p_book_id,'edition_id',p_edition_id,'changes',p_changes);
 replay:=app_private.travel_book_begin_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'save',req);if replay is not null then return replay;end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes) not between 1 and 100 then raise exception 'ALB_INVALID_DOCUMENT' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_changes) loop
   if jsonb_typeof(item)<>'object' or item-'expected_version'-'document'<>'{}'::jsonb or not (item ?& array['expected_version','document']) or jsonb_typeof(item->'expected_version')<>'number'
     or (item->>'expected_version')!~'^[1-9][0-9]*$' or (item->>'expected_version')::numeric>9007199254740991
     or not app_private.travel_book_composition_valid_v1(item->'document') then raise exception 'ALB_INVALID_DOCUMENT' using errcode='22023';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_changes) x group by x#>>'{document,composition_id}' having count(*)>1) then raise exception 'ALB_INVALID_DOCUMENT' using errcode='22023';end if;
 perform 1 from public.travel_book_editions where id=p_edition_id and book_id=p_book_id and trip_id=p_trip_id for share;
 if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
 for item in select value from jsonb_array_elements(p_changes) order by value#>>'{document,composition_id}' loop
   d:=item->'document';expected:=(item->>'expected_version')::bigint;
   select * into c from public.travel_book_compositions where id=(d->>'composition_id')::uuid and trip_id=p_trip_id and book_id=p_book_id and edition_id=p_edition_id and removed_at is null for update;
   if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
   if c.current_version<>expected then raise exception 'ALB_COMPOSITION_CONFLICT' using errcode='40001',detail=jsonb_build_object('composition_id',c.id,'current_version',c.current_version)::text;end if;
   select jsonb_agg(id order by slot) into pages from public.travel_book_pages where composition_id=c.id;
   if d->>'kind'<>c.kind or d->'page_ids'<>pages then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
   if exists(select 1 from app_private.travel_book_refs_v1(d) r where (r.resource_kind='asset' and not exists(select 1 from public.travel_book_assets a where a.id=r.asset_id and a.trip_id=p_trip_id and a.book_id=p_book_id and a.kind='image')) or (r.resource_kind='source_snapshot' and not exists(select 1 from public.travel_book_source_snapshots s where s.id=r.source_snapshot_id and s.trip_id=p_trip_id and s.book_id=p_book_id))) then raise exception 'ALB_RESOURCE_SCOPE_MISMATCH' using errcode='23503';end if;
   select * into old from public.travel_book_composition_versions where composition_id=c.id and version=c.current_version;
   if old.document is distinct from d then
     insert into public.travel_book_composition_versions(composition_id,version,trip_id,book_id,edition_id,document,created_by)
     values(c.id,c.current_version+1,p_trip_id,p_book_id,p_edition_id,d,auth.uid()) returning * into old;
     insert into public.travel_book_resource_refs(composition_id,composition_version,trip_id,book_id,edition_id,ref_key,element_id,resource_kind,asset_id,source_snapshot_id,usage)
     select c.id,old.version,p_trip_id,p_book_id,p_edition_id,r.* from app_private.travel_book_refs_v1(d) r;
     update public.travel_book_compositions set current_version=old.version,updated_at=clock_timestamp(),updated_by=auth.uid() where id=c.id;
   end if;
   results:=results||jsonb_build_array(jsonb_build_object('composition_id',c.id,'version',old.version,'document_hash',old.document_hash));
 end loop;
 return app_private.travel_book_finish_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'save',req,jsonb_build_object('compositions',results));
end $$;

create function app_private.create_travel_book_revision_v1(p_trip_id uuid,p_book_id uuid,p_edition_id uuid,p_operation_id uuid,p_revision_id uuid,p_expected_structure_version bigint,p_expected_compositions jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare req jsonb; replay jsonb; ed public.travel_book_editions; actual jsonb; manifest jsonb; assets jsonb; snapshots jsonb; r public.travel_book_revisions; item jsonb;
begin
 req:=jsonb_build_object('trip_id',p_trip_id,'book_id',p_book_id,'edition_id',p_edition_id,'revision_id',p_revision_id,'expected_structure_version',p_expected_structure_version,'expected_compositions',p_expected_compositions);
 replay:=app_private.travel_book_begin_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'revision',req);if replay is not null then return replay;end if;
 if p_revision_id is null or p_expected_structure_version is null or p_expected_structure_version<1 or p_expected_compositions is null or jsonb_typeof(p_expected_compositions)<>'array' or jsonb_array_length(p_expected_compositions)>1000 then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_expected_compositions) loop
   if jsonb_typeof(item)<>'object' or item-'id'-'version'<>'{}'::jsonb or not (item ?& array['id','version']) or jsonb_typeof(item->'version')<>'number' or (item->>'version')!~'^[1-9][0-9]*$' or (item->>'version')::numeric>9007199254740991 then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
   perform (item->>'id')::uuid;
 end loop;
 select * into ed from public.travel_book_editions where id=p_edition_id and book_id=p_book_id and trip_id=p_trip_id for update;
 if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',current_version) order by id),'[]') into actual from public.travel_book_compositions where edition_id=ed.id and removed_at is null;
 if ed.structure_version<>p_expected_structure_version or actual<>(select coalesce(jsonb_agg(value order by value->>'id'),'[]') from jsonb_array_elements(p_expected_compositions)) then raise exception 'ALB_REVISION_CONFLICT' using errcode='40001',detail=jsonb_build_object('structure_version',ed.structure_version,'compositions',actual)::text;end if;
 -- Future resource finalizers must acquire these same asset row locks before changing availability.
 perform 1 from public.travel_book_assets a where exists(select 1 from public.travel_book_resource_refs ref join public.travel_book_compositions c on c.id=ref.composition_id and c.current_version=ref.composition_version where c.edition_id=ed.id and c.removed_at is null and ref.asset_id=a.id) order by a.id for share;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'asset_key',a.asset_key,'version',a.version,'status',a.status,'content_hash',a.content_hash,'mime_type',a.mime_type,'width_px',a.width_px,'height_px',a.height_px,'storage_bucket',a.storage_bucket,'storage_path',a.storage_path) order by a.id),'[]') into assets
 from public.travel_book_assets a where exists(select 1 from public.travel_book_resource_refs ref join public.travel_book_compositions c on c.id=ref.composition_id and c.current_version=ref.composition_version where c.edition_id=ed.id and c.removed_at is null and ref.asset_id=a.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'schema_version',s.schema_version,'payload_hash',s.payload_hash,'classification',s.classification) order by s.id),'[]') into snapshots
 from public.travel_book_source_snapshots s where exists(select 1 from public.travel_book_resource_refs ref join public.travel_book_compositions c on c.id=ref.composition_id and c.current_version=ref.composition_version where c.edition_id=ed.id and c.removed_at is null and ref.source_snapshot_id=s.id);
 manifest:=jsonb_build_object('schema_version',1,'hash_version',1,'trip_id',p_trip_id,'book_id',p_book_id,'edition_id',ed.id,'structure_version',ed.structure_version,
 'book_title',(select title from public.travel_books where id=p_book_id),'edition_title',ed.title,
 'pages',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'composition_id',composition_id,'slot',slot,'position',position) order by position),'[]') from public.travel_book_pages where edition_id=ed.id and position is not null),
 'compositions',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'version',v.version,'document_hash',v.document_hash) order by c.id),'[]') from public.travel_book_compositions c join public.travel_book_composition_versions v on v.composition_id=c.id and v.version=c.current_version where c.edition_id=ed.id and c.removed_at is null),
 'assets',assets,'snapshots',snapshots);
 insert into public.travel_book_revisions(id,trip_id,book_id,edition_id,revision_number,structure_version,manifest,resource_state_at_capture,created_by)
 values(p_revision_id,p_trip_id,p_book_id,ed.id,ed.next_revision_number,ed.structure_version,manifest,case when exists(select 1 from jsonb_array_elements(assets) a where a->>'status'<>'ready') then 'incomplete' else 'complete' end,auth.uid()) returning * into r;
 insert into public.travel_book_revision_compositions(revision_id,composition_id,composition_version,trip_id,book_id,edition_id)
 select r.id,c.id,c.current_version,p_trip_id,p_book_id,ed.id from public.travel_book_compositions c where c.edition_id=ed.id and c.removed_at is null;
 update public.travel_book_editions set next_revision_number=next_revision_number+1 where id=ed.id;
 return app_private.travel_book_finish_v1(p_trip_id,p_book_id,ed.id,p_operation_id,'revision',req,jsonb_build_object('revision_id',r.id,'revision_number',r.revision_number,'manifest_hash',r.manifest_hash,'resource_state_at_capture',r.resource_state_at_capture));
end $$;
create function app_private.get_travel_book_operation_v1(p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.travel_book_operations;
begin
 if auth.uid() is null then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 select * into r from public.travel_book_operations where actor_id=auth.uid() and operation_id=p_operation_id;
 if not found then return null;end if;
 perform app_private.travel_book_access_v1(r.trip_id);
 return r.result||jsonb_build_object('replayed',true);
end $$;

revoke all on function app_private.travel_book_access_v1(uuid) from public,anon,authenticated,service_role;

revoke all on function app_private.travel_book_begin_v1(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

revoke all on function app_private.travel_book_finish_v1(uuid,uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;

revoke all on function app_private.create_travel_book_v1(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.create_travel_book_v1(uuid,uuid,text,uuid) to authenticated;
create function public.create_travel_book_v1(p_trip_id uuid,p_book_id uuid,p_title text,p_operation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app_private.create_travel_book_v1(p_trip_id,p_book_id,p_title,p_operation_id) $$;
revoke all on function public.create_travel_book_v1(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_travel_book_v1(uuid,uuid,text,uuid) to authenticated;

revoke all on function app_private.create_travel_book_edition_v1(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.create_travel_book_edition_v1(uuid,uuid,uuid,text,uuid) to authenticated;
create function public.create_travel_book_edition_v1(p_trip_id uuid,p_book_id uuid,p_edition_id uuid,p_title text,p_operation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app_private.create_travel_book_edition_v1(p_trip_id,p_book_id,p_edition_id,p_title,p_operation_id) $$;
revoke all on function public.create_travel_book_edition_v1(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_travel_book_edition_v1(uuid,uuid,uuid,text,uuid) to authenticated;

revoke all on function app_private.change_travel_book_structure_v1(uuid,uuid,uuid,uuid,bigint,jsonb,uuid[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function app_private.change_travel_book_structure_v1(uuid,uuid,uuid,uuid,bigint,jsonb,uuid[],uuid[]) to authenticated;
create function public.change_travel_book_structure_v1(
 p_trip_id uuid,p_book_id uuid,p_edition_id uuid,p_operation_id uuid,p_expected_structure_version bigint,
 p_add jsonb,p_remove uuid[],p_order uuid[]
) returns jsonb
language sql security invoker set search_path='' as $$ select app_private.change_travel_book_structure_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,p_expected_structure_version,p_add,p_remove,p_order) $$;
revoke all on function public.change_travel_book_structure_v1(uuid,uuid,uuid,uuid,bigint,jsonb,uuid[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.change_travel_book_structure_v1(uuid,uuid,uuid,uuid,bigint,jsonb,uuid[],uuid[]) to authenticated;

revoke all on function app_private.travel_book_refs_v1(jsonb) from public,anon,authenticated,service_role;

revoke all on function app_private.save_travel_book_compositions_v1(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.save_travel_book_compositions_v1(uuid,uuid,uuid,uuid,jsonb) to authenticated;
create function public.save_travel_book_compositions_v1(p_trip_id uuid,p_book_id uuid,p_edition_id uuid,p_operation_id uuid,p_changes jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select app_private.save_travel_book_compositions_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,p_changes) $$;
revoke all on function public.save_travel_book_compositions_v1(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_travel_book_compositions_v1(uuid,uuid,uuid,uuid,jsonb) to authenticated;

revoke all on function app_private.create_travel_book_revision_v1(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.create_travel_book_revision_v1(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) to authenticated;
create function public.create_travel_book_revision_v1(p_trip_id uuid,p_book_id uuid,p_edition_id uuid,p_operation_id uuid,p_revision_id uuid,p_expected_structure_version bigint,p_expected_compositions jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select app_private.create_travel_book_revision_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,p_revision_id,p_expected_structure_version,p_expected_compositions) $$;
revoke all on function public.create_travel_book_revision_v1(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_travel_book_revision_v1(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) to authenticated;

revoke all on function app_private.get_travel_book_operation_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.get_travel_book_operation_v1(uuid) to authenticated;
create function public.get_travel_book_operation_v1(p_operation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app_private.get_travel_book_operation_v1(p_operation_id) $$;
revoke all on function public.get_travel_book_operation_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_travel_book_operation_v1(uuid) to authenticated;

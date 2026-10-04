-- ALB-02: additive foundation. No source ingestion, Storage or frontend changes.
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;
create function app_private.travel_book_composition_schema_v1() returns json
language sql immutable set search_path='' as $schema$ select $json${"type":"object","properties":{"schema_version":{"const":1},"composition_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"kind":{"enum":["page","spread"]},"page_ids":{"type":"array","items":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"minItems":1,"maxItems":2,"uniqueItems":true},"canvas":{"type":"object","properties":{"unit":{"const":"mm"},"width":{"anyOf":[{"type":"number","exclusiveMinimum":0,"maximum":1000000},{"type":"null"}]},"height":{"anyOf":[{"type":"number","exclusiveMinimum":0,"maximum":1000000},{"type":"null"}]}},"required":["unit","width","height"],"additionalProperties":false},"elements":{"type":"array","maxItems":200,"items":{"oneOf":[{"type":"object","properties":{"id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"geometry":{"type":"object","properties":{"x":{"type":"number","minimum":-1000000,"maximum":1000000},"y":{"type":"number","minimum":-1000000,"maximum":1000000},"width":{"type":"number","exclusiveMinimum":0,"maximum":1000000},"height":{"type":"number","exclusiveMinimum":0,"maximum":1000000},"rotation":{"type":"number","minimum":-360,"maximum":360}},"required":["x","y","width","height","rotation"],"additionalProperties":false},"locks":{"type":"object","properties":{"content":{"type":"boolean"},"geometry":{"type":"boolean"}},"required":["content","geometry"],"additionalProperties":false},"type":{"const":"text"},"role":{"enum":["title","body","caption"]},"text":{"type":"string","maxLength":16000},"source_snapshot_ids":{"type":"array","items":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"maxItems":20,"uniqueItems":true}},"required":["id","geometry","locks","type","role","text","source_snapshot_ids"],"additionalProperties":false},{"type":"object","properties":{"id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"geometry":{"type":"object","properties":{"x":{"type":"number","minimum":-1000000,"maximum":1000000},"y":{"type":"number","minimum":-1000000,"maximum":1000000},"width":{"type":"number","exclusiveMinimum":0,"maximum":1000000},"height":{"type":"number","exclusiveMinimum":0,"maximum":1000000},"rotation":{"type":"number","minimum":-360,"maximum":360}},"required":["x","y","width","height","rotation"],"additionalProperties":false},"locks":{"type":"object","properties":{"content":{"type":"boolean"},"geometry":{"type":"boolean"}},"required":["content","geometry"],"additionalProperties":false},"type":{"const":"image"},"asset_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"crop":{"type":"object","properties":{"x":{"type":"number","minimum":0,"maximum":1},"y":{"type":"number","minimum":0,"maximum":1},"width":{"type":"number","exclusiveMinimum":0,"maximum":1},"height":{"type":"number","exclusiveMinimum":0,"maximum":1}},"required":["x","y","width","height"],"additionalProperties":false}},"required":["id","geometry","locks","type","asset_id","crop"],"additionalProperties":false}]}},"locks":{"type":"object","properties":{"layout":{"type":"boolean"}},"required":["layout"],"additionalProperties":false},"metadata":{"type":"object","properties":{"label":{"anyOf":[{"type":"string","maxLength":160},{"type":"null"}]}},"required":["label"],"additionalProperties":false}},"required":["schema_version","composition_id","kind","page_ids","canvas","elements","locks","metadata"],"additionalProperties":false}$json$::json $schema$;
create function app_private.travel_book_composition_valid_v1(d jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if d is null or octet_length(d::text)>262144 or not extensions.jsonb_matches_schema(app_private.travel_book_composition_schema_v1(),d) then return false; end if;
 if jsonb_array_length(d->'page_ids')<>(case d->>'kind' when 'page' then 1 else 2 end) then return false; end if;
 if (d#>'{canvas,width}'='null'::jsonb)<>(d#>'{canvas,height}'='null'::jsonb) then return false; end if;
 if d#>'{canvas,width}'='null'::jsonb and jsonb_array_length(d->'elements')>0 then return false; end if;
 if exists(select 1 from jsonb_array_elements(d->'elements') e group by e->>'id' having count(*)>1) then return false; end if;
 if exists(select 1 from jsonb_array_elements(d->'elements') e where e->>'type'='image' and
   ((e#>>'{crop,x}')::numeric+(e#>>'{crop,width}')::numeric>1 or (e#>>'{crop,y}')::numeric+(e#>>'{crop,height}')::numeric>1)) then return false; end if;
 return true;
exception when others then return false;
end $$;
create function app_private.travel_book_hash_v1(d jsonb) returns text
language sql immutable strict set search_path='' as $$ select encode(sha256(convert_to(d::text,'UTF8')),'hex') $$;
create function app_private.travel_book_snapshot_valid_v1(d jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb;
begin
 if d is null or jsonb_typeof(d)<>'object' or octet_length(d::text)>32768 or d-'label'-'local_date'-'place_label'<>'{}'::jsonb then return false;end if;
 for k,v in select * from jsonb_each(d) loop
   if jsonb_typeof(v)<>'string' or length(v#>>'{}')>500 then return false;end if;
   if k='local_date' then
     if (v#>>'{}')!~'^\d{4}-\d{2}-\d{2}$' then return false;end if;
     perform (v#>>'{}')::date;
   end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create table public.travel_books (
 id uuid primary key, trip_id uuid not null references public.trips(id) on delete restrict,
 title text not null check(title=btrim(title) and length(title) between 1 and 160),
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 unique(trip_id,id)
);
create index travel_books_trip_created_idx on public.travel_books(trip_id,created_at desc,id);
create table public.travel_book_editions (
 id uuid primary key, trip_id uuid not null, book_id uuid not null,
 title text not null check(title=btrim(title) and length(title) between 1 and 160),
 structure_version bigint not null default 1 check(structure_version between 1 and 9007199254740991),
 next_revision_number bigint not null default 1 check(next_revision_number between 1 and 9007199254740991),
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 updated_at timestamptz not null default clock_timestamp(), updated_by uuid not null,
 foreign key(trip_id,book_id) references public.travel_books(trip_id,id) on delete restrict,
 unique(trip_id,book_id,id)
);
create index travel_book_editions_book_idx on public.travel_book_editions(trip_id,book_id,created_at,id);
create table public.travel_book_compositions (
 id uuid primary key, trip_id uuid not null, book_id uuid not null, edition_id uuid not null,
 kind text not null check(kind in ('page','spread')),
 current_version bigint not null default 1 check(current_version between 1 and 9007199254740991),
 removed_at timestamptz, removed_by uuid,
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 updated_at timestamptz not null default clock_timestamp(), updated_by uuid not null,
 check((removed_at is null)=(removed_by is null)),
 foreign key(trip_id,book_id,edition_id) references public.travel_book_editions(trip_id,book_id,id) on delete restrict,
 unique(trip_id,book_id,edition_id,id)
);
create index travel_book_compositions_active_idx on public.travel_book_compositions(edition_id,id) where removed_at is null;
create index travel_book_compositions_scope_idx on public.travel_book_compositions(trip_id,book_id,edition_id);
create table public.travel_book_pages (
 id uuid primary key, trip_id uuid not null, book_id uuid not null, edition_id uuid not null, composition_id uuid not null,
 slot smallint not null check(slot in (0,1)), position integer check(position>=0),
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 foreign key(trip_id,book_id,edition_id,composition_id) references public.travel_book_compositions(trip_id,book_id,edition_id,id) on delete restrict,
 unique(trip_id,book_id,edition_id,id), unique(composition_id,slot),
 unique(edition_id,position) deferrable initially deferred
);
create index travel_book_pages_scope_idx on public.travel_book_pages(trip_id,book_id,edition_id,composition_id);
create table public.travel_book_composition_versions (
 composition_id uuid not null, version bigint not null check(version between 1 and 9007199254740991),
 trip_id uuid not null, book_id uuid not null, edition_id uuid not null,
 schema_version integer not null default 1 check(schema_version=1), document jsonb not null,
 hash_version integer not null default 1 check(hash_version=1),
 document_hash text generated always as (app_private.travel_book_hash_v1(document)) stored,
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 primary key(composition_id,version),unique(trip_id,book_id,edition_id,composition_id,version),
 foreign key(trip_id,book_id,edition_id,composition_id) references public.travel_book_compositions(trip_id,book_id,edition_id,id) on delete restrict,
 check(app_private.travel_book_composition_valid_v1(document)),
 check(document->>'composition_id'=composition_id::text)
);
alter table public.travel_book_compositions add constraint travel_book_current_version_fk
 foreign key(id,current_version) references public.travel_book_composition_versions(composition_id,version) deferrable initially deferred;
create table public.travel_book_source_snapshots (
 id uuid primary key, trip_id uuid not null, book_id uuid not null,
 source_kind text not null check(source_kind in ('trip','photo','day','activity','planning','accommodation','flight','stop','car_rental','editorial')),
 source_id uuid, source_version text check(length(source_version)<=200),
 schema_version integer not null default 1 check(schema_version=1),
 classification text not null check(classification in ('context','user_statement','source_evidence')),
 origin text not null check(origin in ('trip_source','explicit_editorial_input')),
 availability_at_capture text not null check(availability_at_capture in ('available','unavailable')),
 payload jsonb not null check(app_private.travel_book_snapshot_valid_v1(payload)),
 hash_version integer not null default 1 check(hash_version=1),
 payload_hash text generated always as (app_private.travel_book_hash_v1(payload)) stored,
 captured_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),created_by uuid not null,
 check((origin='trip_source' and source_kind<>'editorial' and source_id is not null) or (origin='explicit_editorial_input' and source_kind='editorial' and source_id is null)),
 foreign key(trip_id,book_id) references public.travel_books(trip_id,id) on delete restrict,
 unique(trip_id,book_id,id)
);
create index travel_book_snapshots_source_idx on public.travel_book_source_snapshots(trip_id,book_id,source_kind,source_id,captured_at desc);
create table public.travel_book_assets (
 id uuid primary key,trip_id uuid not null,book_id uuid not null,asset_key uuid not null,
 version integer not null check(version>=1),kind text not null default 'image' check(kind='image'),
 source_document_id uuid,source_document_id_at_capture uuid,
 status text not null default 'pending' check(status in ('pending','ready','missing')),
 content_hash text check(content_hash~'^[0-9a-f]{64}$'),mime_type text check(mime_type in ('image/jpeg','image/png','image/webp')),
 width_px integer check(width_px>0),height_px integer check(height_px>0),
 storage_bucket text,storage_path text,verified_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null,
 updated_at timestamptz not null default clock_timestamp(),updated_by uuid not null,
 check((storage_bucket is null)=(storage_path is null)),
 check(storage_bucket is null or (length(storage_bucket) between 1 and 100 and length(storage_path) between 1 and 1024 and storage_path!~'(^/|://|\?|(^|/)\.\.(/|$))')),
 check(status<>'ready' or (content_hash is not null and mime_type is not null and width_px is not null and height_px is not null and storage_path is not null and verified_at is not null)),
 foreign key(trip_id,book_id) references public.travel_books(trip_id,id) on delete restrict,
 foreign key(trip_id,source_document_id) references public.travel_documents(trip_id,id) on delete set null(source_document_id),
 unique(trip_id,book_id,id),unique(book_id,asset_key,version)
);
create index travel_book_assets_source_idx on public.travel_book_assets(trip_id,source_document_id) where source_document_id is not null;
create index travel_book_assets_status_idx on public.travel_book_assets(trip_id,book_id,status);
create table public.travel_book_resource_refs (
 composition_id uuid not null,composition_version bigint not null,ref_key text not null check(length(ref_key)<=120),
 trip_id uuid not null,book_id uuid not null,edition_id uuid not null,element_id uuid not null,
 resource_kind text not null,asset_id uuid,source_snapshot_id uuid,usage text not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(composition_id,composition_version,ref_key),
 check((resource_kind='asset' and usage='image' and asset_id is not null and source_snapshot_id is null) or (resource_kind='source_snapshot' and usage='text_source' and source_snapshot_id is not null and asset_id is null)),
 foreign key(trip_id,book_id,edition_id,composition_id,composition_version) references public.travel_book_composition_versions(trip_id,book_id,edition_id,composition_id,version) on delete restrict,
 foreign key(trip_id,book_id,asset_id) references public.travel_book_assets(trip_id,book_id,id) on delete restrict,
 foreign key(trip_id,book_id,source_snapshot_id) references public.travel_book_source_snapshots(trip_id,book_id,id) on delete restrict
);
create index travel_book_refs_asset_idx on public.travel_book_resource_refs(trip_id,book_id,asset_id) where asset_id is not null;
create index travel_book_refs_snapshot_idx on public.travel_book_resource_refs(trip_id,book_id,source_snapshot_id) where source_snapshot_id is not null;
create index travel_book_refs_scope_idx on public.travel_book_resource_refs(trip_id,book_id,edition_id,composition_id,composition_version);
create table public.travel_book_revisions (
 id uuid primary key,trip_id uuid not null,book_id uuid not null,edition_id uuid not null,
 revision_number bigint not null check(revision_number between 1 and 9007199254740991),
 structure_version bigint not null check(structure_version between 1 and 9007199254740991),
 schema_version integer not null default 1 check(schema_version=1),manifest jsonb not null check(jsonb_typeof(manifest)='object'),
 hash_version integer not null default 1 check(hash_version=1),
 manifest_hash text generated always as (app_private.travel_book_hash_v1(manifest)) stored,
 resource_state_at_capture text not null check(resource_state_at_capture in ('complete','incomplete')),
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null,
 foreign key(trip_id,book_id,edition_id) references public.travel_book_editions(trip_id,book_id,id) on delete restrict,
 unique(edition_id,revision_number),unique(trip_id,book_id,edition_id,id)
);
create table public.travel_book_revision_compositions (
 revision_id uuid not null,composition_id uuid not null,composition_version bigint not null,
 trip_id uuid not null,book_id uuid not null,edition_id uuid not null,
 primary key(revision_id,composition_id),
 foreign key(trip_id,book_id,edition_id,revision_id) references public.travel_book_revisions(trip_id,book_id,edition_id,id) on delete restrict,
 foreign key(trip_id,book_id,edition_id,composition_id,composition_version) references public.travel_book_composition_versions(trip_id,book_id,edition_id,composition_id,version) on delete restrict
);
create index travel_book_revision_versions_idx on public.travel_book_revision_compositions(trip_id,book_id,edition_id,composition_id,composition_version);
create table public.travel_book_operations (
 actor_id uuid not null,operation_id uuid not null,trip_id uuid not null,book_id uuid not null,edition_id uuid,
 operation_type text not null check(operation_type in ('create_book','create_edition','structure','save','revision')),
 request jsonb not null check(jsonb_typeof(request)='object' and octet_length(request::text)<=1048576),
 result jsonb not null check(jsonb_typeof(result)='object' and octet_length(result::text)<=262144),
 status text not null default 'applied' check(status='applied'),created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,operation_id),
 foreign key(trip_id,book_id) references public.travel_books(trip_id,id) on delete restrict,
 foreign key(trip_id,book_id,edition_id) references public.travel_book_editions(trip_id,book_id,id) on delete restrict
);
create index travel_book_operations_book_idx on public.travel_book_operations(trip_id,book_id,created_at);
create index travel_book_operations_edition_idx on public.travel_book_operations(trip_id,book_id,edition_id);

-- Business mutations live in commands, not triggers. This trigger only guards append-only records.
create function app_private.travel_book_reject_mutation() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'ALB_IMMUTABLE' using errcode='55000';end $$;
do $$ declare n text; begin
 foreach n in array array['travel_books','travel_book_editions','travel_book_compositions','travel_book_pages','travel_book_composition_versions','travel_book_source_snapshots','travel_book_assets','travel_book_resource_refs','travel_book_revisions','travel_book_revision_compositions','travel_book_operations'] loop
   execute format('alter table public.%I enable row level security',n);
   execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
   execute format('grant select on public.%I to authenticated',n);
   execute format('create policy %I on public.%I for select to authenticated using (public.is_trip_member(trip_id)%s)',n||'_read',n,case when n='travel_book_operations' then ' and actor_id=(select auth.uid())' else '' end);
 end loop;
 foreach n in array array['travel_book_composition_versions','travel_book_source_snapshots','travel_book_resource_refs','travel_book_revisions','travel_book_revision_compositions','travel_book_operations'] loop
   execute format('create trigger %I before update or delete on public.%I for each row execute function app_private.travel_book_reject_mutation()',n||'_immutable',n);
 end loop;
end $$;
revoke all on function app_private.travel_book_composition_schema_v1(),app_private.travel_book_composition_valid_v1(jsonb),app_private.travel_book_hash_v1(jsonb),app_private.travel_book_snapshot_valid_v1(jsonb),app_private.travel_book_reject_mutation() from public,anon,authenticated,service_role;

-- A ready master descriptor cannot be rewritten, even by a future writer.
-- SET NULL of the live source pointer remains allowed after gallery deletion.
create function app_private.travel_book_protect_master_v1() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.id,new.trip_id,new.book_id,new.asset_key,new.version,new.source_document_id_at_capture,new.created_at,new.created_by)
   is distinct from (old.id,old.trip_id,old.book_id,old.asset_key,old.version,old.source_document_id_at_capture,old.created_at,old.created_by)
   or (new.source_document_id is distinct from old.source_document_id and new.source_document_id is not null) then
   raise exception 'ALB_IMMUTABLE' using errcode='55000';end if;
 if old.content_hash is not null and old.status in ('ready','missing') and
   (new.content_hash,new.mime_type,new.width_px,new.height_px,new.storage_bucket,new.storage_path,new.verified_at)
   is distinct from (old.content_hash,old.mime_type,old.width_px,old.height_px,old.storage_bucket,old.storage_path,old.verified_at) then
   raise exception 'ALB_IMMUTABLE' using errcode='55000';end if;
 if old.status in ('ready','missing') and new.status='pending' then raise exception 'ALB_IMMUTABLE' using errcode='55000';end if;
 return new;
end $$;
revoke all on function app_private.travel_book_protect_master_v1() from public,anon,authenticated,service_role;
create trigger travel_book_master_immutable before update on public.travel_book_assets
 for each row execute function app_private.travel_book_protect_master_v1();

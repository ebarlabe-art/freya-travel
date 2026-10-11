-- STAGING ONLY: private travel documents and storage, no production writes.
-- Separate Supabase project waatqrqyddurultrazbn. No real travelers or PDFs are copied.
create table public.travel_documents(
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.trips(id) on delete cascade,
 title text not null check (title=btrim(title) and char_length(title) between 1 and 200),
 category text not null default 'Altres' check (char_length(btrim(category)) between 1 and 80),
 file_name text not null check (char_length(btrim(file_name)) between 1 and 500),
 file_path text not null unique,
 mime_type text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 constraint staging_document_path_scoped check (
  file_path like trip_id::text||'/%'
  and char_length(file_path) between 39 and 1000
  and file_path not like '%..%'
  and file_path not like '%?%'
  and file_path not like '%#%'
 ),
 constraint staging_document_allowed_mime check (
  mime_type is null or mime_type in (
    'application/pdf','image/jpeg','image/jpg','image/png',
    'image/webp','image/heic','image/heif'
  )
 ),
 unique (trip_id,id)
);
create index travel_documents_trip_created_idx on public.travel_documents(trip_id,created_at desc);
alter table public.travel_documents enable row level security;
revoke all on public.travel_documents from public,anon,authenticated;
grant select,insert,update,delete on public.travel_documents to authenticated;
create policy staging_documents_select
 on public.travel_documents for select to authenticated
 using (public.is_trip_member(trip_id));
create policy staging_documents_insert
 on public.travel_documents for insert to authenticated
 with check (public.is_trip_member(trip_id) and created_by=(select auth.uid()));
create policy staging_documents_update
 on public.travel_documents for update to authenticated
 using (public.is_trip_member(trip_id))
 with check (public.is_trip_member(trip_id) and created_by=(select auth.uid()));
create policy staging_documents_delete
 on public.travel_documents for delete to authenticated
 using (public.is_trip_member(trip_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
 'trip-documents','trip-documents',false,33554432,
 array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
);
-- A deliberately strict pathname check: "trip-uuid/filename" is required,
-- and invalid UUIDs fail closed rather than being cast without validation.
create or replace function public.staging_document_storage_member(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path=''
as $$
 select coalesce(
  p_bucket='trip-documents'
  and p_name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[^/]+'
  and case when p_name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[^/]+'
    then public.is_trip_member(split_part(p_name,'/',1)::uuid)
    else false end,
 false)
$$;
revoke all on function public.staging_document_storage_member(text,text) from public,anon,authenticated;
grant execute on function public.staging_document_storage_member(text,text) to authenticated;
create policy staging_trip_docs_select
 on storage.objects for select to authenticated
 using (public.staging_document_storage_member(bucket_id,name));
create policy staging_trip_docs_insert
 on storage.objects for insert to authenticated
 with check (public.staging_document_storage_member(bucket_id,name));
create policy staging_trip_docs_update
 on storage.objects for update to authenticated
 using (public.staging_document_storage_member(bucket_id,name))
 with check (public.staging_document_storage_member(bucket_id,name));
create policy staging_trip_docs_delete
 on storage.objects for delete to authenticated
 using (public.staging_document_storage_member(bucket_id,name));
